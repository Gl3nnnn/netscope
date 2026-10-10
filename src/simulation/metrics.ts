import type { Device, Thresholds } from '@/types'
import { clamp, round } from '@/lib/format'
import { utilizationPct } from '@/lib/capacity'
import { deriveStatus } from '@/lib/health'
import type { Rng } from './random'
import { profileFor } from './profiles'
import { trafficMultiplier } from './timecurve'

export interface AdvancedDevice {
  device: Device
  statusChanged: boolean
}

export interface AdvanceOptions {
  /** Scales random-walk spread and spike/outage probability. */
  intensity?: number
  /** Extra outage pressure (e.g. during a simulated site-wide disturbance). */
  outageBoost?: number
  /** Simulated wall-clock time between inner steps, in milliseconds. */
  stepMs?: number
  /** Force the device offline this step (user-injected fault). */
  forcedOffline?: boolean
  /** Pin throughput toward the capacity ceiling (user-injected saturation). */
  saturated?: boolean
}

/**
 * Advance a single device's simulated telemetry by one step.
 *
 * Values mean-revert toward the device type's baseline profile (from
 * `profiles.ts`) while a random walk adds noise, and the daily/weekly
 * traffic curve (`timecurve.ts`) shifts throughput along with the hour.
 * Pure aside from the injected RNG, so the whole simulation stays
 * deterministic and unit testable.
 */
export function advanceDevice(
  device: Device,
  rng: Rng,
  thresholds: Thresholds,
  now: number,
  options: AdvanceOptions = {},
): AdvancedDevice {
  const {
    intensity = 1,
    outageBoost = 0,
    stepMs = 5000,
    forcedOffline = false,
    saturated = false,
  } = options
  const profile = profileFor(device.type)
  const volatility = profile.volatility * intensity
  const load = trafficMultiplier(now)

  const walk = (
    value: number,
    baseline: number,
    spread: number,
    min: number,
    max: number,
  ) =>
    clamp(
      value + (baseline - value) * 0.08 + rng.noise(spread) * volatility,
      min,
      max,
    )

  let latency = walk(device.latencyMs, profile.latencyMs, 0.8, 0.4, 400)
  let loss = walk(device.packetLossPct, profile.packetLossPct, 0.15, 0, 40)
  let availability = walk(device.availabilityPct, 99.9, 0.05, 80, 100)

  // Throughput rides the daily traffic curve around the type baseline. A
  // user-injected saturation pins it near the device capacity ceiling.
  let throughput = walk(
    device.throughputMbps,
    profile.throughputMbps * load,
    25,
    10,
    Math.max(2000, profile.capacityMbps * 1.5),
  )
  if (saturated) {
    throughput = clamp(
      profile.capacityMbps * rng.range(0.85, 0.97),
      10,
      Math.max(2000, profile.capacityMbps * 1.5),
    )
  }
  const util = utilizationPct(throughput, profile.capacityMbps)

  let cpu = walk(device.cpuPct, profile.cpuPct, 2.5, 2, 100)

  // Memory creeps upward until the occasional GC-style reclaim drops it again,
  // producing the classic sawtooth pattern.
  let memory = clamp(
    device.memoryPct + rng.range(0.05, 0.35) * volatility,
    10,
    99,
  )
  if (rng.chance(0.025 * intensity)) {
    memory = clamp(memory - rng.range(8, 20), 10, 99)
  } else if (rng.chance(0.004 * intensity)) {
    memory = clamp(memory + rng.range(2, 8), 10, 99)
  }

  // Simulated maintenance windows occasionally take a device out of the
  // incident stream while it is being worked on.
  let inMaintenance = device.inMaintenance ?? false
  if (inMaintenance) {
    if (rng.chance(0.06)) inMaintenance = false
  } else if (rng.chance(0.0006 * intensity)) {
    inMaintenance = true
  }

  // Occasional events create realistic spikes / outages. Busier hours are
  // slightly more failure-prone.
  const loadFactor = 0.6 + 0.8 * load
  const spiking = !inMaintenance && rng.chance(0.04 * intensity * loadFactor)
  const outageChance =
    (device.status === 'offline' ? 0.25 : 0.004) *
    (1 + outageBoost) *
    (inMaintenance ? 0.15 : 1) *
    loadFactor
  const recovering = device.status === 'offline' && rng.chance(0.45)

  if (spiking) {
    latency *= rng.range(1.8, 4.5)
    loss += rng.range(1.5, 6)
    cpu = clamp(cpu + rng.range(10, 30), 2, 100)
  }

  // Utilisation places a floor under CPU: a heavily loaded box is busy.
  cpu = clamp(cpu + (util / 100) * 10, 2, 100)
  if (saturated) cpu = clamp(Math.max(cpu, rng.range(78, 96)), 2, 100)

  let status: Device['status'] = device.status
  if (forcedOffline) {
    status = 'offline'
    availability = clamp(Math.min(availability, rng.range(58, 74)), 0, 100)
    loss = clamp(loss + rng.range(10, 30), 0, 100)
    latency = clamp(latency * 1.5 + rng.range(20, 90), 0, 2000)
  } else if (device.status === 'offline' && !recovering) {
    status = 'offline'
    loss = clamp(loss + rng.range(5, 20), 0, 100)
    availability = clamp(availability - rng.range(0.2, 2), 0, 100)
    latency = clamp(latency * 1.6, 0, 2000)
  } else if (rng.chance(outageChance)) {
    status = 'offline'
    availability = clamp(availability - rng.range(4, 12), 0, 100)
    loss = clamp(loss + rng.range(8, 30), 0, 100)
  } else if (recovering) {
    status = 'online'
    availability = clamp(Math.max(availability, rng.range(99, 99.9)), 0, 100)
    loss = round(rng.range(0, 0.4), 2)
    latency = round(rng.range(2, 10), 2)
  }

  const candidate: Device = {
    ...device,
    latencyMs: round(latency, 2),
    packetLossPct: round(clamp(loss, 0, 100), 2),
    availabilityPct: round(clamp(availability, 0, 100), 3),
    throughputMbps: round(throughput, 1),
    cpuPct: round(cpu, 1),
    memoryPct: round(memory, 1),
    inMaintenance,
    uptimeSec:
      status === 'offline' ? 0 : device.uptimeSec + Math.round(stepMs / 1000),
    lastSeen: status === 'offline' ? device.lastSeen : now,
  }

  if (status !== 'offline') {
    candidate.status = deriveStatus(candidate, thresholds)
  } else {
    candidate.status = 'offline'
  }

  return {
    device: candidate,
    statusChanged: candidate.status !== device.status,
  }
}
