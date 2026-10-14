import type { Device, DeviceType } from '@/types'
import { round } from './format'

/**
 * Environment — power, heat, carbon and energy-cost modelling.
 *
 * Every device's draw is interpolated between an idle and a peak wattage from
 * its type profile, driven by a load factor derived from live CPU and
 * throughput utilisation. Derived aggregates are deterministic.
 */

export interface PowerProfile {
  idleWatts: number
  maxWatts: number
}

export const POWER_PROFILES: Record<DeviceType, PowerProfile> = {
  router: { idleWatts: 140, maxWatts: 420 },
  switch: { idleWatts: 110, maxWatts: 380 },
  firewall: { idleWatts: 80, maxWatts: 260 },
  server: { idleWatts: 120, maxWatts: 520 },
  accessPoint: { idleWatts: 12, maxWatts: 30 },
}

/** kg CO2 emitted per kWh drawn from the grid. */
export const CARBON_INTENSITY = 0.42
/** USD per kWh. */
export const ENERGY_RATE = 0.14
/** BTU released per watt-hour of heat. */
export const BTU_PER_WATT_HOUR = 3.412
/** Facility power-usage-effectiveness baseline (IT + cooling/overhead). */
export const FACILITY_PUE = 1.45

export type EnvironmentGrade = 'excellent' | 'good' | 'poor'

export const ENVIRONMENT_GRADE_LABELS: Record<EnvironmentGrade, string> = {
  excellent: 'Efficient',
  good: 'Fair',
  poor: 'Inefficient',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 0..1 blend of CPU and throughput utilisation. */
function loadFactor(device: Device): number {
  const util =
    device.capacityMbps > 0 ? device.throughputMbps / device.capacityMbps : 0
  return clamp((device.cpuPct / 100 + util) / 2, 0, 1)
}

export interface DevicePower {
  deviceId: string
  deviceName: string
  type: DeviceType
  site: string
  loadPct: number
  watts: number
  heatBtuHr: number
  co2KgDay: number
  costPerDay: number
}

export function devicePower(device: Device): DevicePower {
  const profile = POWER_PROFILES[device.type]
  const load = loadFactor(device)
  const watts =
    profile.idleWatts + (profile.maxWatts - profile.idleWatts) * load
  const kwhDay = (watts / 1000) * 24
  return {
    deviceId: device.id,
    deviceName: device.name,
    type: device.type,
    site: device.site,
    loadPct: round(load * 100, 1),
    watts: round(watts, 1),
    heatBtuHr: round(watts * BTU_PER_WATT_HOUR, 1),
    co2KgDay: round(kwhDay * CARBON_INTENSITY, 2),
    costPerDay: round(kwhDay * ENERGY_RATE, 2),
  }
}

export interface SitePower {
  site: string
  deviceCount: number
  itWatts: number
  facilityWatts: number
  coolingWatts: number
  avgLoadPct: number
  co2KgDay: number
  costPerDay: number
}

export function sitePower(devices: Device[], site: string): SitePower {
  const members = devices.filter((device) => device.site === site)
  const powers = members.map(devicePower)
  const itWatts = powers.reduce((sum, power) => sum + power.watts, 0)
  const facilityWatts = itWatts * FACILITY_PUE
  const avgLoadPct =
    members.length === 0
      ? 0
      : round(
          powers.reduce((sum, power) => sum + power.loadPct, 0) /
            members.length,
          1,
        )
  return {
    site,
    deviceCount: members.length,
    itWatts: round(itWatts, 1),
    facilityWatts: round(facilityWatts, 1),
    coolingWatts: round(facilityWatts - itWatts, 1),
    avgLoadPct,
    co2KgDay: round(
      powers.reduce((sum, power) => sum + power.co2KgDay, 0),
      2,
    ),
    costPerDay: round(
      powers.reduce((sum, power) => sum + power.costPerDay, 0),
      2,
    ),
  }
}

export interface PowerSummary {
  deviceCount: number
  itWatts: number
  peakWatts: number
  facilityWatts: number
  coolingWatts: number
  heatBtuHr: number
  co2KgDay: number
  costPerDay: number
  avgLoadPct: number
}

export function powerSummary(devices: Device[]): PowerSummary {
  const powers = devices.map(devicePower)
  const itWatts = powers.reduce((sum, power) => sum + power.watts, 0)
  const peakWatts = devices.reduce(
    (sum, device) => sum + POWER_PROFILES[device.type].maxWatts,
    0,
  )
  const facilityWatts = itWatts * FACILITY_PUE
  return {
    deviceCount: devices.length,
    itWatts: round(itWatts, 1),
    peakWatts: round(peakWatts, 1),
    facilityWatts: round(facilityWatts, 1),
    coolingWatts: round(facilityWatts - itWatts, 1),
    heatBtuHr: round(itWatts * BTU_PER_WATT_HOUR, 1),
    co2KgDay: round(
      powers.reduce((sum, power) => sum + power.co2KgDay, 0),
      2,
    ),
    costPerDay: round(
      powers.reduce((sum, power) => sum + power.costPerDay, 0),
      2,
    ),
    avgLoadPct:
      devices.length === 0
        ? 0
        : round(
            powers.reduce((sum, power) => sum + power.loadPct, 0) /
              devices.length,
            1,
          ),
  }
}

export interface SiteCarbon {
  site: string
  co2KgDay: number
  itWatts: number
  deviceCount: number
}

/** Per-site carbon rollup, highest emitter first. */
export function carbonBySite(devices: Device[]): SiteCarbon[] {
  const sites = [...new Set(devices.map((device) => device.site))]
  return sites
    .map((site) => {
      const power = sitePower(devices, site)
      return {
        site,
        co2KgDay: power.co2KgDay,
        itWatts: power.itWatts,
        deviceCount: power.deviceCount,
      }
    })
    .sort((a, b) => b.co2KgDay - a.co2KgDay)
}

export interface EnvironmentScore {
  score: number
  grade: EnvironmentGrade
  avgLoadPct: number
}

/**
 * Efficiency score: rewards a balanced fleet load (a 30-70% band is the
 * efficiency sweet spot) and penalises both idle waste and overload.
 */
export function environmentScore(devices: Device[]): EnvironmentScore {
  const avgLoad = powerSummary(devices).avgLoadPct / 100
  const distance = Math.abs(avgLoad - 0.5)
  const score = round(clamp((1 - distance * 2) * 100, 0, 100), 1)
  const grade: EnvironmentGrade =
    score >= 80 ? 'excellent' : score >= 55 ? 'good' : 'poor'
  return { score, grade, avgLoadPct: round(avgLoad * 100, 1) }
}

/** Watts per rack for a site, given a rack count. */
export function rackDensity(devices: Device[], site: string, racks: number) {
  const power = sitePower(devices, site)
  return round(racks > 0 ? power.facilityWatts / racks : 0, 1)
}
