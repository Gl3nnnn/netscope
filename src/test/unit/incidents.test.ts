import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import { autoResolveIncidents, generateIncidents } from '@/simulation/incidents'
import { buildSeedDevices } from '@/simulation/seed'
import { mulberry32 } from '@/simulation/random'
import { DEFAULT_THRESHOLDS } from '@/store/useSettingsStore'

const offlineDevices = () =>
  buildSeedDevices(mulberry32(1), 0).map((device) => ({
    ...device,
    status: 'offline' as const,
    availabilityPct: 70,
    latencyMs: 300,
    packetLossPct: 40,
    cpuPct: 90,
  }))

describe('generateIncidents', () => {
  it('opens incidents for unhealthy devices', () => {
    const { incidents } = generateIncidents({
      devices: offlineDevices(),
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      frequency: 1,
      rng: { chance: () => true },
      now: 0,
    })
    expect(incidents.length).toBeGreaterThan(0)
    expect(incidents[0].deviceIds).toHaveLength(1)
  })

  it('never opens incidents for devices in maintenance', () => {
    const devices = offlineDevices().map((device) => ({
      ...device,
      inMaintenance: true,
    }))
    const { incidents } = generateIncidents({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      frequency: 1,
      rng: { chance: () => true },
      now: 0,
    })
    expect(incidents).toHaveLength(0)
  })

  it('does nothing when frequency is zero', () => {
    const { incidents, events } = generateIncidents({
      devices: offlineDevices(),
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      frequency: 0,
      rng: { chance: () => true },
      now: 0,
    })
    expect(incidents).toHaveLength(0)
    expect(events).toHaveLength(0)
  })

  it('skips devices that already have an open incident', () => {
    const devices = offlineDevices()
    const existing = {
      id: 'inc_1',
      title: 'Existing',
      description: '',
      severity: 'high' as const,
      status: 'open' as const,
      deviceIds: [devices[0].id],
      createdAt: 0,
      updatedAt: 0,
    }
    const { incidents } = generateIncidents({
      devices,
      incidents: [existing],
      thresholds: DEFAULT_THRESHOLDS,
      frequency: 1,
      rng: { chance: () => true },
      now: 0,
    })
    expect(
      incidents.some((incident) => incident.deviceIds.includes(devices[0].id)),
    ).toBe(false)
  })

  it('merges every unhealthy device of an affected site into one incident', () => {
    const devices = buildSeedDevices(mulberry32(3), 0)
      .slice(0, 3)
      .map((device) => ({
        ...device,
        site: 'Lab',
        status: 'offline' as const,
        availabilityPct: 70,
        latencyMs: 300,
        packetLossPct: 40,
        cpuPct: 90,
      }))
    const { incidents } = generateIncidents({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      frequency: 1,
      rng: { chance: () => true },
      now: 0,
      affectedSiteIds: ['Lab'],
    })
    expect(incidents).toHaveLength(1)
    expect(incidents[0].deviceIds).toHaveLength(3)
    expect(incidents[0].title).toContain('Lab')
    expect(incidents[0].severity).toBe('critical')
  })

  it('uses the worst member severity for a merged site incident', () => {
    const devices = buildSeedDevices(mulberry32(4), 0)
      .slice(0, 2)
      .map((device, index): Device => {
        const offline = index === 1
        return {
          ...device,
          site: 'Lab',
          status: offline ? 'offline' : 'online',
          availabilityPct: offline ? 70 : 99,
          latencyMs: offline ? 300 : 220,
          packetLossPct: offline ? 40 : 12,
          cpuPct: 95,
        }
      })
    const { incidents } = generateIncidents({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      frequency: 1,
      rng: { chance: () => true },
      now: 0,
      affectedSiteIds: ['Lab'],
    })
    expect(incidents).toHaveLength(1)
    expect(incidents[0].severity).toBe('critical')
    expect(incidents[0].deviceIds).toHaveLength(2)
  })
})

describe('autoResolveIncidents', () => {
  it('resolves incidents whose devices have recovered', () => {
    const devices = [
      {
        ...buildSeedDevices(mulberry32(1), 0)[0],
        status: 'online' as const,
        latencyMs: 1,
        packetLossPct: 0,
        availabilityPct: 99.99,
        cpuPct: 5,
      },
    ]
    const incidents = [
      {
        id: 'inc_1',
        title: 'Recovered',
        description: '',
        severity: 'medium' as const,
        status: 'open' as const,
        deviceIds: [devices[0].id],
        createdAt: 0,
        updatedAt: 0,
      },
    ]
    const { incidents: next, events } = autoResolveIncidents({
      devices,
      incidents,
      thresholds: DEFAULT_THRESHOLDS,
      rng: { chance: () => true },
      now: 1000,
    })
    expect(events.some((event) => event.type === 'incident')).toBe(true)
    expect(
      next.some(
        (incident) => incident.id === 'inc_1' && incident.status === 'resolved',
      ),
    ).toBe(true)
  })
})
