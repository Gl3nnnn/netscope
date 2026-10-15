import type { Device, DeviceType } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import { buildCircuits, costPerMbps, siteDemand, type Circuit } from '@/lib/wan'
import { devicePower } from '@/lib/environment'
import { lifecycleFleet, refreshQueue } from '@/lib/lifecycle'

/**
 * FinOps engine.
 *
 * Merges the real spend sources already simulated elsewhere — WAN circuits
 * (wan.ts), facility power (environment.ts), the lifecycle refresh pipeline
 * (lifecycle.ts) — with a seeded per-device software-licence estate, then
 * budgets, forecasts and recommends savings. Pure and deterministic: no
 * Date.now() in the maths (the caller passes `now`), no runtime deps.
 */

export type CostCategory = 'wan' | 'power' | 'licenses' | 'refresh'

export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  wan: 'WAN & carriers',
  power: 'Facility power',
  licenses: 'Software licences',
  refresh: 'Refresh pipeline',
}

export interface CostLine {
  id: string
  category: CostCategory
  label: string
  site: string
  deviceId?: string
  monthlyUsd: number
}

export interface SiteBreakdown {
  site: string
  monthlyUsd: number
  wanUsd: number
  powerUsd: number
  otherUsd: number
}

export type SavingsKind =
  'downsize-circuit' | 'decommission' | 'license-consolidate'

export interface SavingsRecommendation {
  id: string
  kind: SavingsKind
  title: string
  detail: string
  monthlySavingUsd: number
}

export interface FinopsSummary {
  totalMonthlyUsd: number
  byCategory: Record<CostCategory, number>
  budgetUsd: number
  varianceUsd: number
  variancePct: number
  forecast12moUsd: number
  savingsPotentialUsd: number
  costPerDeviceUsd: number
}

export interface FinopsResult {
  lines: CostLine[]
  sites: SiteBreakdown[]
  savings: SavingsRecommendation[]
  summary: FinopsSummary
  /** 12-month trailing history (oldest first) for sparklines. */
  history: number[]
  circuits: Circuit[]
}

/** Monthly licence cost by device type (before seeded jitter). */
export const LICENSE_BASE_USD: Record<DeviceType, number> = {
  server: 85,
  router: 48,
  firewall: 62,
  switch: 18,
  accessPoint: 9,
}

/** Amortised refresh budget per device type (36-month window). */
const REFRESH_BASE_USD: Record<DeviceType, number> = {
  server: 14_000,
  router: 5_200,
  firewall: 6_800,
  switch: 2_400,
  accessPoint: 900,
}

const REFRESH_AMORTISATION_MONTHS = 36
const HISTORY_MONTHS = 12
const HISTORY_JITTER_PCT = 0.06

/** Simple per-device budget anchor — scales with the fleet. */
export function budgetFor(devices: Device[]): number {
  return Math.max(6_000, Math.round(devices.length * 1_650))
}

export function licenseFor(device: Device, seed: number): number {
  const rng = mulberry32(hashSeed(`finops:lic:${device.id}:${seed}`))
  const base = LICENSE_BASE_USD[device.type]
  return Math.round(base * (0.8 + rng.next() * 0.45) * 100) / 100
}

export function powerMonthlyFor(device: Device): number {
  // devicePower().costPerDay already includes the energy rate; scale to a month.
  const power = devicePower(device)
  return Math.round(power.costPerDay * 30.4 * 100) / 100
}

/** Full cost ledger: WAN + power + licences + amortised refresh, per entity. */
export function costLedger(
  devices: Device[],
  seed: number,
  now: number,
): CostLine[] {
  const lines: CostLine[] = []

  for (const circuit of buildCircuits(devices, {}, seed)) {
    lines.push({
      id: `fin-wan-${circuit.id}`,
      category: 'wan',
      label: `${circuit.carrier} ${circuit.kind.toUpperCase()} (${circuit.bandwidthMbps} Mbps, ${circuit.role})`,
      site: circuit.site,
      monthlyUsd: circuit.monthlyCostUsd,
    })
  }

  for (const device of devices) {
    const monthlyPower = powerMonthlyFor(device)
    if (monthlyPower > 0) {
      lines.push({
        id: `fin-pwr-${device.id}`,
        category: 'power',
        label: `Power — ${device.name}`,
        site: device.site,
        deviceId: device.id,
        monthlyUsd: monthlyPower,
      })
    }
    lines.push({
      id: `fin-lic-${device.id}`,
      category: 'licenses',
      label: `Licences — ${device.name}`,
      site: device.site,
      deviceId: device.id,
      monthlyUsd: licenseFor(device, seed),
    })
  }

  const records = lifecycleFleet(devices, now, seed)
  for (const record of refreshQueue(records)) {
    const device = devices.find((item) => item.id === record.deviceId)
    if (!device) continue
    const base = REFRESH_BASE_USD[device.type]
    const rng = mulberry32(hashSeed(`finops:refresh:${device.id}:${seed}`))
    const full = Math.round(base * (0.85 + rng.next() * 0.3))
    lines.push({
      id: `fin-rfr-${device.id}`,
      category: 'refresh',
      label: `Refresh reserve — ${device.name}`,
      site: device.site,
      deviceId: device.id,
      monthlyUsd: Math.round((full / REFRESH_AMORTISATION_MONTHS) * 100) / 100,
    })
  }

  return lines
}

export function siteBreakdown(lines: CostLine[]): SiteBreakdown[] {
  const bySite = new Map<string, SiteBreakdown>()
  for (const line of lines) {
    const entry = bySite.get(line.site) ?? {
      site: line.site,
      monthlyUsd: 0,
      wanUsd: 0,
      powerUsd: 0,
      otherUsd: 0,
    }
    entry.monthlyUsd += line.monthlyUsd
    if (line.category === 'wan') entry.wanUsd += line.monthlyUsd
    else if (line.category === 'power') entry.powerUsd += line.monthlyUsd
    else entry.otherUsd += line.monthlyUsd
    bySite.set(line.site, entry)
  }
  return [...bySite.values()].sort((a, b) => b.monthlyUsd - a.monthlyUsd)
}

/**
 * Savings opportunities:
 * - primary circuits whose site demand is under 25% of provisioned bandwidth
 * - offline/low-utilisation devices already flagged for refresh
 * - licence right-size on low-value device types
 */
export function savingsFor(
  devices: Device[],
  circuits: Circuit[],
  lines: CostLine[],
  seed: number,
  now: number,
): SavingsRecommendation[] {
  const recs: SavingsRecommendation[] = []

  for (const circuit of circuits) {
    if (circuit.role !== 'primary') continue
    const demand = siteDemand(devices, circuit.site)
    if (circuit.bandwidthMbps <= 0) continue
    if (demand / circuit.bandwidthMbps >= 0.25) continue
    const saving = Math.round(circuit.monthlyCostUsd * 0.25 * 100) / 100
    if (saving <= 0) continue
    recs.push({
      id: `sav-wan-${circuit.id}`,
      kind: 'downsize-circuit',
      title: `Downsize ${circuit.site} primary circuit`,
      detail: `Site demand is ${demand.toFixed(0)} Mbps against ${circuit.bandwidthMbps} Mbps provisioned (${costPerMbps(circuit)}/Mbps). Right-size to the next tier.`,
      monthlySavingUsd: saving,
    })
  }

  const records = new Map(
    lifecycleFleet(devices, now, seed).map((record) => [
      record.deviceId,
      record,
    ]),
  )
  for (const device of devices) {
    const record = records.get(device.id)
    if (!record?.refresh) continue
    if (device.status === 'online' && device.cpuPct > 25) continue
    const licLine = lines.find((line) => line.id === `fin-lic-${device.id}`)
    const pwrLine = lines.find((line) => line.id === `fin-pwr-${device.id}`)
    const saving =
      Math.round(
        ((licLine?.monthlyUsd ?? 0) + (pwrLine?.monthlyUsd ?? 0)) * 100,
      ) / 100
    if (saving <= 0) continue
    recs.push({
      id: `sav-dev-${device.id}`,
      kind: 'decommission',
      title: `Decommission ${device.name}`,
      detail: `${device.type} at ${device.site} is idle (CPU ${device.cpuPct}%, status ${device.status}) and already in the refresh queue — retire instead of refreshing.`,
      monthlySavingUsd: saving,
    })
  }

  const apLicenseLines = lines.filter(
    (line) =>
      line.category === 'licenses' &&
      devices.find((device) => device.id === line.deviceId)?.type ===
        'accessPoint',
  )
  const apTotal = apLicenseLines.reduce((sum, line) => sum + line.monthlyUsd, 0)
  if (apLicenseLines.length >= 3 && apTotal > 0) {
    const saving = Math.round(apTotal * 0.2 * 100) / 100
    recs.push({
      id: 'sav-lic-ap',
      kind: 'license-consolidate',
      title: 'Consolidate access-point licences',
      detail: `${apLicenseLines.length} APs carry $${apTotal.toFixed(2)}/mo of licences — bundle under a single enterprise agreement (≈20% typical discount).`,
      monthlySavingUsd: saving,
    })
  }

  const rng = mulberry32(hashSeed(`finops:sav:${seed}`))
  return recs
    .sort((a, b) => b.monthlySavingUsd - a.monthlySavingUsd)
    .map((rec, index) =>
      index < 3
        ? rec
        : {
            ...rec,
            monthlySavingUsd:
              Math.round(
                rec.monthlySavingUsd * (0.8 + rng.next() * 0.15) * 100,
              ) / 100,
          },
    )
}

/** Trailing 12-month history around the current total (oldest first). */
export function costHistory(totalMonthlyUsd: number, seed: number): number[] {
  const rng = mulberry32(hashSeed(`finops:hist:${seed}`))
  const points: number[] = []
  for (let i = HISTORY_MONTHS - 1; i >= 0; i -= 1) {
    const drift = 1 + (HISTORY_MONTHS - 1 - i) * 0.004
    const jitter = 1 + (rng.next() - 0.5) * 2 * HISTORY_JITTER_PCT
    points.push(Math.round(totalMonthlyUsd * drift * jitter * 100) / 100)
  }
  return points
}

/** Naive linear forecast: 2% month-over-month growth on the current total. */
export function forecast12(totalMonthlyUsd: number): number {
  let total = 0
  let current = totalMonthlyUsd
  for (let month = 0; month < HISTORY_MONTHS; month += 1) {
    current *= 1.02
    total += current
  }
  return Math.round(total * 100) / 100
}

/** Full FinOps view for the live fleet. */
export function runFinops(
  devices: Device[],
  seed: number,
  now: number,
): FinopsResult {
  const circuits = buildCircuits(devices, {}, seed)
  const lines = costLedger(devices, seed, now)
  const total =
    Math.round(lines.reduce((sum, line) => sum + line.monthlyUsd, 0) * 100) /
    100
  const byCategory: Record<CostCategory, number> = {
    wan: 0,
    power: 0,
    licenses: 0,
    refresh: 0,
  }
  for (const line of lines) {
    byCategory[line.category] =
      Math.round((byCategory[line.category] + line.monthlyUsd) * 100) / 100
  }
  const budgetUsd = budgetFor(devices)
  const varianceUsd = Math.round((total - budgetUsd) * 100) / 100
  const savings = savingsFor(devices, circuits, lines, seed, now)
  const savingsPotentialUsd =
    Math.round(
      savings.reduce((sum, rec) => sum + rec.monthlySavingUsd, 0) * 100,
    ) / 100

  return {
    lines,
    sites: siteBreakdown(lines),
    savings,
    summary: {
      totalMonthlyUsd: total,
      byCategory,
      budgetUsd,
      varianceUsd,
      variancePct:
        budgetUsd === 0 ? 0 : Math.round((varianceUsd / budgetUsd) * 1000) / 10,
      forecast12moUsd: forecast12(total),
      savingsPotentialUsd,
      costPerDeviceUsd:
        devices.length === 0
          ? 0
          : Math.round((total / devices.length) * 100) / 100,
    },
    history: costHistory(total, seed),
    circuits,
  }
}
