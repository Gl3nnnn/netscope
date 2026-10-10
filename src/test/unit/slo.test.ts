import { describe, expect, it } from 'vitest'
import type { MetricSample } from '@/types'
import {
  DEFAULT_SLO,
  badFraction,
  budgetConsumedPct,
  budgetRemainingPct,
  burnRate,
  burnRateWindows,
  errorBudgetMs,
  errorBudgetRatio,
  mergeHistory,
  type SloTarget,
} from '@/lib/slo'

function sample(t: number, availabilityPct: number): MetricSample {
  return {
    t,
    latencyMs: 1,
    packetLossPct: 0,
    availabilityPct,
    throughputMbps: 1,
    cpuPct: 1,
    memoryPct: 1,
  }
}

describe('errorBudget', () => {
  it('derives the allowed bad fraction', () => {
    expect(errorBudgetRatio({ ...DEFAULT_SLO, objectivePct: 99 })).toBeCloseTo(
      0.01,
    )
    expect(errorBudgetRatio(DEFAULT_SLO)).toBeCloseTo(0.001)
  })

  it('scales the budget to milliseconds', () => {
    expect(errorBudgetMs(DEFAULT_SLO)).toBeCloseTo(
      30 * 24 * 60 * 60 * 1000 * 0.001,
    )
  })
})

describe('badFraction', () => {
  it('is zero with no samples or perfect availability', () => {
    expect(badFraction([])).toBe(0)
    expect(badFraction([sample(1, 100), sample(2, 100)])).toBe(0)
  })

  it('averages the shortfall from 100%', () => {
    expect(badFraction([sample(1, 99), sample(2, 97)])).toBeCloseTo(0.02)
  })
})

describe('budget consumption', () => {
  const target: SloTarget = { ...DEFAULT_SLO, objectivePct: 99, windowMs: 1000 }

  it('is zero when the budget is untouched', () => {
    expect(budgetConsumedPct([sample(1, 100)], target)).toBe(0)
    expect(budgetRemainingPct([sample(1, 100)], target)).toBe(100)
  })

  it('is 100% when exactly the budget is spent', () => {
    // 99% objective => 1% budget; 1% mean bad time => fully consumed.
    expect(budgetConsumedPct([sample(1, 99)], target)).toBeCloseTo(100)
    expect(budgetRemainingPct([sample(1, 99)], target)).toBeCloseTo(0)
  })

  it('can exceed 100% (budget exhausted)', () => {
    expect(budgetConsumedPct([sample(1, 95)], target)).toBeCloseTo(500)
    expect(budgetRemainingPct([sample(1, 95)], target)).toBeCloseTo(-400)
  })
})

describe('burnRate', () => {
  const target: SloTarget = { ...DEFAULT_SLO, objectivePct: 99, windowMs: 1000 }

  it('is 0 with no data', () => {
    expect(burnRate([], target, 10000, 1000)).toBe(0)
  })

  it('is 1 when spending the budget at the sustainable rate', () => {
    expect(burnRate([sample(9500, 99)], target, 10000, 1000)).toBeCloseTo(1)
  })

  it('ignores samples outside the window', () => {
    const samples = [sample(1, 50), sample(9500, 100)]
    expect(burnRate(samples, target, 10000, 1000)).toBeCloseTo(0)
  })
})

describe('burnRateWindows', () => {
  const target: SloTarget = { ...DEFAULT_SLO, objectivePct: 99, windowMs: 1000 }

  it('reports ok when healthy', () => {
    const result = burnRateWindows([sample(1000, 100)], target, 1000)
    expect(result.state).toBe('ok')
    expect(result.fast).toBe(0)
    expect(result.slow).toBe(0)
  })

  it('reports critical when both windows burn hard', () => {
    // 80% availability => 20% bad, budget 1% => burn 20x in both windows.
    const result = burnRateWindows([sample(1000, 80)], target, 1000)
    expect(result.state).toBe('critical')
    expect(result.fast).toBeCloseTo(20)
  })

  it('reports warning when only the fast window burns', () => {
    const now = 10 * 60 * 60 * 1000
    const samples = [
      sample(now, 80), // inside fast + slow? now is boundary; slow=6h so this is inside both
      sample(now - 5 * 60 * 60 * 1000, 100), // 5h ago, inside slow only
    ]
    const result = burnRateWindows(samples, target, now)
    expect(result.state).toBe('warning')
  })
})

describe('mergeHistory', () => {
  it('flattens all device sample lists', () => {
    const merged = mergeHistory({ a: [sample(1, 100)], b: [sample(2, 99)] })
    expect(merged).toHaveLength(2)
  })
})
