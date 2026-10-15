import type { Device, Severity } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import { sitePower } from '@/lib/environment'

/**
 * Facility sensor engine (DCIM).
 *
 * environment.ts owns power, heat and carbon; this adds the *sensors*: CRAC
 * supply/return temperatures, humidity, sub-floor leak, perimeter smoke and
 * door-contact, per site with ASHRAE-style thresholds. Readings drift
 * deterministically from (sensorId, seed, tick); breaches and alarms become
 * findings, with hot-spot detection correlated against live facility load.
 */

export type SensorKind = 'temp' | 'humidity' | 'leak' | 'smoke' | 'door'
export type SensorZone =
  'supply' | 'return' | 'aisle' | 'floor' | 'perimeter' | 'entry'

export type FacilityFindingKind =
  'temp-high' | 'temp-low' | 'humidity' | 'leak' | 'smoke' | 'door-open'

export type SiteStatus = 'ok' | 'warning' | 'critical'

export interface FacilitySensor {
  id: string
  site: string
  kind: SensorKind
  zone: SensorZone
  label: string
  /** °C for temp, %RH for humidity, 0/1 for leak/smoke/door. */
  reading: number
  minThreshold: number
  maxThreshold: number
  inBand: boolean
}

export interface FacilityFinding {
  id: string
  sensorId: string
  site: string
  kind: FacilityFindingKind
  severity: Severity
  message: string
}

export interface SiteSensors {
  site: string
  sensors: FacilitySensor[]
  status: SiteStatus
  hottestZone: string
  hottestTempC: number
  avgTempC: number
  avgHumidityPct: number
  /** Live facility load (W) from environment.ts, for hot-spot context. */
  facilityWatts: number
}

export interface FacilitySummary {
  sites: number
  sensors: number
  ok: number
  warning: number
  critical: number
  hottestSite: string
  hottestTempC: number
  avgTempC: number
  findings: number
}

export interface FacilityResult {
  sensors: FacilitySensor[]
  sites: SiteSensors[]
  findings: FacilityFinding[]
  summary: FacilitySummary
}

/** ASHRAE recommended operating envelope. */
export const TEMP_BAND_C: readonly [number, number] = [18, 27]
export const HUMIDITY_BAND_PCT: readonly [number, number] = [40, 60]
export const DOOR_OPEN_LIMIT_MIN = 10
export const HOT_SPOT_TEMP_C = 27

const round1 = (value: number) => Math.round(value * 10) / 10

const ZONE_LABELS: Record<SensorZone, string> = {
  supply: 'CRAC supply',
  return: 'Hot-aisle return',
  aisle: 'Cold-aisle',
  floor: 'Sub-floor',
  perimeter: 'Perimeter',
  entry: 'Entry',
}

/** Six sensors per site: 2 temp, humidity, leak, smoke, door. */
export function generateSensors(site: string): FacilitySensor[] {
  const slug = site.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const draft = (
    kind: SensorKind,
    zone: SensorZone,
    suffix: string,
    min: number,
    max: number,
  ): FacilitySensor => ({
    id: `sen-${slug}-${suffix}`,
    site,
    kind,
    zone,
    label: `${ZONE_LABELS[zone]} ${kind}`,
    reading: 0,
    minThreshold: min,
    maxThreshold: max,
    inBand: true,
  })
  return [
    draft('temp', 'supply', 'supply', TEMP_BAND_C[0], TEMP_BAND_C[1]),
    draft('temp', 'return', 'return', TEMP_BAND_C[0], TEMP_BAND_C[1]),
    draft(
      'humidity',
      'aisle',
      'humidity',
      HUMIDITY_BAND_PCT[0],
      HUMIDITY_BAND_PCT[1],
    ),
    draft('leak', 'floor', 'leak', 0, 0),
    draft('smoke', 'perimeter', 'smoke', 0, 0),
    draft('door', 'entry', 'door', 0, DOOR_OPEN_LIMIT_MIN),
  ]
}

/**
 * Deterministic per-tick reading for one sensor.
 * Supply stays cool; return drifts into the hot aisle; humidity wanders;
 * leak/smoke/door are low-probability state flips.
 */
export function readSensor(
  sensor: FacilitySensor,
  seed: number,
  tick: number,
): FacilitySensor {
  const rng = mulberry32(hashSeed(`${sensor.id}:${seed}:${tick}`))
  let reading: number
  if (sensor.kind === 'temp' && sensor.zone === 'supply') {
    reading = 18 + rng.next() * 4 // 18–22 °C
  } else if (sensor.kind === 'temp') {
    reading = 23 + rng.next() * 5 // 23–28 °C (hot aisle)
  } else if (sensor.kind === 'humidity') {
    reading = 38 + rng.next() * 25 // 38–63 %RH
  } else if (sensor.kind === 'leak') {
    reading = rng.next() < 0.02 ? 1 : 0
  } else if (sensor.kind === 'smoke') {
    reading = rng.next() < 0.01 ? 1 : 0
  } else {
    reading = round1(rng.next() * 14) // door open minutes, 0–14
  }

  const inBand =
    sensor.kind === 'leak' || sensor.kind === 'smoke'
      ? reading === 0
      : reading >= sensor.minThreshold && reading <= sensor.maxThreshold

  return { ...sensor, reading: round1(reading), inBand }
}

/** Findings for one sensor reading (pure rule, unit-testable in isolation). */
export function sensorFinding(sensor: FacilitySensor): FacilityFinding | null {
  const base = {
    sensorId: sensor.id,
    site: sensor.site,
  }
  if (sensor.kind === 'leak' && sensor.reading === 1) {
    return {
      ...base,
      id: `${sensor.id}:leak`,
      kind: 'leak',
      severity: 'critical',
      message: `Water leak detected at ${sensor.site} (${sensor.label}).`,
    }
  }
  if (sensor.kind === 'smoke' && sensor.reading === 1) {
    return {
      ...base,
      id: `${sensor.id}:smoke`,
      kind: 'smoke',
      severity: 'critical',
      message: `Smoke detected at ${sensor.site} (${sensor.label}).`,
    }
  }
  if (sensor.kind === 'door' && sensor.reading > DOOR_OPEN_LIMIT_MIN) {
    return {
      ...base,
      id: `${sensor.id}:door`,
      kind: 'door-open',
      severity: 'low',
      message: `Door open ${sensor.reading} min at ${sensor.site} — tailgating/cooling loss risk.`,
    }
  }
  if (sensor.kind === 'temp' && sensor.reading > sensor.maxThreshold) {
    return {
      ...base,
      id: `${sensor.id}:high`,
      kind: 'temp-high',
      severity: sensor.reading >= HOT_SPOT_TEMP_C + 3 ? 'critical' : 'high',
      message: `Hot spot at ${sensor.site} — ${sensor.label} reads ${sensor.reading} °C (max ${sensor.maxThreshold} °C).`,
    }
  }
  if (sensor.kind === 'temp' && sensor.reading < sensor.minThreshold) {
    return {
      ...base,
      id: `${sensor.id}:low`,
      kind: 'temp-low',
      severity: 'medium',
      message: `Over-cooled at ${sensor.site} — ${sensor.label} reads ${sensor.reading} °C (min ${sensor.minThreshold} °C).`,
    }
  }
  if (sensor.kind === 'humidity' && !sensor.inBand) {
    return {
      ...base,
      id: `${sensor.id}:humidity`,
      kind: 'humidity',
      severity: 'medium',
      message: `Humidity out of band at ${sensor.site} — ${sensor.reading} %RH (allowed ${sensor.minThreshold}–${sensor.maxThreshold}).`,
    }
  }
  return null
}

export function runFacility(
  devices: Device[],
  seed: number,
  tick: number,
): FacilityResult {
  const siteNames = [...new Set(devices.map((device) => device.site))].sort()
  const sensors: FacilitySensor[] = []
  const sites: SiteSensors[] = []
  const findings: FacilityFinding[] = []

  for (const site of siteNames) {
    const siteSensors = generateSensors(site).map((sensor) =>
      readSensor(sensor, seed, tick),
    )
    sensors.push(...siteSensors)
    for (const sensor of siteSensors) {
      const finding = sensorFinding(sensor)
      if (finding) findings.push(finding)
    }

    const temps = siteSensors.filter((sensor) => sensor.kind === 'temp')
    const humidity = siteSensors.find((sensor) => sensor.kind === 'humidity')!
    const hottest = temps.reduce((a, b) => (a.reading >= b.reading ? a : b))
    const avgTempC = round1(
      temps.reduce((sum, sensor) => sum + sensor.reading, 0) / temps.length,
    )
    const criticalIds = new Set(
      findings
        .filter(
          (finding) => finding.site === site && finding.severity === 'critical',
        )
        .map((finding) => finding.sensorId),
    )
    const warningIds = new Set(
      findings
        .filter(
          (finding) => finding.site === site && finding.severity !== 'critical',
        )
        .map((finding) => finding.sensorId),
    )
    const status: SiteStatus = criticalIds.size
      ? 'critical'
      : warningIds.size
        ? 'warning'
        : 'ok'
    const power = sitePower(devices, site)

    sites.push({
      site,
      sensors: siteSensors,
      status,
      hottestZone: hottest.zone,
      hottestTempC: hottest.reading,
      avgTempC,
      avgHumidityPct: humidity.reading,
      facilityWatts: power.facilityWatts,
    })
  }

  const hottestSite = sites.reduce(
    (a, b) => (a.hottestTempC >= b.hottestTempC ? a : b),
    sites[0],
  )
  const tempsAll = sensors.filter((sensor) => sensor.kind === 'temp')
  const summary: FacilitySummary = {
    sites: sites.length,
    sensors: sensors.length,
    ok: sites.filter((site) => site.status === 'ok').length,
    warning: sites.filter((site) => site.status === 'warning').length,
    critical: sites.filter((site) => site.status === 'critical').length,
    hottestSite: hottestSite?.site ?? '',
    hottestTempC: hottestSite?.hottestTempC ?? 0,
    avgTempC:
      tempsAll.length === 0
        ? 0
        : round1(
            tempsAll.reduce((sum, sensor) => sum + sensor.reading, 0) /
              tempsAll.length,
          ),
    findings: findings.length,
  }

  return { sensors, sites, findings, summary }
}
