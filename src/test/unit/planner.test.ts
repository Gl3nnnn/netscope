import { describe, expect, it } from 'vitest'
import type { Device, Thresholds } from '@/types'
import {
  DEFAULT_SCENARIO,
  describeScenario,
  generateAdditions,
  isScenarioDirty,
  projectFleet,
  scenarioDelta,
  snapshotFor,
  type PlannerScenario,
} from '@/lib/planner'
import { mulberry32 } from '@/simulation/random'

const THRESHOLDS: Thresholds = {
  latencyMs: 120,
  packetLossPct: 1,
  availabilityPct: 99,
}

function server(id: string, site = 'HQ'): Device {
  return {
    id,
    name: `Server ${id}`,
    type: 'server',
    site,
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 640,
    capacityMbps: 2000,
    cpuPct: 48,
    memoryPct: 70,
    uptimeSec: 1000,
    lastSeen: 0,
  }
}

function fleet(count = 4, site = 'HQ'): Device[] {
  return Array.from({ length: count }, (_, index) =>
    server(String(index + 1), site),
  )
}

function scenario(overrides: Partial<PlannerScenario> = {}): PlannerScenario {
  return { ...DEFAULT_SCENARIO, ...overrides }
}

describe('snapshotFor', () => {
  it('computes fleet utilisation and saturation', () => {
    const snapshot = snapshotFor(fleet(4))
    expect(snapshot.deviceCount).toBe(4)
    expect(snapshot.totalThroughputMbps).toBe(2560)
    expect(snapshot.totalCapacityMbps).toBe(8000)
    expect(snapshot.fleetUtilPct).toBeCloseTo(32, 5)
    expect(snapshot.saturatedCount).toBe(0)
  })

  it('applies traffic and capacity overlays', () => {
    const devices = fleet(2)
    const hot = snapshotFor(devices, scenario({ trafficScale: 2 }))
    expect(hot.fleetUtilPct).toBeCloseTo(96, 5)
    expect(hot.saturatedCount).toBe(2)

    const wide = snapshotFor(devices, scenario({ capacityScale: 1 }))
    expect(wide.fleetUtilPct).toBeCloseTo(16, 5)
  })

  it('counts offline devices', () => {
    const devices = fleet(3)
    devices[0]!.status = 'offline'
    expect(snapshotFor(devices).offlineCount).toBe(1)
  })
})

describe('generateAdditions', () => {
  it('creates the requested devices from the type profile', () => {
    const additions = generateAdditions(
      scenario({ addCount: 3, addType: 'switch', addSite: 'DC' }),
      1000,
      mulberry32(7),
    )
    expect(additions).toHaveLength(3)
    for (const device of additions) {
      expect(device.type).toBe('switch')
      expect(device.site).toBe('DC')
      expect(device.tags).toContain('plan')
    }
  })

  it('returns nothing for a zero-count scenario', () => {
    expect(generateAdditions(scenario(), 1000, mulberry32(7))).toEqual([])
  })
})

describe('projectFleet', () => {
  it('leaves the live fleet untouched', () => {
    const devices = fleet(4)
    const before = JSON.stringify(devices)
    projectFleet({
      devices,
      scenario: scenario({ trafficScale: 1, offlineSite: 'HQ' }),
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 1_000_000,
      steps: 4,
    })
    expect(JSON.stringify(devices)).toBe(before)
  })

  it('is deterministic for a given seed', () => {
    const input = {
      devices: fleet(4),
      scenario: scenario({ trafficScale: 0.5, addCount: 2, addSite: 'DC' }),
      thresholds: THRESHOLDS,
      incidentFrequency: 0.2,
      now: 2_000_000,
      steps: 6,
      seed: 42,
    }
    const first = projectFleet(input)
    const second = projectFleet(input)
    expect(first.series).toEqual(second.series)
    expect(first.projected).toEqual(second.projected)
    expect(first.additions.map((d) => d.id)).toEqual(
      second.additions.map((d) => d.id),
    )
  })

  it('raises utilisation when traffic scales up', () => {
    const result = projectFleet({
      devices: fleet(4),
      scenario: scenario({ trafficScale: 2 }),
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 3_000_000,
      steps: 6,
    })
    expect(result.projected.fleetUtilPct).toBeGreaterThan(
      result.baseline.fleetUtilPct,
    )
    expect(result.series).toHaveLength(6)
  })

  it('flags devices that would saturate under extra load', () => {
    const busy = fleet(2).map((device) => ({
      ...device,
      throughputMbps: 1900,
    }))
    const result = projectFleet({
      devices: busy,
      scenario: scenario({ trafficScale: 1 }),
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 3_000_000,
      steps: 2,
    })
    expect(result.saturated.length).toBeGreaterThan(0)
    expect(result.saturated[0]!.utilPct).toBeGreaterThanOrEqual(80)
  })

  it('lowers utilisation when capacity is upgraded', () => {
    const result = projectFleet({
      devices: fleet(4),
      scenario: scenario({ capacityScale: 1 }),
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 3_000_000,
      steps: 6,
    })
    expect(result.projected.fleetUtilPct).toBeLessThan(
      result.baseline.fleetUtilPct,
    )
  })

  it('projects a site outage as offline devices', () => {
    const result = projectFleet({
      devices: fleet(4, 'HQ'),
      scenario: scenario({ offlineSite: 'HQ' }),
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 4_000_000,
      steps: 4,
    })
    expect(result.projected.offlineCount).toBe(4)
  })

  it('includes added devices in the projected fleet', () => {
    const result = projectFleet({
      devices: fleet(4),
      scenario: scenario({ addCount: 3, addType: 'server', addSite: 'DC' }),
      thresholds: THRESHOLDS,
      incidentFrequency: 0,
      now: 5_000_000,
      steps: 4,
    })
    expect(result.projected.deviceCount).toBe(7)
    expect(result.additions).toHaveLength(3)
  })
})

describe('scenarioDelta', () => {
  it('subtracts baseline from projected', () => {
    const delta = scenarioDelta(
      {
        deviceCount: 4,
        totalThroughputMbps: 2560,
        totalCapacityMbps: 8000,
        fleetUtilPct: 32,
        avgLatencyMs: 12,
        saturatedCount: 0,
        offlineCount: 0,
      },
      {
        deviceCount: 4,
        totalThroughputMbps: 5120,
        totalCapacityMbps: 8000,
        fleetUtilPct: 64,
        avgLatencyMs: 15,
        saturatedCount: 2,
        offlineCount: 1,
      },
    )
    expect(delta.fleetUtilPct).toBe(32)
    expect(delta.avgLatencyMs).toBe(3)
    expect(delta.saturatedCount).toBe(2)
    expect(delta.offlineCount).toBe(1)
  })
})

describe('isScenarioDirty', () => {
  it('is false for the default scenario', () => {
    expect(isScenarioDirty(DEFAULT_SCENARIO)).toBe(false)
  })

  it('is true when any lever is moved', () => {
    expect(isScenarioDirty(scenario({ trafficScale: 0.1 }))).toBe(true)
    expect(isScenarioDirty(scenario({ offlineSite: 'HQ' }))).toBe(true)
    expect(isScenarioDirty(scenario({ addCount: 1 }))).toBe(true)
  })
})

describe('describeScenario', () => {
  it('describes the active levers', () => {
    const text = describeScenario(
      scenario({
        addCount: 2,
        addType: 'firewall',
        addSite: 'DC',
        trafficScale: 0.25,
        offlineSite: 'HQ',
      }),
    )
    expect(text).toContain('+2 Firewall at DC')
    expect(text).toContain('+25% traffic')
    expect(text).toContain('fail site HQ')
  })

  it('says no changes for the default scenario', () => {
    expect(describeScenario(DEFAULT_SCENARIO)).toBe('No changes')
  })
})
