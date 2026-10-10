/**
 * Pure helpers for short-term metric trends: comparing the current reading
 * against a baseline to surface ▲/▼ deltas in the UI.
 */

import { formatDelta } from './format'

export type TrendDirection = 'up' | 'down' | 'flat'

/** Signed change between two readings. */
export function trendDelta(current: number, previous: number): number {
  return current - previous
}

/**
 * Classify a signed change. Movements within `epsilon` are treated as flat so
 * simulation noise does not read as a trend.
 */
export function trendDirection(delta: number, epsilon = 0): TrendDirection {
  if (Math.abs(delta) <= Math.abs(epsilon)) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

/** Relative change as a percentage, or `undefined` when the baseline is zero. */
export function trendPct(
  current: number,
  previous: number,
): number | undefined {
  if (previous === 0) return undefined
  return ((current - previous) / Math.abs(previous)) * 100
}

export interface SeriesTrend {
  current: number
  previous: number
  delta: number
  direction: TrendDirection
}

/**
 * Compare the mean of the most recent `window` values against the window
 * immediately before it. Returns `undefined` until enough points exist.
 */
export function seriesTrend(
  values: number[],
  window = 5,
  epsilon = 0,
): SeriesTrend | undefined {
  if (values.length < window * 2) return undefined
  const current = mean(values.slice(-window))
  const previous = mean(values.slice(-window * 2, -window))
  const delta = trendDelta(current, previous)
  return { current, previous, delta, direction: trendDirection(delta, epsilon) }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export interface TrendLabel {
  value: string
  direction: TrendDirection
  /** Whether the change is a good thing; drives the accent colour. */
  positive?: boolean
}

/**
 * Turn a series trend into a display label with a signed value and a sensible
 * "good/bad" colour hint. Returns `undefined` for missing or flat trends.
 */
export function trendLabel(
  trend: SeriesTrend | undefined,
  opts: { unit?: string; decimals?: number; upIsGood?: boolean } = {},
): TrendLabel | undefined {
  if (!trend || trend.direction === 'flat') return undefined
  const { unit = '', decimals = 1, upIsGood = false } = opts
  return {
    value: formatDelta(trend.delta, unit, decimals),
    direction: trend.direction,
    positive: upIsGood ? trend.delta > 0 : trend.delta < 0,
  }
}
