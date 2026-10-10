import type { MetricSample } from '@/types'
import { clamp } from './format'
import { SATURATION_THRESHOLD_PCT, utilizationPct } from './capacity'

/**
 * Least-squares trend forecasting over historical telemetry.
 *
 * We fit a straight line to a series and extrapolate it forward to answer the
 * questions an operator actually asks: "how full will this get?" and "when does
 * it hit the limit?". Pure maths, fully unit-tested, no chart/UI coupling.
 */

/** Numeric metric fields we can forecast (everything except the timestamp). */
export type ForecastKey = Exclude<keyof MetricSample, 't'>

export interface Point {
  x: number
  y: number
}

export interface Regression {
  /** Change in y per second. */
  slope: number
  intercept: number
  r2: number
  stdError: number
}

/** Ordinary least-squares fit. Returns null for fewer than two distinct x. */
export function linearRegression(points: Point[]): Regression | null {
  const n = points.length
  if (n < 2) return null

  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const { x, y } of points) {
    sumX += x
    sumY += y
    sumXY += x * y
    sumXX += x * x
  }

  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return null

  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n

  const meanY = sumY / n
  let ssTot = 0
  let ssRes = 0
  for (const { x, y } of points) {
    const predicted = slope * x + intercept
    ssTot += (y - meanY) ** 2
    ssRes += (y - predicted) ** 2
  }
  const r2 = ssTot === 0 ? 1 : clamp(1 - ssRes / ssTot, 0, 1)
  const stdError = n > 2 ? Math.sqrt(Math.max(0, ssRes / (n - 2))) : 0

  return { slope, intercept, r2, stdError }
}

/** Map samples to (seconds-since-first, value) points for a metric. */
export function toPoints(samples: MetricSample[], key: ForecastKey): Point[] {
  if (samples.length === 0) return []
  const t0 = samples[0].t
  return samples.map((sample) => ({
    x: (sample.t - t0) / 1000,
    y: sample[key],
  }))
}

export interface ForecastPoint {
  t: number
  value: number
  lower: number
  upper: number
}

/**
 * Extrapolate `horizon` future points after the final sample. `band` scales the
 * +/- confidence band (multiples of the residual standard error).
 */
export function forecastSeries(
  samples: MetricSample[],
  key: ForecastKey,
  horizon: number,
  stepMs: number,
  band = 1.5,
): ForecastPoint[] {
  const points = toPoints(samples, key)
  const regression = linearRegression(points)
  if (!regression || points.length === 0 || horizon <= 0) return []

  const t0 = samples[0].t
  const lastX = points[points.length - 1].x
  const stepSec = Math.max(1, stepMs) / 1000
  const out: ForecastPoint[] = []
  for (let i = 1; i <= horizon; i += 1) {
    const x = lastX + i * stepSec
    const value = regression.slope * x + regression.intercept
    const spread = band * regression.stdError
    out.push({
      t: t0 + x * 1000,
      value,
      lower: value - spread,
      upper: value + spread,
    })
  }
  return out
}

/**
 * Time until the series crosses `threshold`, in milliseconds. Returns 0 when
 * already at/above the threshold, and null when it is flat or falling.
 */
export function timeToThreshold(
  samples: MetricSample[],
  key: ForecastKey,
  threshold: number,
): number | null {
  const points = toPoints(samples, key)
  const regression = linearRegression(points)
  if (!regression || points.length === 0) return null

  const last = points[points.length - 1]
  if (last.y >= threshold) return 0
  if (regression.slope <= 0) return null

  const xCross = (threshold - regression.intercept) / regression.slope
  const etaSec = xCross - last.x
  if (!Number.isFinite(etaSec) || etaSec <= 0) return 0
  return etaSec * 1000
}

export interface SaturationForecast {
  /** Current utilisation, 0-100. */
  currentPct: number
  /** Projected utilisation at the end of the horizon, 0-100. */
  projectedPct: number
  /** Milliseconds until utilisation crosses the saturation threshold. */
  etaMs: number | null
}

/**
 * Forecast capacity saturation for a throughput series against a capacity
 * ceiling. Utilisation is clamped to [0, 100] for display.
 */
export function saturationForecast(
  samples: MetricSample[],
  capacityMbps: number,
  horizon: number,
  stepMs: number,
): SaturationForecast {
  const currentThroughput =
    samples.length > 0 ? samples[samples.length - 1].throughputMbps : 0
  const currentPct = utilizationPct(currentThroughput, capacityMbps)

  const forecast = forecastSeries(samples, 'throughputMbps', horizon, stepMs)
  const projectedThroughput =
    forecast.length > 0
      ? forecast[forecast.length - 1].value
      : currentThroughput
  const projectedPct = clamp(
    utilizationPct(Math.max(0, projectedThroughput), capacityMbps),
    0,
    100,
  )

  const threshold = (capacityMbps * SATURATION_THRESHOLD_PCT) / 100
  const etaMs = timeToThreshold(samples, 'throughputMbps', threshold)

  return { currentPct, projectedPct, etaMs }
}
