import { describe, expect, it } from 'vitest'
import {
  computeHealthScore,
  deriveStatus,
  healthLevel,
  severityForScore,
} from '../../lib/health'
import { DEFAULT_THRESHOLDS } from '../../store/useSettingsStore'

const base = {
  latencyMs: 0,
  packetLossPct: 0,
  availabilityPct: 100,
  cpuPct: 0,
  status: 'online' as const,
}

describe('computeHealthScore', () => {
  it('scores a perfect device highly', () => {
    const score = computeHealthScore(
      { ...base, latencyMs: 1, cpuPct: 5 },
      DEFAULT_THRESHOLDS,
    )
    expect(score).toBeGreaterThan(95)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('returns 0 for offline devices', () => {
    expect(
      computeHealthScore({ ...base, status: 'offline' }, DEFAULT_THRESHOLDS),
    ).toBe(0)
  })

  it('penalises degraded telemetry', () => {
    const healthy = computeHealthScore(base, DEFAULT_THRESHOLDS)
    const unhealthy = computeHealthScore(
      { ...base, latencyMs: 150, packetLossPct: 9, cpuPct: 95 },
      DEFAULT_THRESHOLDS,
    )
    expect(unhealthy).toBeLessThan(healthy)
  })

  it('always stays within 0-100', () => {
    const score = computeHealthScore(
      {
        status: 'online',
        latencyMs: 9999,
        packetLossPct: 100,
        availabilityPct: 0,
        cpuPct: 100,
      },
      DEFAULT_THRESHOLDS,
    )
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })
})

describe('healthLevel', () => {
  it('maps scores to levels', () => {
    expect(healthLevel(95)).toBe('healthy')
    expect(healthLevel(85)).toBe('healthy')
    expect(healthLevel(70)).toBe('degraded')
    expect(healthLevel(60)).toBe('degraded')
    expect(healthLevel(30)).toBe('critical')
  })
})

describe('severityForScore', () => {
  it('maps low scores to higher severities', () => {
    expect(severityForScore(10)).toBe('critical')
    expect(severityForScore(45)).toBe('high')
    expect(severityForScore(65)).toBe('medium')
    expect(severityForScore(90)).toBe('low')
  })
})

describe('deriveStatus', () => {
  it('marks healthy devices online', () => {
    expect(deriveStatus(base, DEFAULT_THRESHOLDS)).toBe('online')
  })

  it('marks unavailable devices offline', () => {
    expect(
      deriveStatus({ ...base, availabilityPct: 90 }, DEFAULT_THRESHOLDS),
    ).toBe('offline')
  })
})
