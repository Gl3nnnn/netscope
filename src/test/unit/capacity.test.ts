import { describe, expect, it } from 'vitest'
import {
  SATURATION_THRESHOLD_PCT,
  avgUtilization,
  fleetUtilization,
  maxUtilization,
  saturated,
  utilizationPct,
} from '@/lib/capacity'

const devices = [
  { throughputMbps: 500, capacityMbps: 1000 },
  { throughputMbps: 900, capacityMbps: 1000 },
  { throughputMbps: 250, capacityMbps: 1000 },
]

describe('utilizationPct', () => {
  it('returns the share of capacity as a percentage', () => {
    expect(utilizationPct(250, 1000)).toBe(25)
  })

  it('clamps above 100%', () => {
    expect(utilizationPct(1500, 1000)).toBe(100)
  })

  it('is zero when capacity is missing or non-positive', () => {
    expect(utilizationPct(250, 0)).toBe(0)
    expect(utilizationPct(250, -10)).toBe(0)
    expect(utilizationPct(250, Number.NaN)).toBe(0)
  })
})

describe('fleet capacity helpers', () => {
  it('averages and maximises utilisation across devices', () => {
    expect(avgUtilization(devices)).toBe(55)
    expect(maxUtilization(devices)).toBe(90)
  })

  it('returns zero for an empty fleet', () => {
    expect(avgUtilization([])).toBe(0)
    expect(maxUtilization([])).toBe(0)
    expect(fleetUtilization([])).toBe(0)
  })

  it('computes aggregate headroom from summed totals', () => {
    expect(fleetUtilization(devices)).toBeCloseTo(55, 6)
    expect(
      fleetUtilization([{ throughputMbps: 200, capacityMbps: 1000 }]),
    ).toBe(20)
  })

  it('flags devices at or above the saturation threshold', () => {
    const flagged = saturated(devices)
    expect(flagged.map((d) => d.throughputMbps)).toEqual([900])
    expect(SATURATION_THRESHOLD_PCT).toBe(80)
  })
})
