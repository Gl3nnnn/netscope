import { describe, expect, it } from 'vitest'
import type { Device, DeviceStatus } from '@/types'
import {
  alternatePaths,
  buildAdjacency,
  pathMetrics,
  shortestPath,
  slowestHop,
  trace,
} from '@/lib/tracer'

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: 'Device 1',
    type: 'server',
    site: 'HQ',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 10,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 20,
    memoryPct: 30,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

/** A simple chain a-b-c-d for deterministic path testing. */
function linkedGraph() {
  const devices = [
    device({ id: 'a', name: 'A' }),
    device({ id: 'b', name: 'B' }),
    device({ id: 'c', name: 'C' }),
    device({ id: 'd', name: 'D' }),
  ]
  const links = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
    { source: 'a', target: 'd' },
  ]
  return { devices, graph: buildAdjacency(devices, links) }
}

describe('buildAdjacency', () => {
  it('creates undirected neighbours for every device', () => {
    const { graph } = linkedGraph()
    expect(graph.adjacency.get('a')?.sort()).toEqual(['b', 'd'])
    expect(graph.adjacency.get('b')?.sort()).toEqual(['a', 'c'])
  })
})

describe('shortestPath', () => {
  it('finds the fewest-hop route', () => {
    const { graph } = linkedGraph()
    expect(shortestPath(graph, 'a', 'd')).toEqual(['a', 'd'])
    expect(shortestPath(graph, 'a', 'c')).toEqual(['a', 'b', 'c'])
  })

  it('returns a single node when source equals destination', () => {
    const { graph } = linkedGraph()
    expect(shortestPath(graph, 'a', 'a')).toEqual(['a'])
  })

  it('returns null when a node is unreachable or avoided', () => {
    const { graph } = linkedGraph()
    expect(shortestPath(graph, 'a', 'z')).toBeNull()
    expect(shortestPath(graph, 'a', 'd', new Set(['d']))).toBeNull()
  })
})

describe('alternatePaths', () => {
  it('enumerates simple paths, shortest first', () => {
    const { graph } = linkedGraph()
    const paths = alternatePaths(graph, 'a', 'c')
    expect(paths).toEqual([
      ['a', 'b', 'c'],
      ['a', 'd', 'c'],
    ])
  })

  it('skips avoided nodes', () => {
    const { graph } = linkedGraph()
    const paths = alternatePaths(graph, 'a', 'c', new Set(['b']))
    expect(paths).toEqual([['a', 'd', 'c']])
  })
})

describe('pathMetrics', () => {
  it('sums latency and combines loss as a survival product', () => {
    const devices = [
      device({ id: 'a', latencyMs: 10, packetLossPct: 1 }),
      device({ id: 'b', latencyMs: 30, packetLossPct: 0 }),
      device({ id: 'c', latencyMs: 20, packetLossPct: 0 }),
    ]
    const result = pathMetrics(['a', 'b', 'c'], devices)
    expect(result.totalLatencyMs).toBe(60)
    expect(result.totalLossPct).toBeCloseTo(1, 5)
    expect(result.hops[1]?.contribution).toBeCloseTo(50, 5)
    expect(result.criticalHopId).toBe('b')
  })

  it('reports a broken path when a hop is offline', () => {
    const devices = [
      device({ id: 'a', latencyMs: 10 }),
      device({ id: 'b', status: 'offline' as DeviceStatus }),
    ]
    expect(pathMetrics(['a', 'b'], devices).status).toBe('broken')
  })

  it('degrades when loss crosses the threshold', () => {
    const devices = [
      device({ id: 'a', packetLossPct: 3 }),
      device({ id: 'b', packetLossPct: 0 }),
    ]
    expect(pathMetrics(['a', 'b'], devices).status).toBe('degraded')
  })
})

describe('trace', () => {
  it('returns the primary path and a detour around a broken hop', () => {
    const devices = [
      device({ id: 'a' }),
      device({ id: 'b', status: 'offline' as DeviceStatus }),
      device({ id: 'c' }),
      device({ id: 'd' }),
    ]
    // a-b-c primary (uses b) plus a-d-c detour (avoids b).
    const links = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'a', target: 'd' },
      { source: 'd', target: 'c' },
    ]
    const graph = buildAdjacency(devices, links)
    const result = trace(devices, 'a', 'c', graph)
    expect(result.found).toBe(true)
    expect(result.primary?.path).toEqual(['a', 'b', 'c'])
    expect(result.primary?.status).toBe('broken')
    expect(result.healthyDetour?.path).toEqual(['a', 'd', 'c'])
    expect(result.healthyDetour?.status).toBe('healthy')
  })

  it('reports not found when there is no route', () => {
    const devices = [device({ id: 'a' }), device({ id: 'b' })]
    const graph = buildAdjacency(devices, [])
    const result = trace(devices, 'a', 'b', graph)
    expect(result.found).toBe(false)
    expect(result.primary).toBeNull()
  })
})

describe('slowestHop', () => {
  it('finds the highest-latency hop', () => {
    const devices = [
      device({ id: 'a', latencyMs: 5 }),
      device({ id: 'b', latencyMs: 40 }),
      device({ id: 'c', latencyMs: 12 }),
    ]
    expect(slowestHop(pathMetrics(['a', 'b', 'c'], devices))?.deviceId).toBe(
      'b',
    )
  })
})
