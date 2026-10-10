import { describe, expect, it } from 'vitest'
import { seriesTrend, trendDelta, trendDirection, trendPct } from '@/lib/trend'

describe('trendDelta', () => {
  it('returns the signed difference', () => {
    expect(trendDelta(10, 7)).toBe(3)
    expect(trendDelta(4, 9)).toBe(-5)
    expect(trendDelta(5, 5)).toBe(0)
  })
})

describe('trendDirection', () => {
  it('classifies the sign of a change', () => {
    expect(trendDirection(1)).toBe('up')
    expect(trendDirection(-1)).toBe('down')
    expect(trendDirection(0)).toBe('flat')
  })

  it('treats movement within epsilon as flat', () => {
    expect(trendDirection(0.4, 0.5)).toBe('flat')
    expect(trendDirection(-0.4, 0.5)).toBe('flat')
    expect(trendDirection(0.6, 0.5)).toBe('up')
    expect(trendDirection(-0.6, 0.5)).toBe('down')
  })
})

describe('trendPct', () => {
  it('computes a relative percentage change', () => {
    expect(trendPct(110, 100)).toBeCloseTo(10)
    expect(trendPct(50, 200)).toBeCloseTo(-75)
  })

  it('returns undefined when the baseline is zero', () => {
    expect(trendPct(10, 0)).toBeUndefined()
  })
})

describe('seriesTrend', () => {
  it('returns undefined until there are two full windows', () => {
    expect(seriesTrend([1, 2, 3, 4], 3)).toBeUndefined()
  })

  it('compares the two most recent windows', () => {
    const trend = seriesTrend([10, 10, 10, 20, 20, 20], 3)
    expect(trend).toBeDefined()
    expect(trend?.previous).toBe(10)
    expect(trend?.current).toBe(20)
    expect(trend?.delta).toBe(10)
    expect(trend?.direction).toBe('up')
  })

  it('reports a downward trend', () => {
    const trend = seriesTrend([30, 30, 30, 12, 12, 12], 3)
    expect(trend?.direction).toBe('down')
    expect(trend?.delta).toBe(-18)
  })
})
