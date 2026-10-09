import { describe, expect, it } from 'vitest'
import { trafficMultiplier } from '@/simulation/timecurve'

// 2026-06-10 is a Wednesday, 2026-06-13 a Saturday. Fixed UTC timestamps keep
// this timezone-independent.
const wednesday = (hour: number) => Date.UTC(2026, 5, 10, hour)
const saturday = (hour: number) => Date.UTC(2026, 5, 13, hour)

describe('trafficMultiplier', () => {
  it('peaks mid-afternoon on a weekday', () => {
    expect(trafficMultiplier(wednesday(14))).toBeCloseTo(1, 6)
  })

  it('drops to the overnight floor of 0.45', () => {
    expect(trafficMultiplier(wednesday(3))).toBeCloseTo(0.45, 6)
  })

  it('is half as busy on weekends', () => {
    expect(trafficMultiplier(saturday(14))).toBeCloseTo(0.5, 6)
    expect(trafficMultiplier(saturday(3))).toBeCloseTo(0.225, 6)
  })

  it('always stays within [0.2, 1]', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const weekday = trafficMultiplier(wednesday(hour))
      const weekend = trafficMultiplier(saturday(hour))
      expect(weekday).toBeGreaterThanOrEqual(0.2)
      expect(weekday).toBeLessThanOrEqual(1)
      expect(weekend).toBeGreaterThanOrEqual(0.2)
      expect(weekend).toBeLessThanOrEqual(0.55)
    }
  })
})
