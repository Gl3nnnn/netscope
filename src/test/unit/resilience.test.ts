import { describe, expect, it } from 'vitest'
import type { Device, DeviceType, Thresholds } from '@/types'
import { buildAdjacency } from '@/lib/tracer'
import {
  articulationPoints,
  chaosPresets,
  describeChaos,
  detectSpofs,
  pickCore,
  redundancyScore,
  resilienceGrade,
  resilienceScore,
  simulateChaos,
} from '@/lib/resilience'
import type { BusinessService } from '@/lib/services'

const THRESHOLDS: Thresholds = {
  latencyMs: 120,
  packetLossPct: 1,
  availabilityPct: 99,
}

function device(
  id: string,
  type: DeviceType,
  site: string,
  throughputMbps = 600,
): Device {
  return {
    id,
    name: `${type} ${id}`,
    type,
    site,
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps,
    capacityMbps: 2000,
    cpuPct: 48,
    memoryPct: 70,
    uptimeSec: 1000,
    lastSeen: 0,
  }
}

/**
 * Topology: core router r1 feeds two site hubs (s1, s2), each with one member.
 * Articulation points are r1, s1 and s2; the members are leaves.
 */
function topology(): Device[] {
  return [
    device('r1', 'router', 'DC'),
    device('s1', 'switch', 'SiteA'),
    device('a1', 'accessPoint', 'SiteA', 100),
    device('s2', 'switch', 'SiteB'),
    device('a2', 'accessPoint', 'SiteB', 100),
  ]
}

function service(overrides: Partial<BusinessService> = {}): BusinessService {
  return {
    id: 'svc-1',
    name: 'Payments API',
    description: '',
    tier: 'p1',
    impact: 'revenue',
    deviceIds: [],
    siteNames: ['SiteA'],
    ...overrides,
  }
}

describe('articulationPoints', () => {
  it('finds the core and site hubs but not the leaves', () => {
    const graph = buildAdjacency(topology())
    expect(articulationPoints(graph)).toEqual(['r1', 's1', 's2'])
  })

  it('returns nothing for an empty graph', () => {
    expect(articulationPoints(buildAdjacency([]))).toEqual([])
  })
})

describe('pickCore', () => {
  it('prefers the most connected node then router type', () => {
    const devices = topology()
    const core = pickCore(devices, buildAdjacency(devices).adjacency)
    expect(core?.id).toBe('r1')
  })
})

describe('detectSpofs', () => {
  it('grades the core critical and isolates stranded members', () => {
    const devices = topology()
    const report = detectSpofs({ devices })
    expect(report.coreId).toBe('r1')
    const core = report.spofs.find((spof) => spof.deviceId === 'r1')
    expect(core?.severity).toBe('critical')
    expect(core?.isolatedCount).toBe(4)
    const hub = report.spofs.find((spof) => spof.deviceId === 's1')
    expect(hub?.isolated).toEqual(['a1'])
    expect(hub?.severity).toBe('medium')
    expect(report.redundantCount).toBe(2)
    expect(report.score).toBe(40)
  })

  it('is fully resilient for an empty fleet', () => {
    const report = detectSpofs({ devices: [] })
    expect(report.spofs).toEqual([])
    expect(report.score).toBe(100)
  })
})

describe('redundancyScore', () => {
  it('counts nodes with more than one neighbour', () => {
    const graph = buildAdjacency(topology())
    expect(redundancyScore(graph)).toBeCloseTo(3 / 5, 5)
  })
})

describe('resilienceScore', () => {
  it('blends availability, redundancy and service health', () => {
    const devices = topology()
    const score = resilienceScore({
      devices,
      services: [],
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(score).toBe(88)
  })

  it('drops when devices go offline', () => {
    const devices = topology().map((item) =>
      item.id === 'a1' ? { ...item, status: 'offline' as const } : item,
    )
    const score = resilienceScore({
      devices,
      services: [],
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(score).toBeLessThan(88)
  })

  it('is a perfect 100 for an empty fleet', () => {
    expect(
      resilienceScore({
        devices: [],
        services: [],
        incidents: [],
        thresholds: THRESHOLDS,
      }),
    ).toBe(100)
  })
})

describe('resilienceGrade', () => {
  it('maps scores onto grades', () => {
    expect(resilienceGrade(90)).toBe('strong')
    expect(resilienceGrade(60)).toBe('fair')
    expect(resilienceGrade(40)).toBe('fragile')
    expect(resilienceGrade(10)).toBe('critical')
  })
})

describe('simulateChaos', () => {
  it('takes a targeted site offline and worsens its service', () => {
    const devices = topology()
    const before = devices.map((item) => ({ ...item }))
    const result = simulateChaos({
      devices,
      services: [service()],
      incidents: [],
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 1_000_000,
      faults: [{ kind: 'site-outage', target: 'SiteA' }],
      steps: 3,
      seed: 42,
    })
    expect(result.offlineDeviceIds).toContain('a1')
    expect(result.services[0].after).not.toBe('operational')
    expect(result.services[0].worsened).toBe(true)
    expect(result.scoreDrop).toBeLessThanOrEqual(0)
    // Original devices are left untouched (clone-only).
    expect(devices).toEqual(before)
  })

  it('returns a neutral result with no faults', () => {
    const result = simulateChaos({
      devices: topology(),
      services: [],
      incidents: [],
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 1_000_000,
      faults: [],
      steps: 2,
      seed: 7,
    })
    expect(result.offlineDeviceIds).toEqual([])
    expect(result.degradedServices).toBe(0)
  })
})

describe('chaosPresets', () => {
  it('builds presets anchored on the core and busiest site', () => {
    const devices = topology()
    const presets = chaosPresets({ devices })
    const core = presets.find((preset) => preset.id === 'core-outage')
    expect(core?.faults[0]).toEqual({ kind: 'device-offline', target: 'r1' })
    const site = presets.find((preset) => preset.id === 'site-outage')
    expect(site?.faults[0]).toEqual({ kind: 'site-outage', target: 'SiteA' })
    expect(
      presets.find((preset) => preset.id === 'traffic-spike')?.trafficScale,
    ).toBe(1)
    expect(presets.some((preset) => preset.id === 'worst-case')).toBe(true)
  })
})

describe('describeChaos', () => {
  it('summarises faults and traffic changes', () => {
    expect(
      describeChaos({
        id: 'x',
        name: 'x',
        description: '',
        faults: [{ kind: 'device-offline', target: 'r1' }],
        trafficScale: 0.5,
      }),
    ).toBe('device r1 · +50% traffic')
  })
})
