import type {
  Device,
  DeviceStatus,
  DeviceType,
  HealthLevel,
  Thresholds,
} from '@/types'
import { computeHealthScore, healthLevel } from './health'

export function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function averageLatency(devices: Device[]): number {
  return average(devices.map((d) => d.latencyMs))
}

export function averagePacketLoss(devices: Device[]): number {
  return average(devices.map((d) => d.packetLossPct))
}

export function averageAvailability(devices: Device[]): number {
  return average(devices.map((d) => d.availabilityPct))
}

export function statusCounts(devices: Device[]): Record<DeviceStatus, number> {
  const counts: Record<DeviceStatus, number> = {
    online: 0,
    degraded: 0,
    offline: 0,
  }
  for (const device of devices) counts[device.status] += 1
  return counts
}

export function typeCounts(devices: Device[]): Record<DeviceType, number> {
  const counts: Record<DeviceType, number> = {
    router: 0,
    switch: 0,
    firewall: 0,
    server: 0,
    accessPoint: 0,
  }
  for (const device of devices) counts[device.type] += 1
  return counts
}

/** Fleet-wide health score 0-100. */
export function overallHealth(
  devices: Device[],
  thresholds: Thresholds,
): number {
  if (devices.length === 0) return 0
  return average(devices.map((d) => computeHealthScore(d, thresholds)))
}

export function healthDistribution(
  devices: Device[],
  thresholds: Thresholds,
): Record<HealthLevel, number> {
  const dist: Record<HealthLevel, number> = {
    healthy: 0,
    degraded: 0,
    critical: 0,
  }
  for (const device of devices) {
    dist[healthLevel(computeHealthScore(device, thresholds))] += 1
  }
  return dist
}

export interface AggregateSample {
  t: number
  latencyMs: number
  packetLossPct: number
  availabilityPct: number
}

/**
 * Aggregate per-device history into a single fleet-wide time series, aligned by
 * timestamp. Used by the dashboard charts.
 */
export function aggregateHistory(
  devices: Device[],
  history: Record<
    string,
    {
      t: number
      latencyMs: number
      packetLossPct: number
      availabilityPct: number
    }[]
  >,
): AggregateSample[] {
  const buckets = new Map<
    number,
    { lat: number[]; loss: number[]; avail: number[] }
  >()
  for (const device of devices) {
    const samples = history[device.id]
    if (!samples) continue
    for (const sample of samples) {
      let bucket = buckets.get(sample.t)
      if (!bucket) {
        bucket = { lat: [], loss: [], avail: [] }
        buckets.set(sample.t, bucket)
      }
      bucket.lat.push(sample.latencyMs)
      bucket.loss.push(sample.packetLossPct)
      bucket.avail.push(sample.availabilityPct)
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, bucket]) => ({
      t,
      latencyMs: Number(average(bucket.lat).toFixed(2)),
      packetLossPct: Number(average(bucket.loss).toFixed(2)),
      availabilityPct: Number(average(bucket.avail).toFixed(3)),
    }))
}
