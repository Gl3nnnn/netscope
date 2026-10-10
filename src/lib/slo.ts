import type { MetricSample } from '@/types'
import { clamp } from './format'

/**
 * SLO error-budget and burn-rate math (Google SRE style).
 *
 * An SLO of 99.9% over a window permits a small "error budget" of bad time. We
 * consume that budget wherever availability dips below 100%. The burn rate is
 * how fast the budget is being spent relative to the sustainable rate, and the
 * multi-window rule fires when both a fast and a slow window are burning hard.
 *
 * Everything here is pure so it can be unit tested deterministically.
 */

export interface SloTarget {
  name: string
  /** Service-level objective, e.g. 99.9 (percent). */
  objectivePct: number
  /** Evaluation window length in milliseconds. */
  windowMs: number
}

export const DEFAULT_SLO: SloTarget = {
  name: 'Availability',
  objectivePct: 99.9,
  windowMs: 30 * 24 * 60 * 60 * 1000,
}

export const BURN_RATE_FAST_WINDOW_MS = 60 * 60 * 1000
export const BURN_RATE_SLOW_WINDOW_MS = 6 * 60 * 60 * 1000
export const BURN_RATE_CRITICAL = 14.4
export const BURN_RATE_WARNING = 6

export type BurnState = 'ok' | 'warning' | 'critical'

/** The fraction of time the SLO allows to be bad, in [0, 1]. */
export function errorBudgetRatio(target: SloTarget): number {
  return clamp((100 - target.objectivePct) / 100, 0, 1)
}

/** The absolute error budget for the target window, in milliseconds. */
export function errorBudgetMs(target: SloTarget): number {
  return target.windowMs * errorBudgetRatio(target)
}

/** Mean fraction of "bad" time across a set of samples, in [0, 1]. */
export function badFraction(samples: MetricSample[]): number {
  if (samples.length === 0) return 0
  const total = samples.reduce(
    (sum, sample) => sum + clamp((100 - sample.availabilityPct) / 100, 0, 1),
    0,
  )
  return total / samples.length
}

/** Fraction of the error budget consumed, as a percentage (may exceed 100). */
export function budgetConsumedPct(
  samples: MetricSample[],
  target: SloTarget,
): number {
  const budget = errorBudgetRatio(target)
  if (budget <= 0) return 0
  return Math.max(0, (badFraction(samples) / budget) * 100)
}

/** Fraction of the error budget still available, as a percentage (may be < 0). */
export function budgetRemainingPct(
  samples: MetricSample[],
  target: SloTarget,
): number {
  return 100 - budgetConsumedPct(samples, target)
}

/** Samples at or after `now - windowMs`. */
export function windowSamples(
  samples: MetricSample[],
  now: number,
  windowMs: number,
): MetricSample[] {
  const cutoff = now - windowMs
  return samples.filter((sample) => sample.t >= cutoff)
}

/**
 * Burn rate over a trailing window: bad time divided by allowed bad time. A
 * value of 1 spends the budget exactly evenly across the window; higher values
 * exhaust it early. Returns 0 when there is no data.
 */
export function burnRate(
  samples: MetricSample[],
  target: SloTarget,
  now: number,
  windowMs: number,
): number {
  const budget = errorBudgetRatio(target)
  if (budget <= 0) return 0
  const windowed = windowSamples(samples, now, windowMs)
  if (windowed.length === 0) return 0
  return badFraction(windowed) / budget
}

export interface BurnRateWindows {
  fast: number
  slow: number
  state: BurnState
}

/**
 * Multi-window burn-rate evaluation: critical when both the fast (1h) and slow
 * (6h) windows burn at >= 14.4x, warning when either window burns >= 6x.
 */
export function burnRateWindows(
  samples: MetricSample[],
  target: SloTarget,
  now: number,
): BurnRateWindows {
  const fast = burnRate(samples, target, now, BURN_RATE_FAST_WINDOW_MS)
  const slow = burnRate(samples, target, now, BURN_RATE_SLOW_WINDOW_MS)
  let state: BurnState = 'ok'
  if (fast >= BURN_RATE_CRITICAL && slow >= BURN_RATE_CRITICAL) {
    state = 'critical'
  } else if (fast >= BURN_RATE_WARNING || slow >= BURN_RATE_WARNING) {
    state = 'warning'
  }
  return { fast, slow, state }
}

/** Flatten per-device history into a single sample list. */
export function mergeHistory(
  history: Record<string, MetricSample[]>,
): MetricSample[] {
  return Object.values(history).flat()
}
