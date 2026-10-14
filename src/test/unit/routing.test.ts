import { describe, expect, it } from 'vitest'
import type { Device, DeviceStatus } from '@/types'
import { mulberry32, hashSeed } from '@/simulation/random'
import {
  buildAutonomousSystems,
  buildBgpSessions,
  buildOspfAdjacencies,
  buildRoutingTables,
  convergenceTimeline,
  detectRoutingIssues,
  formatRoutingHealth,
  isRoutingCapable,
  LOCAL_ASN,
  ospfCost,
  routerIdFor,
  routingSummary,
  type BgpSession,
  type OspfAdjacency,
  type RoutingTable,
} from '@/lib/routing'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATUSES: DeviceStatus[] = ['online', 'degraded', 'offline']

function makeDevice(overrides: Partial<Device> & { id: string }): Device {
  return {
    name: overrides.id,
    type: 'router',
    site: 'HQ - Floor 1',
    ip: '10.0.0.1',
    mac: '00:00:00:00:00:00',
    status: 'online',
    tags: [],
    latencyMs: 10,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 20,
    memoryPct: 40,
    uptimeSec: 100_000,
    lastSeen: 0,
    ...overrides,
  }
}

function buildFleet(): Device[] {
  const rng = mulberry32(hashSeed('routing-fleet'))
  const sites = [
    'HQ - Floor 1',
    'HQ - Floor 2',
    'Data Center A',
    'Data Center B',
  ]
  const devices: Device[] = []
  for (let i = 0; i < 16; i += 1) {
    const type: Device['type'] =
      i % 4 === 0 ? 'router' : i % 4 === 1 ? 'firewall' : 'switch'
    devices.push(
      makeDevice({
        id: `dev-${i}`,
        type,
        site: sites[i % sites.length]!,
        status: STATUSES[rng.int(0, 2)]!,
        latencyMs: rng.range(2, 40),
      }),
    )
  }
  // Guarantee at least one healthy router so the graph isn't empty.
  devices[0] = makeDevice({ id: 'dev-0', type: 'router', status: 'online' })
  return devices
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('routerIdFor', () => {
  it('is deterministic for the same device id', () => {
    expect(routerIdFor('dev-1')).toBe(routerIdFor('dev-1'))
  })

  it('differs across devices', () => {
    expect(routerIdFor('dev-1')).not.toBe(routerIdFor('dev-2'))
  })

  it('returns a dotted-decimal string with 4 octets', () => {
    const parts = routerIdFor('dev-1').split('.')
    expect(parts).toHaveLength(4)
    for (const part of parts) {
      const value = Number.parseInt(part, 10)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(255)
    }
  })
})

describe('ospfCost', () => {
  it('scales with latency and is always >= 1', () => {
    expect(ospfCost(0)).toBe(1)
    expect(ospfCost(5)).toBe(50)
    expect(ospfCost(0.01)).toBe(1)
  })
})

describe('isRoutingCapable', () => {
  it('only routers are routing-capable', () => {
    expect(isRoutingCapable('router')).toBe(true)
    expect(isRoutingCapable('switch')).toBe(false)
    expect(isRoutingCapable('firewall')).toBe(false)
    expect(isRoutingCapable('server')).toBe(false)
  })
})

describe('buildAutonomousSystems', () => {
  it('includes the local AS plus 4 peers', () => {
    const systems = buildAutonomousSystems()
    expect(systems).toHaveLength(5)
    expect(systems[0]!.asn).toBe(LOCAL_ASN)
    expect(systems[0]!.local).toBe(true)
    expect(systems.filter((s) => !s.local)).toHaveLength(4)
  })
})

describe('buildBgpSessions', () => {
  const devices = buildFleet()

  it('is deterministic for the same seed', () => {
    const a = buildBgpSessions(devices, 7)
    const b = buildBgpSessions(devices, 7)
    expect(a).toEqual(b)
  })

  it('varies across different seeds', () => {
    const a = buildBgpSessions(devices, 1)
    const b = buildBgpSessions(devices, 2)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
  })

  it('returns only local AS sessions', () => {
    for (const session of buildBgpSessions(devices, 3)) {
      expect(session.localAsn).toBe(LOCAL_ASN)
    }
  })

  it('assigns a valid state to every session', () => {
    for (const session of buildBgpSessions(devices, 4)) {
      expect(['established', 'idle', 'active']).toContain(session.state)
    }
  })

  it('non-established sessions carry no prefixes and zero hold time', () => {
    for (const session of buildBgpSessions(devices, 5)) {
      if (session.state !== 'established') {
        expect(session.prefixesReceived).toBe(0)
        expect(session.prefixesSent).toBe(0)
        expect(session.holdTimeSec).toBe(0)
      }
    }
  })

  it('returns an empty list for an empty fleet', () => {
    expect(buildBgpSessions([], 0)).toEqual([])
  })
})

describe('buildOspfAdjacencies', () => {
  const devices = buildFleet()

  it('produces only same-area router-to-router links', () => {
    for (const adjacency of buildOspfAdjacencies(devices)) {
      expect(adjacency.aId).not.toBe(adjacency.bId)
      expect(adjacency.area).toBeGreaterThanOrEqual(0)
      expect(adjacency.area).toBeLessThanOrEqual(2)
    }
  })

  it('is deterministic', () => {
    expect(buildOspfAdjacencies(devices)).toEqual(buildOspfAdjacencies(devices))
  })

  it('returns an empty list when there are no routers', () => {
    const switches = [0, 1, 2].map((i) =>
      makeDevice({ id: `sw-${i}`, type: 'switch' }),
    )
    expect(buildOspfAdjacencies(switches)).toEqual([])
  })
})

describe('buildRoutingTables', () => {
  const devices = buildFleet()
  const bgp = buildBgpSessions(devices, 11)
  const ospf = buildOspfAdjacencies(devices)
  const tables = buildRoutingTables(devices, ospf, bgp, 11)

  it('returns one table per router', () => {
    const routers = devices.filter((d) => d.type === 'router')
    expect(tables).toHaveLength(routers.length)
  })

  it('every table has at least a connected and a default route', () => {
    for (const table of tables) {
      const protocols = new Set(table.routes.map((r) => r.protocol))
      expect(protocols.has('connected')).toBe(true)
      expect(protocols.has('bgp') || protocols.has('static')).toBe(true)
    }
  })

  it('routes are ordered longest-prefix first', () => {
    for (const table of tables) {
      const prefixes = table.routes.map((r) =>
        Number.parseInt(r.prefix.split('/')[1] ?? '32', 10),
      )
      const sorted = [...prefixes].sort((a, b) => b - a)
      expect(prefixes).toEqual(sorted)
    }
  })

  it('is deterministic for the same inputs', () => {
    const again = buildRoutingTables(devices, ospf, bgp, 11)
    expect(again).toEqual(tables)
  })

  it('OSPF routes always have a next hop', () => {
    for (const table of tables) {
      for (const route of table.routes) {
        if (route.protocol === 'ospf') {
          expect(route.nextHopId).not.toBeNull()
        }
      }
    }
  })

  it('every OSPF route points at a router that exists', () => {
    const routerIds = new Set(
      devices.filter((d) => d.type === 'router').map((d) => d.id),
    )
    for (const table of tables) {
      for (const route of table.routes) {
        if (route.protocol === 'ospf' && route.nextHopId) {
          expect(routerIds.has(route.nextHopId)).toBe(true)
        }
      }
    }
  })
})

describe('detectRoutingIssues', () => {
  const devices = buildFleet()

  it('flags non-established BGP sessions', () => {
    const sessions: BgpSession[] = [
      {
        id: 'bgp-1',
        localDeviceId: 'dev-0',
        localDeviceName: 'dev-0',
        localAsn: LOCAL_ASN,
        remoteAsn: 64512,
        remotePeer: 'Acme',
        state: 'idle',
        prefixesReceived: 0,
        prefixesSent: 0,
        holdTimeSec: 0,
      },
    ]
    const issues = detectRoutingIssues(sessions, [], [], devices, 1)
    expect(issues.some((i) => i.kind === 'bgp-down')).toBe(true)
  })

  it('flags degraded OSPF adjacencies', () => {
    const adjacencies: OspfAdjacency[] = [
      {
        id: 'ospf-1',
        aId: 'dev-0',
        aName: 'dev-0',
        bId: 'dev-1',
        bName: 'dev-1',
        area: 0,
        state: 'down',
        cost: 100,
      },
    ]
    const issues = detectRoutingIssues([], adjacencies, [], devices, 1)
    expect(issues.some((i) => i.kind === 'ospf-adjacency-down')).toBe(true)
  })

  it('sorts issues by severity', () => {
    const sessions: BgpSession[] = [
      {
        id: 'bgp-1',
        localDeviceId: 'dev-0',
        localDeviceName: 'dev-0',
        localAsn: LOCAL_ASN,
        remoteAsn: 64512,
        remotePeer: 'Acme',
        state: 'active',
        prefixesReceived: 0,
        prefixesSent: 0,
        holdTimeSec: 0,
      },
      {
        id: 'bgp-2',
        localDeviceId: 'dev-0',
        localDeviceName: 'dev-0',
        localAsn: LOCAL_ASN,
        remoteAsn: 64513,
        remotePeer: 'Northwind',
        state: 'idle',
        prefixesReceived: 0,
        prefixesSent: 0,
        holdTimeSec: 0,
      },
    ]
    const issues = detectRoutingIssues(sessions, [], [], devices, 2)
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const
    const severities = issues.map((i) => rank[i.severity])
    const sorted = [...severities].sort((a, b) => a - b)
    expect(severities).toEqual(sorted)
  })

  it('produces issue ids that are unique', () => {
    const issues = detectRoutingIssues(
      buildBgpSessions(devices, 3),
      buildOspfAdjacencies(devices),
      buildRoutingTables(
        devices,
        buildOspfAdjacencies(devices),
        buildBgpSessions(devices, 3),
        3,
      ),
      devices,
      3,
    )
    const ids = issues.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('convergenceTimeline', () => {
  const devices = buildFleet()
  const issues = detectRoutingIssues(
    buildBgpSessions(devices, 5),
    buildOspfAdjacencies(devices),
    buildRoutingTables(
      devices,
      buildOspfAdjacencies(devices),
      buildBgpSessions(devices, 5),
      5,
    ),
    devices,
    5,
  )

  it('is deterministic for the same seed', () => {
    expect(convergenceTimeline(issues, 9)).toEqual(
      convergenceTimeline(issues, 9),
    )
  })

  it('only includes control-plane failure kinds', () => {
    for (const event of convergenceTimeline(issues, 9)) {
      expect(event.seconds).toBeGreaterThan(0)
      expect(event.prefixesAffected).toBeGreaterThan(0)
    }
  })

  it('sorts by descending duration', () => {
    const events = convergenceTimeline(issues, 9)
    const durations = events.map((e) => e.seconds)
    const sorted = [...durations].sort((a, b) => b - a)
    expect(durations).toEqual(sorted)
  })
})

describe('routingSummary', () => {
  const devices = buildFleet()
  const bgp = buildBgpSessions(devices, 8)
  const ospf = buildOspfAdjacencies(devices)
  const tables: RoutingTable[] = buildRoutingTables(devices, ospf, bgp, 8)
  const issues = detectRoutingIssues(bgp, ospf, tables, devices, 8)
  const summary = routingSummary(tables, bgp, ospf, issues)

  it('counts routers equal to the table count', () => {
    expect(summary.routers).toBe(tables.length)
  })

  it('tracks BGP state distribution that sums to total sessions', () => {
    const total =
      summary.bgpByState.established +
      summary.bgpByState.idle +
      summary.bgpByState.active
    expect(total).toBe(bgp.length)
  })

  it('tracks OSPF state distribution that sums to total adjacencies', () => {
    const total =
      summary.ospfByState.full +
      summary.ospfByState['two-way'] +
      summary.ospfByState.down
    expect(total).toBe(ospf.length)
  })

  it('health is within 0-100 and grade matches thresholds', () => {
    expect(summary.health).toBeGreaterThanOrEqual(0)
    expect(summary.health).toBeLessThanOrEqual(100)
    if (summary.health >= 85) expect(summary.grade).toBe('healthy')
    else if (summary.health >= 60) expect(summary.grade).toBe('degraded')
    else expect(summary.grade).toBe('critical')
  })

  it('avgRoutesPerRouter matches totalRoutes / routers', () => {
    const expected =
      tables.length > 0
        ? Math.round((summary.totalRoutes / tables.length) * 10) / 10
        : 0
    expect(summary.avgRoutesPerRouter).toBeCloseTo(expected, 1)
  })
})

describe('formatRoutingHealth', () => {
  it('formats an integer percentage', () => {
    expect(formatRoutingHealth(100)).toBe('100%')
    expect(formatRoutingHealth(0)).toBe('0%')
  })
})
