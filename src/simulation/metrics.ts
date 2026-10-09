import type { Device, Thresholds } from '@/types'
import { clamp, round } from '@/lib/format'
import { deriveStatus } from '@/lib/health'
import type { Rng } from './random'

export interface AdvancedDevice {
  device: Device
  statusChanged: boolean
}

/**
 * Advance a single device's simulated telemetry by one step using a random
 * walk around its current values. Pure aside from the injected RNG.
 */
export function advanceDevice(
  device: Device,
  rng: Rng,
  thresholds: Thresholds,
  now: number,
  intensity = 1,
): AdvancedDevice {
  const drift = (value: number, spread: number, min: number, max: number) =>
    clamp(value + rng.noise(spread) * intensity, min, max)

  // Occasional events create realistic spikes / outages.
  const spiking = rng.chance(0.04 * intensity)
  const outageChance = device.status === 'offline' ? 0.25 : 0.004
  const recovering = device.status === 'offline' && rng.chance(0.45)

  let latency = drift(device.latencyMs, 0.8, 0.4, 400)
  let loss = drift(device.packetLossPct, 0.15, 0, 40)
  let availability = drift(device.availabilityPct, 0.05, 80, 100)
  const throughput = drift(device.throughputMbps, 25, 10, 9000)
  let cpu = drift(device.cpuPct, 2.5, 2, 100)
  const memory = drift(device.memoryPct, 1.6, 10, 99)

  if (spiking) {
    latency *= rng.range(1.8, 4.5)
    loss += rng.range(1.5, 6)
    cpu = clamp(cpu + rng.range(10, 30), 2, 100)
  }

  let status: Device['status'] = device.status
  if (device.status === 'offline' && !recovering) {
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
    uptimeSec:
      status === 'offline' ? 0 : device.uptimeSec + Math.round(rng.range(1, 3)),
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
