import { describe, expect, it } from 'vitest'
import { detectAnomaly, flagAnomalies } from '@/lib/anomaly'

describe('detectAnomaly', () => {
  it('accepts a stable series without flagging', () => {
    const window = Array.from({ length: 20 }, () => 50)
    const result = detectAnomaly(window, 51, { threshold: 3 })
    expect(result.abnormal).toBe(false)
    expect(result.mean).toBe(50)
    expect(result.stdDev).toBe(0)
  })

  it('flags a large spike away from the window mean', () => {
    const window = Array.from({ length: 20 }, (_, i) => 10 + (i % 4))
    const result = detectAnomaly(window, 500, { threshold: 3 })
    expect(result.abnormal).toBe(true)
    expect(result.zScore).toBeGreaterThan(0)
  })

  it('flags drops too (two-sided)', () => {
    const window = Array.from({ length: 20 }, (_, i) => 10 + (i % 4))
    const result = detectAnomaly(window, 0.1, { threshold: 3 })
    expect(result.abnormal).toBe(true)
    expect(result.zScore).toBeLessThan(0)
  })

  it('does not flag within a noisy but consistent series on its own', () => {
    const window = Array.from({ length: 20 }, (_, i) => 50 + Math.sin(i) * 10)
    const result = detectAnomaly(window, 45, { threshold: 3 })
    expect(result.abnormal).toBe(false)
  })

  it('respects a custom threshold', () => {
    const window = Array.from({ length: 20 }, () => 100)
    const low = detectAnomaly(window, 106, { threshold: 10 })
    expect(low.abnormal).toBe(false)
    const high = detectAnomaly(window, 106, { threshold: 2 })
    expect(high.abnormal).toBe(true)
  })

  it('flags any deviation from an empty or single-point window defensively', () => {
    expect(detectAnomaly([], 5).abnormal).toBe(true)
    expect(detectAnomaly([5], 5).abnormal).toBe(false)
    expect(detectAnomaly([5], 8).abnormal).toBe(true)
  })
})

describe('flagAnomalies', () => {
  it('returns an empty list until enough history has built up', () => {
    const series = Array.from({ length: 20 }, (_, i) => ({
      t: i,
      value: 42,
    }))
    expect(flagAnomalies(series, { windowSize: 12 })).toHaveLength(0)
  })

  it('flags only the deviating points', () => {
    const series = Array.from({ length: 30 }, (_, i) => ({
      t: i,
      value: i === 25 ? 999 : 50,
    }))
    const flagged = flagAnomalies(series, { windowSize: 12, threshold: 3 })
    expect(flagged.map((point) => point.t)).toEqual([25])
    expect(flagged[0].value).toBe(999)
  })
})
