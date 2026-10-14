import { describe, expect, it } from 'vitest'
import type { Device, DeviceType } from '@/types'
import {
  BTU_PER_WATT_HOUR,
  CARBON_INTENSITY,
  ENERGY_RATE,
  ENVIRONMENT_GRADE_LABELS,
  FACILITY_PUE,
  POWER_PROFILES,
  carbonBySite,
  devicePower,
  environmentScore,
  powerSummary,
  rackDensity,
  sitePower,
} from '@/lib/environment'

function device(
  id: string,
  type: DeviceType,
  site: string,
  overrides: Partial<Device> = {},
): Device {
  const profile = POWER_PROFILES[type]
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
    throughputMbps: 0,
    capacityMbps: profile.maxWatts > 0 ? 1000 : 1000,
    cpuPct: 0,
    memoryPct: 40,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

describe('POWER_PROFILES', () => {
  it('defines idle and peak watts for every device type', () => {
    const types: DeviceType[] = [
      'router',
      'switch',
      'firewall',
      'server',
      'accessPoint',
    ]
    for (const type of types) {
      const profile = POWER_PROFILES[type]
      expect(profile.idleWatts).toBeGreaterThan(0)
      expect(profile.maxWatts).toBeGreaterThan(profile.idleWatts)
    }
  })
})

describe('devicePower', () => {
  it('draws idle watts at zero load', () => {
    const power = devicePower(device('1', 'server', 'DC'))
    expect(power.watts).toBeCloseTo(POWER_PROFILES.server.idleWatts, 1)
    expect(power.loadPct).toBe(0)
  })

  it('draws peak watts at full load', () => {
    const power = devicePower(
      device('1', 'server', 'DC', { cpuPct: 100, throughputMbps: 1000 }),
    )
    expect(power.watts).toBeCloseTo(POWER_PROFILES.server.maxWatts, 1)
    expect(power.loadPct).toBe(100)
  })

  it('interpolates between idle and peak at half load', () => {
    const profile = POWER_PROFILES.router
    const power = devicePower(
      device('1', 'router', 'DC', { cpuPct: 50, throughputMbps: 500 }),
    )
    const expected =
      profile.idleWatts + (profile.maxWatts - profile.idleWatts) / 2
    expect(power.watts).toBeCloseTo(expected, 1)
  })

  it('derives heat, carbon and cost from the drawn watts', () => {
    const power = devicePower(
      device('1', 'server', 'DC', { cpuPct: 100, throughputMbps: 1000 }),
    )
    const kwhDay = (power.watts / 1000) * 24
    expect(power.heatBtuHr).toBeCloseTo(power.watts * BTU_PER_WATT_HOUR, 1)
    expect(power.co2KgDay).toBeCloseTo(kwhDay * CARBON_INTENSITY, 1)
    expect(power.costPerDay).toBeCloseTo(kwhDay * ENERGY_RATE, 1)
  })

  it('clamps over-capacity load to the peak wattage', () => {
    const power = devicePower(
      device('1', 'switch', 'DC', { cpuPct: 120, throughputMbps: 5000 }),
    )
    expect(power.watts).toBeCloseTo(POWER_PROFILES.switch.maxWatts, 1)
  })
})

describe('sitePower', () => {
  const devices = [
    device('1', 'server', 'DC', { cpuPct: 100, throughputMbps: 1000 }),
    device('2', 'router', 'DC', { cpuPct: 0, throughputMbps: 0 }),
    device('3', 'server', 'HQ', { cpuPct: 50, throughputMbps: 500 }),
  ]

  it('aggregates only the devices at the given site', () => {
    const power = sitePower(devices, 'DC')
    expect(power.deviceCount).toBe(2)
    const itWatts =
      POWER_PROFILES.server.maxWatts + POWER_PROFILES.router.idleWatts
    expect(power.itWatts).toBeCloseTo(itWatts, 1)
  })

  it('derives facility and cooling watts from the PUE', () => {
    const power = sitePower(devices, 'DC')
    expect(power.facilityWatts).toBeCloseTo(power.itWatts * FACILITY_PUE, 1)
    expect(power.coolingWatts).toBeCloseTo(
      power.facilityWatts - power.itWatts,
      1,
    )
  })

  it('averages the load across the site', () => {
    const power = sitePower(devices, 'DC')
    expect(power.avgLoadPct).toBeCloseTo(50, 0)
  })

  it('returns zeros for an unknown site', () => {
    const power = sitePower(devices, 'Nowhere')
    expect(power.deviceCount).toBe(0)
    expect(power.itWatts).toBe(0)
  })
})

describe('powerSummary', () => {
  it('sums draw, peak, carbon and cost across the fleet', () => {
    const devices = [
      device('1', 'server', 'DC', { cpuPct: 100, throughputMbps: 1000 }),
      device('2', 'router', 'DC', { cpuPct: 0, throughputMbps: 0 }),
    ]
    const summary = powerSummary(devices)
    expect(summary.deviceCount).toBe(2)
    expect(summary.itWatts).toBeGreaterThan(0)
    expect(summary.peakWatts).toBeCloseTo(
      POWER_PROFILES.server.maxWatts + POWER_PROFILES.router.maxWatts,
      1,
    )
    expect(summary.facilityWatts).toBeCloseTo(summary.itWatts * FACILITY_PUE, 1)
    expect(summary.co2KgDay).toBeGreaterThan(0)
    expect(summary.costPerDay).toBeGreaterThan(0)
  })
})

describe('carbonBySite', () => {
  it('sorts sites by carbon footprint, highest first', () => {
    const devices = [
      device('1', 'server', 'Big', { cpuPct: 100, throughputMbps: 1000 }),
      device('2', 'server', 'Big', { cpuPct: 100, throughputMbps: 1000 }),
      device('3', 'accessPoint', 'Small', { cpuPct: 0, throughputMbps: 0 }),
    ]
    const sites = carbonBySite(devices)
    expect(sites).toHaveLength(2)
    expect(sites[0]!.site).toBe('Big')
    expect(sites[0]!.co2KgDay).toBeGreaterThan(sites[1]!.co2KgDay)
    expect(sites[1]!.site).toBe('Small')
  })
})

describe('environmentScore', () => {
  it('scores a balanced fleet highly', () => {
    const score = environmentScore([
      device('1', 'server', 'DC', { cpuPct: 50, throughputMbps: 500 }),
    ])
    expect(score.score).toBeCloseTo(100, 0)
    expect(score.grade).toBe('excellent')
    expect(ENVIRONMENT_GRADE_LABELS[score.grade]).toBe('Efficient')
  })

  it('penalises an overloaded fleet', () => {
    const score = environmentScore([
      device('1', 'server', 'DC', { cpuPct: 100, throughputMbps: 1000 }),
    ])
    expect(score.score).toBeLessThan(60)
    expect(score.grade).toBe('poor')
  })

  it('penalises an idle fleet', () => {
    const score = environmentScore([
      device('1', 'server', 'DC', { cpuPct: 0, throughputMbps: 0 }),
    ])
    expect(score.score).toBeLessThan(60)
    expect(score.grade).toBe('poor')
  })

  it('handles an empty fleet', () => {
    const score = environmentScore([])
    expect(score.avgLoadPct).toBe(0)
  })
})

describe('rackDensity', () => {
  it('divides facility watts by the rack count', () => {
    const devices = [device('1', 'server', 'DC', { cpuPct: 100 })]
    const power = sitePower(devices, 'DC')
    expect(rackDensity(devices, 'DC', 2)).toBeCloseTo(
      power.facilityWatts / 2,
      1,
    )
  })

  it('returns zero when the rack count is zero', () => {
    const devices = [device('1', 'server', 'DC')]
    expect(rackDensity(devices, 'DC', 0)).toBe(0)
  })
})
