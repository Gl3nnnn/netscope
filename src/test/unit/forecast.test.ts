import { describe, expect, it } from 'vitest'
import type { MetricSample } from '@/types'
import {
  forecastSeries,
  linearRegression,
  saturationForecast,
  timeToThreshold,
  toPoints,
} from '@/lib/forecast'

describe('linearRegression', () => {
  it('recovers a perfect line', () => {
    const regression = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ])
    expect(regression?.slope).toBeCloseTo(2)
    expect(regression?.intercept).toBeCloseTo(1)
    expect(regression?.r2).toBeCloseTo(1)
    expect(regression?.stdError).toBeCloseTo(0)
  })

  it('returns null when it cannot fit a line', () => {
    expect(linearRegression([{ x: 0, y: 1 }])).toBeNull()
    expect(
      linearRegression([
        { x: 1, y: 1 },
        { x: 1, y: 5 },
      ]),
    ).toBeNull()
  })

  it('reports a positive residual error for noisy data', () => {
    const regression = linearRegression([
      { x: 0, y: 0 },
      { x: 1, y: 5 },
      { x: 2, y: 1 },
      { x: 3, y: 6 },
    ])
    expect(regression?.stdError).toBeGreaterThan(0)
    expect(regression?.r2).toBeLessThan(1)
  })
})

describe('toPoints', () => {
  it('uses seconds since the first sample', () => {
    const points = toPoints(
      [
        { ...emptySample, t: 1000, throughputMbps: 1 },
        { ...emptySample, t: 4000, throughputMbps: 2 },
      ],
      'throughputMbps',
    )
    expect(points).toEqual([
      { x: 0, y: 1 },
      { x: 3, y: 2 },
    ])
  })
})

const emptySample: MetricSample = {
  t: 0,
  latencyMs: 0,
  packetLossPct: 0,
  availabilityPct: 100,
  throughputMbps: 0,
  cpuPct: 0,
  memoryPct: 0,
}

describe('forecastSeries', () => {
  const series = Array.from({ length: 6 }, (_, i) => ({
    ...emptySample,
    t: i * 1000,
    throughputMbps: i,
  }))

  it('projects the requested number of future points', () => {
    const forecast = forecastSeries(series, 'throughputMbps', 4, 1000)
    expect(forecast).toHaveLength(4)
    expect(forecast[0].t).toBe(6000)
    expect(forecast[3].t).toBe(9000)
    expect(forecast[0].value).toBeCloseTo(6)
    expect(forecast[3].value).toBeCloseTo(9)
  })

  it('returns an empty list without enough data', () => {
    expect(forecastSeries([], 'throughputMbps', 3, 1000)).toEqual([])
    expect(forecastSeries([series[0]], 'throughputMbps', 3, 1000)).toEqual([])
  })
})

describe('timeToThreshold', () => {
  const series = Array.from({ length: 6 }, (_, i) => ({
    ...emptySample,
    t: i * 1000,
    throughputMbps: i,
  }))

  it('computes the time until a rising series crosses the threshold', () => {
    expect(timeToThreshold(series, 'throughputMbps', 10)).toBeCloseTo(5000)
  })

  it('returns 0 when already above the threshold', () => {
    expect(timeToThreshold(series, 'throughputMbps', 3)).toBe(0)
  })

  it('returns null for flat or falling series', () => {
    const flat = series.map((sample) => ({ ...sample, throughputMbps: 5 }))
    const falling = series.map((sample, i) => ({
      ...sample,
      throughputMbps: 10 - i,
    }))
    expect(timeToThreshold(flat, 'throughputMbps', 50)).toBeNull()
    expect(timeToThreshold(falling, 'throughputMbps', 50)).toBeNull()
  })
})

describe('saturationForecast', () => {
  it('reports current and projected utilisation plus ETA', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({
      ...emptySample,
      t: i * 1000,
      throughputMbps: i * 10, // 0,10,20,30,40,50
    }))
    const result = saturationForecast(series, 100, 4, 1000)
    expect(result.currentPct).toBeCloseTo(50)
    expect(result.projectedPct).toBeGreaterThan(result.currentPct)
    expect(result.etaMs).not.toBeNull()
  })

  it('clamps projected utilisation to 100', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({
      ...emptySample,
      t: i * 1000,
      throughputMbps: i * 30,
    }))
    const result = saturationForecast(series, 100, 4, 1000)
    expect(result.projectedPct).toBe(100)
  })

  it('handles a zero-capacity ceiling gracefully', () => {
    const result = saturationForecast([emptySample], 0, 2, 1000)
    expect(result.currentPct).toBe(0)
    expect(result.projectedPct).toBe(0)
  })
})
