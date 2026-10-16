import { describe, expect, it } from 'vitest'
import {
  FACTOR_LABELS,
  HORIZON_DAYS,
  MTBF_HOURS,
  RISK_WEIGHTS,
  deviceMtbf,
  predictDevice,
  riskBand,
  runPrediction,
} from '@/lib/prediction'
import type { Device, DeviceType, MetricSample, Thresholds } from '@/types'

const NOW = 1_700_000_000_000
const THRESHOLDS: Thresholds = {
  latencyMs: 60,
  packetLossPct: 2,
  availabilityPct: 99,
}

function device(id: string, type: DeviceType = 'server'): Device {
  return {
    id,
    name: `${type} ${id}`,
    type,
    site: 'DC',
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 500,
    capacityMbps: 1000,
    cpuPct: 40,
    memoryPct: 50,
    uptimeSec: 100_000,
    lastSeen: NOW,
  }
}

function flatHistory(base: number): MetricSample[] {
  return Array.from({ length: 12 }, (_, index) => ({
    t: NOW - (12 - index) * 1000,
    latencyMs: base,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 100,
    cpuPct: 40,
    memoryPct: 50,
  }))
}

function risingHistory(start: number, step: number): MetricSample[] {
  return Array.from({ length: 12 }, (_, index) => ({
    t: NOW - (12 - index) * 1000,
    latencyMs: start + index * step,
    packetLossPct: 0.1 + index * 0.2,
    availabilityPct: 99.9,
    throughputMbps: 100,
    cpuPct: 40,
    memoryPct: 50,
  }))
}

describe('riskBand', () => {
  it('maps probabilities to bands at the thresholds', () => {
    expect(riskBand(0.5)).toBe('critical')
    expect(riskBand(0.49)).toBe('high')
    expect(riskBand(0.3)).toBe('high')
    expect(riskBand(0.29)).toBe('medium')
    expect(riskBand(0.15)).toBe('medium')
    expect(riskBand(0.14)).toBe('low')
    expect(riskBand(0)).toBe('low')
  })
})

describe('deviceMtbf', () => {
  it('jitters within ±8% of the type baseline', () => {
    for (const [type, base] of Object.entries(MTBF_HOURS)) {
      for (const seed of [0, 7, 42]) {
        const mtbf = deviceMtbf(type as DeviceType, 'dev-1', seed)
        expect(mtbf).toBeGreaterThanOrEqual(Math.floor(base * 0.92))
        expect(mtbf).toBeLessThanOrEqual(Math.ceil(base * 1.08))
      }
    }
  })

  it('ranks switch MTBF above server MTBF', () => {
    expect(MTBF_HOURS.switch).toBeGreaterThan(MTBF_HOURS.server)
  })
})

describe('predictDevice', () => {
  it('is deterministic for identical inputs', () => {
    const d = device('srv-1')
    const a = predictDevice(d, THRESHOLDS, NOW, 3)
    const b = predictDevice(d, THRESHOLDS, NOW, 3)
    expect(a).toEqual(b)
  })

  it('keeps failure probabilities inside the clamped range', () => {
    const prediction = predictDevice(device('x'), THRESHOLDS, NOW, 1)
    expect(prediction.failureProb).toBeGreaterThanOrEqual(0)
    expect(prediction.failureProb).toBeLessThanOrEqual(0.95)
    expect(HORIZON_DAYS).toBe(90)
  })

  it('scores an offline device above a healthy twin', () => {
    const healthy = predictDevice(device('a'), THRESHOLDS, NOW, 5)
    const offline = predictDevice(
      { ...device('a'), status: 'offline' },
      THRESHOLDS,
      NOW,
      5,
    )
    expect(offline.failureProb).toBeGreaterThan(healthy.failureProb)
    expect(offline.risk).not.toBe('low')
    expect(offline.contributors.map((c) => c.factor)).toContain('status')
  })

  it('scores a degraded device above a healthy one', () => {
    const healthy = predictDevice(device('a'), THRESHOLDS, NOW, 5)
    const sick = predictDevice(
      {
        ...device('a'),
        latencyMs: 180,
        packetLossPct: 8,
        availabilityPct: 97,
        status: 'degraded',
      },
      THRESHOLDS,
      NOW,
      5,
    )
    expect(sick.failureProb).toBeGreaterThan(healthy.failureProb)
    expect(sick.healthScore).toBeLessThan(healthy.healthScore)
  })

  it('scores a saturated device above an idle twin', () => {
    const idle = predictDevice(device('a'), THRESHOLDS, NOW, 5)
    const busy = predictDevice(
      { ...device('a'), cpuPct: 96, memoryPct: 94 },
      THRESHOLDS,
      NOW,
      5,
    )
    expect(busy.failureProb).toBeGreaterThan(idle.failureProb)
  })

  it('weights a rising latency/loss trend above a flat history', () => {
    const flat = predictDevice(device('a'), THRESHOLDS, NOW, 9, flatHistory(20))
    const rising = predictDevice(
      device('a'),
      THRESHOLDS,
      NOW,
      9,
      risingHistory(20, 8),
    )
    expect(rising.failureProb).toBeGreaterThan(flat.failureProb)
    expect(rising.contributors.map((c) => c.factor)).toContain('trend')
  })

  it('names contributors with shares summing to one', () => {
    const prediction = predictDevice(device('a'), THRESHOLDS, NOW, 2)
    const sum = prediction.contributors.reduce((total, c) => total + c.share, 0)
    expect(sum).toBeCloseTo(1, 3)
    for (const contributor of prediction.contributors) {
      expect(contributor.share).toBeGreaterThan(0)
      expect(contributor.label).toBe(FACTOR_LABELS[contributor.factor])
    }
    // Sorted by share, descending.
    for (let i = 1; i < prediction.contributors.length; i += 1) {
      expect(prediction.contributors[i]!.share).toBeLessThanOrEqual(
        prediction.contributors[i - 1]!.share,
      )
    }
  })

  it('recommends a concrete action for the dominant factor', () => {
    const offline = predictDevice(
      { ...device('srv-9'), status: 'offline' },
      THRESHOLDS,
      NOW,
      1,
    )
    // Health (0.25) outranks status (0.2) when offline, so the health action wins.
    expect(offline.action).toContain('incident')
    expect(offline.contributors.map((c) => c.factor)).toContain('status')
    const healthy = predictDevice(device('a'), THRESHOLDS, NOW, 1)
    expect(healthy.action.length).toBeGreaterThan(10)
  })

  it('holds risk weights at 1.0 total', () => {
    const total = Object.values(RISK_WEIGHTS).reduce((sum, w) => sum + w, 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('estimates remaining useful life above the floor', () => {
    const prediction = predictDevice(device('a'), THRESHOLDS, NOW, 4)
    expect(prediction.rulDays).toBeGreaterThanOrEqual(15)
  })
})

describe('runPrediction', () => {
  const devices = [
    device('srv-1', 'server'),
    device('sw-2', 'switch'),
    device('rtr-3', 'router'),
    device('fw-4', 'firewall'),
    device('ap-5', 'accessPoint'),
  ]

  it('returns an empty result for an empty fleet', () => {
    const result = runPrediction({
      devices: [],
      thresholds: THRESHOLDS,
      now: NOW,
    })
    expect(result.devices).toEqual([])
    expect(result.summary.total).toBe(0)
    expect(result.summary.meanProb).toBe(0)
    expect(result.summary.meanRulDays).toBe(0)
  })

  it('is deterministic for identical inputs', () => {
    const input = { devices, thresholds: THRESHOLDS, now: NOW, seed: 11 }
    expect(runPrediction(input)).toEqual(runPrediction(input))
  })

  it('sorts riskiest first and keeps band counts consistent', () => {
    const result = runPrediction({
      devices,
      thresholds: THRESHOLDS,
      now: NOW,
      seed: 11,
    })
    expect(result.devices).toHaveLength(5)
    const bandRank = { critical: 0, high: 1, medium: 2, low: 3 } as const
    for (let i = 1; i < result.devices.length; i += 1) {
      expect(bandRank[result.devices[i]!.risk]).toBeGreaterThanOrEqual(
        bandRank[result.devices[i - 1]!.risk],
      )
    }
    const { summary } = result
    expect(summary.critical + summary.high + summary.medium + summary.low).toBe(
      summary.total,
    )
    expect(summary.atRisk).toBe(summary.critical + summary.high)
  })
})
