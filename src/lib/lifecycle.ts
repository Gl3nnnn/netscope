import type { Device, DeviceType } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import { round } from './format'

/**
 * Lifecycle — asset end-of-life, end-of-support and warranty tracking.
 *
 * Devices carry no purchase date, so each device's acquisition date is derived
 * deterministically from its id hash and its type's support/warranty window.
 * All computations are pure given a `now` reference.
 */

export const SUPPORT_YEARS: Record<DeviceType, number> = {
  router: 7,
  switch: 8,
  firewall: 5,
  server: 5,
  accessPoint: 4,
}

export const WARRANTY_YEARS: Record<DeviceType, number> = {
  router: 5,
  switch: 5,
  firewall: 3,
  server: 3,
  accessPoint: 2,
}

export const MS_PER_DAY = 86_400_000

/** Windows (in days) under which an expiry is flagged as imminent. */
export const EOL_WARNING_DAYS = 180
export const WARRANTY_WARNING_DAYS = 90

export type LifecycleStatus = 'active' | 'approaching-eol' | 'eol'

export const LIFECYCLE_STATUS_LABELS: Record<LifecycleStatus, string> = {
  active: 'Active',
  'approaching-eol': 'Approaching EOL',
  eol: 'End of life',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Signed whole days from `now` until `target` (negative once past). */
export function daysUntilExpiry(target: number, now: number): number {
  return Math.ceil((target - now) / MS_PER_DAY)
}

export interface LifecycleRecord {
  deviceId: string
  deviceName: string
  type: DeviceType
  site: string
  acquiredAt: number
  ageDays: number
  warrantyEndsAt: number
  eolAt: number
  daysToWarranty: number
  daysToEol: number
  status: LifecycleStatus
  /** True when the device is at/past EOL or its warranty is nearly gone. */
  refresh: boolean
  riskScore: number
}

/** Deterministic lifecycle record for a device at a point in time. */
export function lifecycleFor(
  device: Device,
  now: number,
  seed = 0,
): LifecycleRecord {
  const rng = mulberry32((hashSeed(device.id) ^ seed) >>> 0)
  const ageDays = rng.int(200, 2600)
  const acquiredAt = now - ageDays * MS_PER_DAY
  const warrantyEndsAt =
    acquiredAt + WARRANTY_YEARS[device.type] * 365 * MS_PER_DAY
  const eolAt = acquiredAt + SUPPORT_YEARS[device.type] * 365 * MS_PER_DAY
  const daysToWarranty = daysUntilExpiry(warrantyEndsAt, now)
  const daysToEol = daysUntilExpiry(eolAt, now)

  const status: LifecycleStatus =
    daysToEol <= 0
      ? 'eol'
      : daysToEol <= EOL_WARNING_DAYS
        ? 'approaching-eol'
        : 'active'

  const refresh = status !== 'active' || daysToWarranty <= WARRANTY_WARNING_DAYS

  const eolFactor = clamp(1 - daysToEol / 730, 0, 1)
  const warrantyFactor =
    daysToWarranty <= 0 ? 1 : clamp(1 - daysToWarranty / 365, 0, 1)
  const riskScore = round((eolFactor * 0.7 + warrantyFactor * 0.3) * 100, 1)

  return {
    deviceId: device.id,
    deviceName: device.name,
    type: device.type,
    site: device.site,
    acquiredAt,
    ageDays,
    warrantyEndsAt,
    eolAt,
    daysToWarranty,
    daysToEol,
    status,
    refresh,
    riskScore,
  }
}

/** Lifecycle records for a whole fleet at a point in time. */
export function lifecycleFleet(
  devices: Device[],
  now: number,
  seed = 0,
): LifecycleRecord[] {
  return devices.map((device) => lifecycleFor(device, now, seed))
}

export interface LifecycleSummary {
  total: number
  active: number
  approaching: number
  eol: number
  refreshCount: number
  avgRisk: number
  oldestDays: number
}

export function lifecycleSummary(records: LifecycleRecord[]): LifecycleSummary {
  const total = records.length
  const active = records.filter((r) => r.status === 'active').length
  const approaching = records.filter(
    (r) => r.status === 'approaching-eol',
  ).length
  const eol = records.filter((r) => r.status === 'eol').length
  const refreshCount = records.filter((r) => r.refresh).length
  const avgRisk =
    total === 0
      ? 0
      : round(records.reduce((sum, r) => sum + r.riskScore, 0) / total, 1)
  const oldestDays =
    total === 0 ? 0 : Math.max(...records.map((r) => r.ageDays))
  return { total, active, approaching, eol, refreshCount, avgRisk, oldestDays }
}

/** Devices recommended for refresh, highest risk first. */
export function refreshQueue(records: LifecycleRecord[]): LifecycleRecord[] {
  return records
    .filter((record) => record.refresh)
    .sort((a, b) => b.riskScore - a.riskScore)
}
