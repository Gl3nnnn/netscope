/**
 * Predictive failure engine.
 *
 * Blends four deterministic risk components — lifecycle age, current health,
 * CPU/memory saturation and a latency/loss trend slope — into a per-device
 * failure probability over a fixed horizon, with an MTBF derived from the
 * device type (seeded jitter), remaining-useful-life estimate, risk band,
 * named contributors and a recommended action. Pure and seed-stable.
 */

import { computeHealthScore } from '@/lib/health'
import { lifecycleFor } from '@/lib/lifecycle'
import { mulberry32, hashSeed } from '@/simulation/random'
import type { Device, DeviceType, MetricSample, Thresholds } from '@/types'

export type RiskBand = 'critical' | 'high' | 'medium' | 'low'

export const HORIZON_DAYS = 90

/** Base MTBF in hours by device type (before seeded jitter). */
export const MTBF_HOURS: Record<DeviceType, number> = {
  server: 14_000,
  accessPoint: 11_000,
  firewall: 17_000,
  router: 21_000,
  switch: 26_000,
}

export type RiskFactor = 'age' | 'health' | 'saturation' | 'trend' | 'status'

export const RISK_WEIGHTS: Record<RiskFactor, number> = {
  age: 0.2,
  health: 0.25,
  saturation: 0.15,
  trend: 0.2,
  status: 0.2,
}

export const FACTOR_LABELS: Record<RiskFactor, string> = {
  age: 'Age & support horizon',
  health: 'Degraded health signals',
  saturation: 'CPU/memory saturation',
  trend: 'Rising latency/loss trend',
  status: 'Device offline',
}

const FACTOR_ACTIONS: Record<RiskFactor, string> = {
  age: 'Plan a lifecycle refresh — the device is past mid-life.',
  health:
    'Open an incident: latency, loss or availability are dragging health.',
  saturation:
    'Right-size or rebalance load before saturation causes brownouts.',
  trend: 'Investigate the rising trend — schedule diagnostics this window.',
  status: 'Restore reachability — the device is currently offline.',
}

export interface Contributor {
  factor: RiskFactor
  label: string
  /** Share of the composite risk, 0–1 (sums to 1 across contributors). */
  share: number
}

export interface DevicePrediction {
  deviceId: string
  deviceName: string
  type: DeviceType
  site: string
  /** Probability of failure within HORIZON_DAYS, 0–0.95. */
  failureProb: number
  /** Seeded MTBF in hours for this device. */
  mtbfHours: number
  /** Remaining useful life estimate in days. */
  rulDays: number
  risk: RiskBand
  healthScore: number
  ageDays: number
  daysToEol: number
  contributors: Contributor[]
  action: string
}

export interface PredictionSummary {
  total: number
  atRisk: number
  critical: number
  high: number
  medium: number
  low: number
  meanProb: number
  meanRulDays: number
}

export interface PredictionResult {
  devices: DevicePrediction[]
  summary: PredictionSummary
}

export interface PredictionInput {
  devices: Device[]
  thresholds: Thresholds
  now: number
  seed?: number
  /** Optional per-device metric history for the trend component. */
  history?: Record<string, MetricSample[]>
}

const clamp01 = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

const round4 = (value: number) => Math.round(value * 10_000) / 10_000

export function riskBand(failureProb: number): RiskBand {
  if (failureProb >= 0.5) return 'critical'
  if (failureProb >= 0.3) return 'high'
  if (failureProb >= 0.15) return 'medium'
  return 'low'
}

/** Seeded MTBF jitter: ±8% of the type baseline. */
export function deviceMtbf(
  type: DeviceType,
  deviceId: string,
  seed = 0,
): number {
  const rng = mulberry32((hashSeed(deviceId) ^ seed) >>> 0)
  const jitter = rng.int(-8, 8) / 100
  return Math.round(MTBF_HOURS[type] * (1 + jitter))
}

/** Rising-trend component from a metric series (latency or loss). */
const trendComponent = (values: number[] | undefined): number => {
  if (!values || values.length < 10) return 0
  const window = 5
  const recent = values.slice(-window)
  const prior = values.slice(-window * 2, -window)
  if (prior.length < window) return 0
  const mean = (list: number[]) =>
    list.reduce((sum, value) => sum + value, 0) / list.length
  const delta = mean(recent) - mean(prior)
  // Latency: +20 ms between windows ≈ max trend. Loss: +5 pts ≈ max.
  return clamp01(delta / 20)
}

export function predictDevice(
  device: Device,
  thresholds: Thresholds,
  now: number,
  seed = 0,
  history?: MetricSample[],
): DevicePrediction {
  const lifecycle = lifecycleFor(device, now, seed)
  const healthScore = computeHealthScore(device, thresholds)
  const mtbfHours = deviceMtbf(device.type, device.id, seed)

  const ageRatio = clamp01(
    lifecycle.ageDays /
      Math.max(lifecycle.ageDays + Math.max(lifecycle.daysToEol, 0), 1),
  )
  const healthInverted = clamp01((100 - healthScore) / 100)
  const saturation = clamp01(Math.max(device.cpuPct, device.memoryPct) / 100)

  const lossSeries = history?.map((sample) => sample.packetLossPct)
  const latencySeries = history?.map((sample) => sample.latencyMs)
  const trend = clamp01(
    Math.max(
      trendComponent(lossSeries) * 4, // loss deltas are small
      trendComponent(latencySeries),
    ),
  )
  const status = device.status === 'offline' ? 1 : 0

  const raw: Record<RiskFactor, number> = {
    age: RISK_WEIGHTS.age * ageRatio,
    health: RISK_WEIGHTS.health * healthInverted,
    saturation: RISK_WEIGHTS.saturation * saturation,
    trend: RISK_WEIGHTS.trend * trend,
    status: RISK_WEIGHTS.status * status,
  }
  const riskScore = clamp01(
    raw.age + raw.health + raw.saturation + raw.trend + raw.status,
  )

  // Annualised failure rate from MTBF → probability over the horizon,
  // scaled by the composite risk (0.35× healthy floor … 1.65× worst case).
  const annualRate = 8760 / Math.max(mtbfHours, 1)
  const baseProb = 1 - Math.exp(-annualRate * (HORIZON_DAYS / 365))
  const failureProb = round4(clamp01(baseProb * (0.35 + 1.3 * riskScore)))

  const contributorSum = Object.values(raw).reduce(
    (sum, value) => sum + value,
    0,
  )
  const contributors: Contributor[] = (Object.keys(raw) as RiskFactor[])
    .filter((factor) => raw[factor] > 0 && contributorSum > 0)
    .map((factor) => ({
      factor,
      label: FACTOR_LABELS[factor],
      share: round4(raw[factor] / contributorSum),
    }))
    .sort((a, b) => b.share - a.share)

  const dominant = contributors[0]
  const action = dominant
    ? FACTOR_ACTIONS[dominant.factor]
    : 'Continue routine monitoring — no risk signals present.'

  const riskNorm = riskScore
  const rulDays = Math.max(
    15,
    Math.round(Math.max(lifecycle.daysToEol, 0) * (1 - 0.6 * riskNorm)) || 15,
  )

  return {
    deviceId: device.id,
    deviceName: device.name,
    type: device.type,
    site: device.site,
    failureProb,
    mtbfHours,
    rulDays,
    risk: riskBand(failureProb),
    healthScore,
    ageDays: lifecycle.ageDays,
    daysToEol: lifecycle.daysToEol,
    contributors,
    action,
  }
}

const bandOrder: Record<RiskBand, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function runPrediction(input: PredictionInput): PredictionResult {
  const { devices, thresholds, now, seed = 0, history } = input

  const predictions = devices
    .map((device) =>
      predictDevice(device, thresholds, now, seed, history?.[device.id]),
    )
    .sort(
      (a, b) =>
        bandOrder[a.risk] - bandOrder[b.risk] ||
        b.failureProb - a.failureProb ||
        a.deviceId.localeCompare(b.deviceId),
    )

  const total = predictions.length
  const count = (band: RiskBand) =>
    predictions.filter((prediction) => prediction.risk === band).length
  const critical = count('critical')
  const high = count('high')
  const medium = count('medium')
  const low = count('low')

  const summary: PredictionSummary = {
    total,
    atRisk: critical + high,
    critical,
    high,
    medium,
    low,
    meanProb:
      total === 0
        ? 0
        : round4(
            predictions.reduce((sum, p) => sum + p.failureProb, 0) / total,
          ),
    meanRulDays:
      total === 0
        ? 0
        : Math.round(
            predictions.reduce((sum, p) => sum + p.rulDays, 0) / total,
          ),
  }

  return { devices: predictions, summary }
}
