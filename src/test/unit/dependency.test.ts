import { describe, expect, it } from 'vitest'
import type { Device, DeviceType } from '@/types'
import {
  blastRadius,
  buildGraph,
  correlateRootCause,
  impactedDeviceCount,
  type DepGraph,
} from '@/lib/dependency'
import { deriveLinks, type TopoLink } from '@/lib/topology'

function device(id: string, type: DeviceType, site: string): Device {
  return {
    id,
    name: id.toUpperCase(),
    type,
    site,
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
  }
}

const links: TopoLink[] = [
  { source: 'core', target: 'hub' },
  { source: 'core', target: 'h2' },
  { source: 'hub', target: 'a' },
  { source: 'hub', target: 'b' },
  { source: 'h2', target: 'c' },
]

function graph(): DepGraph {
  const devices = ['core', 'hub', 'h2', 'a', 'b', 'c'].map((id) =>
    device(id, 'server', 'HQ'),
  )
  return buildGraph(devices, links)
}

const sort = (ids: string[]) => [...ids].sort()

describe('buildGraph', () => {
  it('records both edge directions', () => {
    const g = graph()
    expect(g.edges.get('core')).toEqual(['hub', 'h2'])
    expect(g.reverse.get('a')).toEqual(['hub'])
  })
})

describe('blastRadius', () => {
  it('walks downward from a hub', () => {
    expect(sort(blastRadius(graph(), 'hub'))).toEqual(['a', 'b'])
  })

  it('covers the whole fleet from the core', () => {
    expect(sort(blastRadius(graph(), 'core'))).toEqual([
      'a',
      'b',
      'c',
      'h2',
      'hub',
    ])
  })

  it('walks upward from a leaf', () => {
    expect(sort(blastRadius(graph(), 'a', 'upstream'))).toEqual(['core', 'hub'])
  })

  it('returns nothing for an isolated node', () => {
    expect(blastRadius(graph(), 'a')).toEqual([])
  })

  it('is cycle-safe', () => {
    const devices = [device('x', 'server', 'S'), device('y', 'server', 'S')]
    const g = buildGraph(devices, [
      { source: 'x', target: 'y' },
      { source: 'y', target: 'x' },
    ])
    expect(sort(blastRadius(g, 'x'))).toEqual(['y'])
  })
})

describe('impactedDeviceCount', () => {
  it('counts the downstream set', () => {
    expect(impactedDeviceCount(graph(), 'hub')).toBe(2)
    expect(impactedDeviceCount(graph(), 'a')).toBe(0)
  })
})

describe('correlateRootCause', () => {
  const devices = ['core', 'hub', 'h2', 'a', 'b', 'c'].map((id) =>
    device(id, 'server', 'HQ'),
  )

  it('ranks the shared upstream as the top root cause', () => {
    const g = buildGraph(devices, links)
    const results = correlateRootCause({
      devices,
      graph: g,
      affected: ['a', 'b', 'c'],
    })
    expect(results[0].deviceId).toBe('core')
    expect(results[0].affected).toHaveLength(3)
  })

  it('prefers the smaller shared hub when it covers everything', () => {
    const g = buildGraph(devices, links)
    const results = correlateRootCause({
      devices,
      graph: g,
      affected: ['a', 'b'],
    })
    expect(results[0].deviceId).toBe('hub')
  })

  it('returns nothing when no devices are impacted', () => {
    expect(
      correlateRootCause({ devices, graph: graph(), affected: [] }),
    ).toEqual([])
  })

  it('finds a shared upstream for leaf-only outages', () => {
    const results = correlateRootCause({
      devices,
      graph: graph(),
      affected: ['a', 'c'],
    })
    expect(results[0].deviceId).toBe('core')
  })

  it('respects the result limit', () => {
    const results = correlateRootCause({
      devices,
      graph: graph(),
      affected: ['a', 'b', 'c', 'hub', 'h2', 'core'],
      limit: 1,
    })
    expect(results).toHaveLength(1)
  })
})

describe('topology re-export', () => {
  it('still derives links from inventory', () => {
    expect(
      deriveLinks([device('r1', 'router', 'HQ'), device('s1', 'server', 'HQ')]),
    ).toHaveLength(1)
  })
})
