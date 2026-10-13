import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  explainPath,
  physicalPath,
  reachability,
  reachabilityMatrix,
  whatIfPolicy,
  DEFAULT_REACH_OPTIONS,
} from '@/lib/reachability'
import type { PolicyRule } from '@/lib/policy'

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
    cpuPct: 10,
    memoryPct: 20,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

function rule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'r1',
    order: 0,
    action: 'allow',
    src: '*',
    dst: '*',
    port: 0,
    proto: 'any',
    enabled: true,
    ...overrides,
  }
}

// core(router) -> fw(firewall) -> srv(server) in one site; remote access point.
const DEVICES: Device[] = [
  device({ id: 'core', name: 'Core', type: 'router', site: 'HQ' }),
  device({ id: 'fw', name: 'Firewall', type: 'firewall', site: 'DC-A' }),
  device({ id: 'srv', name: 'Server', type: 'server', site: 'DC-A' }),
  device({ id: 'ap', name: 'Access Point', type: 'accessPoint', site: 'DC-A' }),
]

const ALLOW_ALL = [rule({ id: 'all', action: 'allow' })]

describe('physicalPath', () => {
  it('finds a path and is symmetric', () => {
    const path = physicalPath(DEVICES, 'srv', 'ap')
    expect(path).not.toBeNull()
    expect(path?.[0]).toBe('srv')
    expect(path?.at(-1)).toBe('ap')
    expect(physicalPath(DEVICES, 'ap', 'srv')).toEqual([...path!].reverse())
  })

  it('returns a single-node path for identical endpoints', () => {
    expect(physicalPath(DEVICES, 'srv', 'srv')).toEqual(['srv'])
  })
})

describe('reachability', () => {
  it('allows when a path exists and policy permits', () => {
    const result = reachability(DEVICES, ALLOW_ALL, 'srv', 'ap')
    expect(result.reachable).toBe(true)
    expect(result.reason).toBe('allowed')
  })

  it('denies when policy blocks (default deny)', () => {
    const result = reachability(DEVICES, [], 'srv', 'ap')
    expect(result.reachable).toBe(false)
    expect(result.reason).toBe('denied')
    expect(result.decision.rule).toBeNull()
  })

  it('reports no-path between disconnected inventories', () => {
    const isolated = [
      device({ id: 'a', site: 'A' }),
      device({ id: 'b', site: 'B' }),
    ]
    // Provide an explicit empty link set so the two nodes are disconnected.
    const result = reachability(
      isolated,
      ALLOW_ALL,
      'a',
      'b',
      DEFAULT_REACH_OPTIONS,
      [],
    )
    expect(result.reason).toBe('no-path')
  })
})

describe('reachabilityMatrix', () => {
  it('counts allowed, denied and no-path cells', () => {
    const matrix = reachabilityMatrix(DEVICES, ALLOW_ALL)
    expect(matrix.ids).toHaveLength(4)
    expect(matrix.cells[0][0]).toBe(false)
    expect(matrix.allowed).toBe(12)
    expect(matrix.denied).toBe(0)
    expect(matrix.noPath).toBe(0)
  })
})

describe('explainPath', () => {
  it('flags an offline hop', () => {
    const devices = DEVICES.map((d) =>
      d.id === 'fw' ? { ...d, status: 'offline' as const } : d,
    )
    const explanation = explainPath(devices, ALLOW_ALL, 'srv', 'ap')
    expect(explanation.found).toBe(true)
    expect(explanation.allowed).toBe(false)
    expect(explanation.reason).toBe('offline')
    expect(explanation.downHops).toContain('fw')
  })

  it('explains an allowed flow with its matching rule', () => {
    const explanation = explainPath(DEVICES, ALLOW_ALL, 'srv', 'ap')
    expect(explanation.allowed).toBe(true)
    expect(explanation.decision.rule?.id).toBe('all')
    expect(explanation.hops.map((h) => h.deviceId)).toContain('srv')
  })
})

describe('whatIfPolicy', () => {
  it('reports flows opened by a new allow rule', () => {
    const base = [rule({ id: 'block', order: 0, action: 'deny' })]
    const impact = whatIfPolicy(DEVICES, base, {
      order: -1,
      action: 'allow',
      src: '*',
      dst: '*',
      port: 0,
      proto: 'any',
      enabled: true,
    })
    expect(impact.opened.length).toBeGreaterThan(0)
    expect(impact.closed).toHaveLength(0)
  })
})
