import type { Device, DeviceType, FaultInjection, Thresholds } from '@/types'
import { mulberry32, type Rng } from '@/simulation/random'
import { runTick } from '@/simulation/engine'
import { profileFor } from '@/simulation/profiles'
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import { utilizationPct, SATURATION_THRESHOLD_PCT } from '@/lib/capacity'

/**
 * What-if planning sandbox.
 *
 * Projects the fleet forward on a *clone* of the live devices using the real
 * deterministic engine, then overlays a scenario (add capacity, scale traffic,
 * fail a node or site) to estimate utilisation, headroom and where saturation
 * would land. Nothing here mutates the live store or its RNG — the planner
 * creates its own seeded generator so results are reproducible.
 */

export interface PlannerScenario {
  /** How many devices to add. */
  addCount: number
  addType: DeviceType
  addSite: string
  /** Fractional traffic change, e.g. 0.5 = +50%. */
  trafficScale: number
  /** Fractional capacity change, e.g. 0.5 = +50%. */
  capacityScale: number
  /** Device ids to take offline for the projection. */
  offlineIds: string[]
  /** Site to take fully offline for the projection. */
  offlineSite: string | null
}

export const DEFAULT_SCENARIO: PlannerScenario = {
  addCount: 0,
  addType: 'server',
  addSite: 'HQ',
  trafficScale: 0,
  capacityScale: 0,
  offlineIds: [],
  offlineSite: null,
}

const NEUTRAL_SCENARIO: PlannerScenario = { ...DEFAULT_SCENARIO }

export const PLANNER_STEPS = 12
export const PLANNER_DEFAULT_SEED = 0x9e3779b9

export interface FleetSnapshot {
  deviceCount: number
  totalThroughputMbps: number
  totalCapacityMbps: number
  fleetUtilPct: number
  avgLatencyMs: number
  saturatedCount: number
  offlineCount: number
}

export interface ProjectionPoint {
  t: number
  fleetUtilPct: number
  avgLatencyMs: number
  saturatedCount: number
  offlineCount: number
}

export interface SaturatedDevice {
  deviceId: string
  name: string
  site: string
  type: DeviceType
  utilPct: number
  added: boolean
}

export interface PlannerResult {
  baseline: FleetSnapshot
  projected: FleetSnapshot
  series: ProjectionPoint[]
  saturated: SaturatedDevice[]
  additions: Device[]
}

/** Effective throughput/capacity for a device under a scenario's scale factors. */
function effective(
  device: Device,
  scenario: PlannerScenario,
): { throughputMbps: number; capacityMbps: number } {
  return {
    throughputMbps: device.throughputMbps * (1 + scenario.trafficScale),
    capacityMbps: Math.max(
      1,
      device.capacityMbps * (1 + scenario.capacityScale),
    ),
  }
}

function utilizationFor(device: Device, scenario: PlannerScenario): number {
  const { throughputMbps, capacityMbps } = effective(device, scenario)
  return utilizationPct(throughputMbps, capacityMbps)
}

/** Summarise a fleet under a scenario's traffic/capacity overlays. */
export function snapshotFor(
  devices: Device[],
  scenario: PlannerScenario = NEUTRAL_SCENARIO,
): FleetSnapshot {
  let totalThroughputMbps = 0
  let totalCapacityMbps = 0
  let latencySum = 0
  let saturatedCount = 0
  let offlineCount = 0
  let counted = 0

  for (const device of devices) {
    const { throughputMbps, capacityMbps } = effective(device, scenario)
    totalThroughputMbps += throughputMbps
    totalCapacityMbps += capacityMbps
    latencySum += device.latencyMs
    counted += 1
    if (utilizationFor(device, scenario) >= SATURATION_THRESHOLD_PCT) {
      saturatedCount += 1
    }
    if (device.status === 'offline') offlineCount += 1
  }

  return {
    deviceCount: devices.length,
    totalThroughputMbps,
    totalCapacityMbps,
    fleetUtilPct: utilizationPct(totalThroughputMbps, totalCapacityMbps),
    avgLatencyMs: counted > 0 ? latencySum / counted : 0,
    saturatedCount,
    offlineCount,
  }
}

const ADDED_TAG = 'plan'

/** Generate the devices a scenario would add, from the type profile. */
export function generateAdditions(
  scenario: PlannerScenario,
  now: number,
  rng: Rng,
): Device[] {
  const count = Math.max(0, Math.floor(scenario.addCount))
  if (count === 0) return []
  const profile = profileFor(scenario.addType)
  const label = DEVICE_TYPE_LABELS[scenario.addType]
  const additions: Device[] = []
  for (let i = 0; i < count; i += 1) {
    const suffix = Math.floor(rng.next() * 1_000_000)
      .toString(16)
      .padStart(5, '0')
    additions.push({
      id: `plan-${scenario.addType}-${suffix}`,
      name: `${label} (plan ${i + 1})`,
      type: scenario.addType,
      site: scenario.addSite,
      ip: `10.99.${(i % 250) + 1}.${(suffix.charCodeAt(0) % 250) + 1}`,
      mac: `02:00:00:00:${(i % 250).toString(16).padStart(2, '0')}:${(suffix.charCodeAt(1) % 250).toString(16).padStart(2, '0')}`,
      status: 'online',
      tags: [ADDED_TAG],
      latencyMs: profile.latencyMs * (1 + rng.noise(0.2)),
      packetLossPct: profile.packetLossPct,
      availabilityPct: 99.9,
      throughputMbps: profile.throughputMbps,
      capacityMbps: profile.capacityMbps,
      cpuPct: profile.cpuPct,
      memoryPct: profile.memoryPct,
      uptimeSec: 0,
      lastSeen: now,
    })
  }
  return additions
}

/** Clone the original devices and append the scenario's additions. */
function workingSet(devices: Device[], additions: Device[]): Device[] {
  return [
    ...devices.map((device) => ({ ...device, tags: [...device.tags] })),
    ...additions,
  ]
}

function scenarioFaults(
  scenario: PlannerScenario,
  now: number,
): FaultInjection[] {
  const faults: FaultInjection[] = []
  scenario.offlineIds.forEach((id, index) => {
    faults.push({
      id: `plan-fault-dev-${index}`,
      kind: 'device-offline',
      target: id,
      appliedAt: now,
      expiresAt: null,
    })
  })
  if (scenario.offlineSite) {
    faults.push({
      id: 'plan-fault-site',
      kind: 'site-outage',
      target: scenario.offlineSite,
      appliedAt: now,
      expiresAt: null,
    })
  }
  return faults
}

export interface ProjectFleetInput {
  devices: Device[]
  scenario: PlannerScenario
  thresholds: Thresholds
  incidentFrequency: number
  now: number
  steps?: number
  stepMs?: number
  seed?: number
}

/**
 * Project the fleet forward under a scenario. Returns a baseline snapshot (the
 * untouched fleet), a projected snapshot, a per-step series and the devices
 * that would saturate.
 */
export function projectFleet(input: ProjectFleetInput): PlannerResult {
  const steps = Math.max(1, input.steps ?? PLANNER_STEPS)
  const stepMs = Math.max(1000, input.stepMs ?? 5000)
  const rng = mulberry32(input.seed ?? PLANNER_DEFAULT_SEED)
  const baseline = snapshotFor(input.devices, NEUTRAL_SCENARIO)

  const additions = generateAdditions(input.scenario, input.now, rng)
  const faults = scenarioFaults(input.scenario, input.now)
  let working = workingSet(input.devices, additions)

  const series: ProjectionPoint[] = []
  for (let step = 0; step < steps; step += 1) {
    const eventNow = input.now + step * stepMs
    const result = runTick({
      devices: working,
      incidents: [],
      thresholds: input.thresholds,
      steps: 1,
      incidentFrequency: input.incidentFrequency,
      now: eventNow,
      rng,
      stepMs,
      faults,
    })
    working = result.devices
    const snapshot = snapshotFor(working, input.scenario)
    series.push({
      t: eventNow,
      fleetUtilPct: snapshot.fleetUtilPct,
      avgLatencyMs: snapshot.avgLatencyMs,
      saturatedCount: snapshot.saturatedCount,
      offlineCount: snapshot.offlineCount,
    })
  }

  const projected = snapshotFor(working, input.scenario)
  const addedIds = new Set(additions.map((device) => device.id))
  const saturated: SaturatedDevice[] = working
    .filter(
      (device) =>
        utilizationFor(device, input.scenario) >= SATURATION_THRESHOLD_PCT,
    )
    .map((device) => ({
      deviceId: device.id,
      name: device.name,
      site: device.site,
      type: device.type,
      utilPct: utilizationFor(device, input.scenario),
      added: addedIds.has(device.id),
    }))
    .sort((a, b) => b.utilPct - a.utilPct)

  return { baseline, projected, series, saturated, additions }
}

export interface SnapshotDelta {
  fleetUtilPct: number
  avgLatencyMs: number
  saturatedCount: number
  offlineCount: number
  capacityMbps: number
}

/** Projected minus baseline, used to summarise the scenario's impact. */
export function scenarioDelta(
  baseline: FleetSnapshot,
  projected: FleetSnapshot,
): SnapshotDelta {
  return {
    fleetUtilPct: projected.fleetUtilPct - baseline.fleetUtilPct,
    avgLatencyMs: projected.avgLatencyMs - baseline.avgLatencyMs,
    saturatedCount: projected.saturatedCount - baseline.saturatedCount,
    offlineCount: projected.offlineCount - baseline.offlineCount,
    capacityMbps: projected.totalCapacityMbps - baseline.totalCapacityMbps,
  }
}

/** True when a scenario would actually change anything. */
export function isScenarioDirty(scenario: PlannerScenario): boolean {
  return (
    scenario.addCount > 0 ||
    scenario.trafficScale !== 0 ||
    scenario.capacityScale !== 0 ||
    scenario.offlineIds.length > 0 ||
    scenario.offlineSite !== null
  )
}

export function describeScenario(scenario: PlannerScenario): string {
  const parts: string[] = []
  if (scenario.addCount > 0) {
    parts.push(
      `+${scenario.addCount} ${DEVICE_TYPE_LABELS[scenario.addType]} at ${scenario.addSite}`,
    )
  }
  if (scenario.trafficScale !== 0) {
    parts.push(
      `${scenario.trafficScale > 0 ? '+' : ''}${Math.round(scenario.trafficScale * 100)}% traffic`,
    )
  }
  if (scenario.capacityScale !== 0) {
    parts.push(
      `${scenario.capacityScale > 0 ? '+' : ''}${Math.round(scenario.capacityScale * 100)}% capacity`,
    )
  }
  if (scenario.offlineIds.length > 0) {
    parts.push(`fail ${scenario.offlineIds.length} device(s)`)
  }
  if (scenario.offlineSite) parts.push(`fail site ${scenario.offlineSite}`)
  return parts.length > 0 ? parts.join(' · ') : 'No changes'
}
