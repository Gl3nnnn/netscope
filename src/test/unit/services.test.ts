import { describe, expect, it } from 'vitest'
import type { Device, Incident, MetricSample, Thresholds } from '@/types'
import {
  businessImpactSummary,
  incidentBusinessImpact,
  resolveServiceDevices,
  serviceCoversDevice,
  serviceHealth,
  serviceHealthAll,
  serviceUptimePct,
  type BusinessService,
} from '@/lib/services'

const THRESHOLDS: Thresholds = {
  latencyMs: 100,
  packetLossPct: 2,
  availabilityPct: 99,
}

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: 'Core Router',
    type: 'router',
    site: 'Data Center A',
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

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'Outage',
    description: '',
    severity: 'critical',
    status: 'open',
    deviceIds: ['d1'],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function service(overrides: Partial<BusinessService> = {}): BusinessService {
  return {
    id: 's1',
    name: 'Payments API',
    description: 'Customer payments',
    tier: 'p1',
    impact: 'revenue',
    deviceIds: [],
    siteNames: ['Data Center A'],
    ...overrides,
  }
}

describe('resolveServiceDevices', () => {
  it('merges explicit devices and site members without duplicates', () => {
    const devices = [
      device({ id: 'a', site: 'Data Center A' }),
      device({ id: 'b', site: 'Data Center A' }),
      device({ id: 'c', site: 'HQ - Floor 1' }),
    ]
    const resolved = resolveServiceDevices(
      service({ deviceIds: ['a', 'c'], siteNames: ['Data Center A'] }),
      devices,
    )
    expect(resolved.map((d) => d.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('reports membership by device or site', () => {
    const svc = service({ deviceIds: ['x'], siteNames: ['HQ - Floor 1'] })
    expect(serviceCoversDevice(svc, device({ id: 'x', site: 'DC' }))).toBe(true)
    expect(
      serviceCoversDevice(svc, device({ id: 'y', site: 'HQ - Floor 1' })),
    ).toBe(true)
    expect(serviceCoversDevice(svc, device({ id: 'z', site: 'DC' }))).toBe(
      false,
    )
  })
})

describe('serviceHealth', () => {
  const members = [
    device({ id: 'a', status: 'online' }),
    device({ id: 'b', status: 'online' }),
    device({ id: 'c', status: 'online' }),
    device({ id: 'd', status: 'online' }),
  ]

  it('is operational when every member is online', () => {
    const health = serviceHealth({
      service: service(),
      devices: members,
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(health.status).toBe('operational')
    expect(health.total).toBe(4)
  })

  it('is degraded when a member is degraded', () => {
    const health = serviceHealth({
      service: service(),
      devices: [
        device({ id: 'a', status: 'online' }),
        device({ id: 'b', status: 'degraded' }),
      ],
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(health.status).toBe('degraded')
    expect(health.degradedCount).toBe(1)
  })

  it('is a partial outage when some members are offline', () => {
    const health = serviceHealth({
      service: service(),
      devices: [
        device({ id: 'a', status: 'online' }),
        device({ id: 'b', status: 'online' }),
        device({ id: 'c', status: 'offline' }),
        device({ id: 'd', status: 'online' }),
      ],
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(health.status).toBe('partial')
    expect(health.offendingDeviceIds).toContain('c')
  })

  it('is a major outage when at least half the members are offline', () => {
    const health = serviceHealth({
      service: service(),
      devices: [
        device({ id: 'a', status: 'offline' }),
        device({ id: 'b', status: 'offline' }),
        device({ id: 'c', status: 'online' }),
      ],
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(health.status).toBe('outage')
  })

  it('escalates on a critical incident touching the service', () => {
    const health = serviceHealth({
      service: service(),
      devices: [device({ id: 'a', status: 'online' })],
      incidents: [incident({ deviceIds: ['a'], severity: 'critical' })],
      thresholds: THRESHOLDS,
    })
    expect(health.status).toBe('partial')
    expect(health.openIncidentIds).toEqual(['i1'])
  })

  it('ignores resolved incidents when escalating', () => {
    const health = serviceHealth({
      service: service(),
      devices: [device({ id: 'a', status: 'online' })],
      incidents: [
        incident({
          deviceIds: ['a'],
          severity: 'critical',
          status: 'resolved',
        }),
      ],
      thresholds: THRESHOLDS,
    })
    expect(health.status).toBe('operational')
    expect(health.openIncidentIds).toEqual([])
  })

  it('returns health for every service', () => {
    const services = [service({ id: 's1' }), service({ id: 's2' })]
    const healths = serviceHealthAll({
      services,
      devices: [device({ id: 'a' })],
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(healths.map((h) => h.serviceId)).toEqual(['s1', 's2'])
  })
})

describe('serviceUptimePct', () => {
  it('averages member history availability', () => {
    const devices = [device({ id: 'a' }), device({ id: 'b' })]
    const history: Record<string, MetricSample[]> = {
      a: [
        {
          t: 0,
          latencyMs: 1,
          packetLossPct: 0,
          availabilityPct: 100,
          throughputMbps: 1,
          cpuPct: 1,
          memoryPct: 1,
        },
      ],
      b: [
        {
          t: 0,
          latencyMs: 1,
          packetLossPct: 0,
          availabilityPct: 98,
          throughputMbps: 1,
          cpuPct: 1,
          memoryPct: 1,
        },
      ],
    }
    expect(serviceUptimePct(service(), devices, history)).toBe(99)
  })

  it('falls back to live availability without history', () => {
    const devices = [device({ id: 'a', availabilityPct: 97 })]
    expect(serviceUptimePct(service(), devices, {})).toBe(97)
  })
})

describe('incidentBusinessImpact', () => {
  it('ranks higher-tier, higher-severity services first', () => {
    const services = [
      service({ id: 'p1', name: 'Payments', tier: 'p1', impact: 'revenue' }),
      service({ id: 'p4', name: 'Intranet', tier: 'p4', impact: 'internal' }),
    ]
    const impacts = incidentBusinessImpact(
      incident({ deviceIds: ['a'] }),
      services,
      [device({ id: 'a' })],
    )
    expect(impacts.map((entry) => entry.serviceId)).toEqual(['p1', 'p4'])
    expect(impacts[0].score).toBeGreaterThan(impacts[1].score)
  })

  it('excludes services the incident does not touch', () => {
    const services = [
      service({ id: 'a', siteNames: ['Data Center A'] }),
      service({ id: 'b', siteNames: ['HQ - Floor 1'] }),
    ]
    const impacts = incidentBusinessImpact(
      incident({ deviceIds: ['x'] }),
      services,
      [device({ id: 'x', site: 'Data Center A' })],
    )
    expect(impacts.map((entry) => entry.serviceId)).toEqual(['a'])
  })
})

describe('businessImpactSummary', () => {
  it('reports an all-clear label when everything is operational', () => {
    const summary = businessImpactSummary({
      services: [service()],
      devices: [device({ id: 'a', status: 'online' })],
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(summary.atRisk).toBe(0)
    expect(summary.label).toBe('All services operational')
    expect(summary.score).toBe(0)
  })

  it('counts degraded/partial/outage services and scores them', () => {
    const services = [
      service({ id: 's1', name: 'Payments', tier: 'p1', impact: 'revenue' }),
      service({
        id: 's2',
        name: 'Intranet',
        tier: 'p4',
        impact: 'internal',
        siteNames: ['HQ - Floor 1'],
      }),
    ]
    const devices = [
      device({ id: 'a', site: 'Data Center A', status: 'offline' }),
      device({ id: 'b', site: 'Data Center A', status: 'offline' }),
      device({ id: 'c', site: 'HQ - Floor 1', status: 'online' }),
    ]
    const summary = businessImpactSummary({
      services,
      devices,
      incidents: [],
      thresholds: THRESHOLDS,
    })
    expect(summary.totalServices).toBe(2)
    expect(summary.atRisk).toBe(1)
    expect(summary.outage).toBe(1)
    expect(summary.score).toBeGreaterThan(0)
    expect(summary.worst[0].serviceId).toBe('s1')
  })
})
