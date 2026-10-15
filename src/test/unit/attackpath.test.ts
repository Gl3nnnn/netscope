import { describe, expect, it } from 'vitest'
import type { Device, Severity } from '@/types'
import type { BusinessService } from '@/lib/services'
import {
  MAX_PATHS,
  SEVERITY_WEIGHT,
  attackSummary,
  bandFor,
  buildExposures,
  chokePoints,
  findAttackPaths,
  runAttackPaths,
  serviceMembers,
  shortestPath,
  type Exposure,
} from '@/lib/attackpath'
import { scanFleet } from '@/lib/vulnerabilities'
import { seedCertificates } from '@/lib/certificates'
import { deriveLinks } from '@/lib/topology'

const SEED = 7
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

function makeDevice(overrides: Partial<Device> & { id: string }): Device {
  return {
    name: overrides.id,
    type: 'server',
    site: 'HQ - Floor 1',
    ip: '10.0.0.1',
    mac: '00:00:00:00:00:00',
    status: 'online',
    tags: [],
    latencyMs: 8,
    packetLossPct: 0,
    availabilityPct: 99.9,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 30,
    memoryPct: 45,
    uptimeSec: 900_000,
    lastSeen: 0,
    ...overrides,
  }
}

const DEVICES: Device[] = [
  makeDevice({ id: 'r1', name: 'r1', type: 'router', site: 'HQ - Floor 1' }),
  makeDevice({
    id: 'fw1',
    name: 'fw1',
    type: 'firewall',
    site: 'HQ - Floor 1',
  }),
  makeDevice({ id: 'srv1', name: 'srv1', site: 'Data Center A' }),
  makeDevice({ id: 'sw1', name: 'sw1', type: 'switch', site: 'Branch - West' }),
  makeDevice({ id: 'srv2', name: 'srv2', site: 'Branch - West' }),
  makeDevice({
    id: 'ap1',
    name: 'ap1',
    type: 'accessPoint',
    site: 'Branch - East',
  }),
]

const SERVICES: BusinessService[] = [
  {
    id: 'svc-p1',
    name: 'Checkout',
    description: 'Checkout flow',
    tier: 'p1',
    impact: 'revenue',
    deviceIds: ['srv1'],
    siteNames: [],
  },
  {
    id: 'svc-p4',
    name: 'Internal wiki',
    description: 'Wiki',
    tier: 'p4',
    impact: 'internal',
    deviceIds: ['srv2'],
    siteNames: [],
  },
]

function exposure(
  overrides: Partial<Exposure> & { deviceId: string },
): Exposure {
  return {
    id: `${overrides.deviceId}:test`,
    deviceName: overrides.deviceId,
    kind: 'open-port',
    detail: 'Exposed management port',
    severity: 'high',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

describe('serviceMembers', () => {
  it('unions explicit device ids with site-wide devices', () => {
    const members = serviceMembers(
      {
        ...SERVICES[0]!,
        deviceIds: ['srv2'],
        siteNames: ['Data Center A'],
      },
      DEVICES,
    )
    const ids = members.map((device) => device.id).sort()
    expect(ids).toEqual(['srv1', 'srv2'])
  })

  it('returns only owned devices when no sites are listed', () => {
    const members = serviceMembers(SERVICES[0]!, DEVICES)
    expect(members.map((device) => device.id)).toEqual(['srv1'])
  })
})

describe('shortestPath', () => {
  const graph = new Map<string, string[]>([
    ['a', ['b']],
    ['b', ['a', 'c']],
    ['c', ['b', 'd']],
    ['d', ['c']],
    ['z', []],
  ])

  it('finds the hop-minimal route within budget', () => {
    expect(shortestPath(graph, 'a', 'd', 4)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('respects the hop budget and returns null when unreachable', () => {
    expect(shortestPath(graph, 'a', 'd', 2)).toBeNull()
    expect(shortestPath(graph, 'a', 'z', 4)).toBeNull()
  })

  it('handles trivial same-node paths', () => {
    expect(shortestPath(graph, 'a', 'a', 0)).toEqual(['a'])
  })
})

describe('bandFor and weights', () => {
  it('maps risk to bands at the documented thresholds', () => {
    expect(bandFor(75)).toBe('critical')
    expect(bandFor(74.9)).toBe('high')
    expect(bandFor(55)).toBe('high')
    expect(bandFor(54.9)).toBe('medium')
    expect(bandFor(35)).toBe('medium')
    expect(bandFor(34.9)).toBe('low')
    expect(SEVERITY_WEIGHT.critical).toBeGreaterThan(SEVERITY_WEIGHT.low)
  })
})

// ---------------------------------------------------------------------------
// Exposures
// ---------------------------------------------------------------------------

describe('buildExposures', () => {
  it('turns critical open CVEs into exposures and ignores patched ones', () => {
    const vulns = scanFleet(DEVICES, SEED)
    const first = vulns[0]!
    const critical = [
      { ...first, cveId: 'CVE-2026-99999', cvss: 9.8, status: 'open' as const },
      {
        ...first,
        cveId: 'CVE-2026-88888',
        cvss: 9.1,
        status: 'patched' as const,
      },
    ]
    const certs = seedCertificates(DEVICES, SEED)
    const exposures = buildExposures(DEVICES, critical, certs)
    const vulnExposures = exposures.filter(
      (item) => item.kind === 'critical-vuln',
    )
    expect(vulnExposures).toHaveLength(1)
    expect(vulnExposures[0]!.detail).toContain('CVE-2026-99999')
    expect(vulnExposures[0]!.severity).toBe('critical')
  })

  it('flags expired certificates on real devices', () => {
    const vulns = scanFleet(DEVICES, SEED)
    const certs = seedCertificates(DEVICES, SEED).map((cert, index) =>
      index === 0 ? { ...cert, daysToExpiry: -3 } : cert,
    )
    const exposures = buildExposures(DEVICES, vulns, certs)
    const expired = exposures.filter((item) => item.kind === 'expired-cert')
    expect(expired.length).toBeGreaterThan(0)
    for (const item of expired) {
      expect(DEVICES.map((device) => device.id)).toContain(item.deviceId)
      expect(item.severity).toBe('high')
    }
  })

  it('emits unique ids and only router/firewall port exposures', () => {
    const exposures = buildExposures(
      DEVICES,
      scanFleet(DEVICES, SEED),
      seedCertificates(DEVICES, SEED),
    )
    const ids = new Set(exposures.map((item) => item.id))
    expect(ids.size).toBe(exposures.length)
    for (const item of exposures.filter(
      (entry) => entry.kind === 'open-port',
    )) {
      const device = DEVICES.find((d) => d.id === item.deviceId)!
      expect(['router', 'firewall']).toContain(device.type)
    }
    for (const item of exposures) {
      expect(SEVERITIES).toContain(item.severity)
    }
  })
})

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

describe('findAttackPaths', () => {
  const exposures: Exposure[] = [
    exposure({ id: 'fw1:open', deviceId: 'fw1', severity: 'high' }),
    exposure({ id: 'sw1:vuln', deviceId: 'sw1', severity: 'critical' }),
  ]

  it('chains entry → lateral → target toward P1 services only', () => {
    const paths = findAttackPaths(DEVICES, exposures, SERVICES)
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      expect(path.tier === 'p1' || path.tier === 'p2').toBe(true)
      expect(path.steps[0]!.kind).toBe('entry')
      expect(path.steps[path.steps.length - 1]!.kind).toBe('target')
      expect(path.lateralHops).toBe(path.steps.length - 2)
      expect(path.risk).toBeGreaterThanOrEqual(0)
      expect(path.risk).toBeLessThanOrEqual(100)
      expect(path.band).toBe(bandFor(path.risk))
    }
  })

  it('ranks worst-first and stays under the path cap', () => {
    const paths = findAttackPaths(DEVICES, exposures, SERVICES)
    expect(paths.length).toBeLessThanOrEqual(MAX_PATHS)
    for (let i = 1; i < paths.length; i += 1) {
      expect(paths[i]!.risk).toBeLessThanOrEqual(paths[i - 1]!.risk)
    }
  })

  it('attaches mitigations that reference the path exposures', () => {
    const paths = findAttackPaths(DEVICES, exposures, SERVICES)
    const viaFirewall = paths.find((path) => path.entryId === 'fw1')!
    expect(viaFirewall).toBeDefined()
    expect(viaFirewall.mitigations.some((item) => item.includes('fw1'))).toBe(
      true,
    )
  })

  it('finds nothing when no devices are exposed', () => {
    expect(findAttackPaths(DEVICES, [], SERVICES)).toEqual([])
  })
})

describe('chokePoints', () => {
  it('counts lateral intermediates and shares of the path set', () => {
    const paths = findAttackPaths(
      DEVICES,
      [exposure({ id: 'fw1:open', deviceId: 'fw1' })],
      SERVICES,
    )
    const points = chokePoints(paths, DEVICES)
    for (const point of points) {
      expect(point.pathCount).toBeGreaterThan(0)
      expect(point.sharePct).toBeGreaterThan(0)
      expect(point.sharePct).toBeLessThanOrEqual(100)
      expect(DEVICES.map((device) => device.id)).toContain(point.deviceId)
    }
    const totalLateral = paths.reduce((sum, path) => sum + path.lateralHops, 0)
    const counted = points.reduce((sum, point) => sum + point.pathCount, 0)
    expect(counted).toBe(totalLateral)
  })

  it('returns empty when there are no paths', () => {
    expect(chokePoints([], DEVICES)).toEqual([])
  })
})

describe('attackSummary', () => {
  it('partitions paths into bands and averages risk', () => {
    const paths = findAttackPaths(
      DEVICES,
      [
        exposure({ id: 'fw1:open', deviceId: 'fw1' }),
        exposure({ id: 'sw1:vuln', deviceId: 'sw1', severity: 'critical' }),
      ],
      SERVICES,
    )
    const summary = attackSummary(paths, 2)
    expect(summary.paths).toBe(paths.length)
    expect(summary.critical + summary.high + summary.medium + summary.low).toBe(
      paths.length,
    )
    expect(summary.exposures).toBe(2)
    expect(summary.topRisk).toBe(paths[0]?.risk ?? 0)
    expect(summary.avgRisk).toBeGreaterThan(0)
  })

  it('returns zeroes for an empty path set', () => {
    expect(attackSummary([], 3)).toEqual({
      paths: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      exposures: 3,
      topRisk: 0,
      avgRisk: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

describe('runAttackPaths', () => {
  it('wires the live engines and stays deterministic', () => {
    const input = {
      devices: DEVICES,
      seed: SEED,
      statuses: {},
      certOverrides: {},
      services: SERVICES,
    }
    const a = runAttackPaths(input)
    const b = runAttackPaths(input)
    expect(a).toEqual(b)
    expect(a.exposures.length).toBeGreaterThanOrEqual(0)
    expect(a.paths.length).toBeLessThanOrEqual(MAX_PATHS)
    expect(a.summary.paths).toBe(a.paths.length)
    expect(a.summary.exposures).toBe(a.exposures.length)
    const links = deriveLinks(DEVICES)
    expect(links.length).toBeGreaterThan(0)
  })

  it('respects certificate overrides as an exposure source', () => {
    const certs = seedCertificates(DEVICES, SEED)
    const overrides = {
      [certs[0]!.id]: { daysToExpiry: -10 },
    }
    const result = runAttackPaths({
      devices: DEVICES,
      seed: SEED,
      statuses: {},
      certOverrides: overrides,
      services: SERVICES,
    })
    expect(result.exposures.some((item) => item.kind === 'expired-cert')).toBe(
      true,
    )
  })

  it('exposes fewer risks when every CVE is patched away', () => {
    const vulns = scanFleet(DEVICES, SEED)
    const statuses = Object.fromEntries(
      vulns.map((vuln) => [vuln.id, 'patched' as const]),
    )
    const patched = runAttackPaths({
      devices: DEVICES,
      seed: SEED,
      statuses,
      certOverrides: {},
      services: SERVICES,
    })
    expect(
      patched.exposures.filter((item) => item.kind === 'critical-vuln'),
    ).toHaveLength(0)
  })
})
