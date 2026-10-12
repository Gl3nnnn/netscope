import type { Device } from '@/types'

/**
 * Synthetic uptime monitors. Monitors probe the simulated fleet on an interval
 * (device, site or whole fleet), derive an up/degraded/down state from the
 * telemetry and feed a rolling check history used by the public status page.
 * Pure and dependency-free so it can be unit tested.
 */

export type MonitorTargetKind = 'fleet' | 'device' | 'site'
export type MonitorStatus = 'up' | 'degraded' | 'down'

export interface Monitor {
  id: string
  name: string
  target: MonitorTargetKind
  /** Device id or site name; unused for fleet monitors. */
  targetId: string | null
  /** How often the probe runs, in ms. */
  intervalMs: number
  /** Latency above which the monitor degrades. */
  latencyThresholdMs: number
  /** Packet loss at/above which the monitor goes down. */
  lossThresholdPct: number
  enabled: boolean
  /** Epoch ms of the last completed check, 0 before the first run. */
  lastCheckedAt: number
}

export interface MonitorCheck {
  at: number
  latencyMs: number
  lossPct: number
  availabilityPct: number
  status: MonitorStatus
}

/** Hard cap on the rolling check history retained per monitor. */
export const MAX_CHECK_HISTORY = 60

export function monitorStatus(
  latencyMs: number,
  lossPct: number,
  availabilityPct: number,
  latencyThresholdMs: number,
  lossThresholdPct: number,
): MonitorStatus {
  if (availabilityPct < 95 || lossPct >= lossThresholdPct) return 'down'
  if (latencyMs > latencyThresholdMs || lossPct >= 0.5) return 'degraded'
  return 'up'
}

/** The devices a monitor probes, honouring its target kind. */
export function targetDevices(
  monitor: Pick<Monitor, 'target' | 'targetId'>,
  devices: Device[],
): Device[] {
  if (monitor.target === 'device') {
    return devices.filter((device) => device.id === monitor.targetId)
  }
  if (monitor.target === 'site') {
    return devices.filter((device) => device.site === monitor.targetId)
  }
  return devices
}

export interface RunCheckInput {
  monitor: Monitor
  devices: Device[]
  now: number
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Run one check for a monitor against the fleet. */
export function runCheck(input: RunCheckInput): MonitorCheck | null {
  const { monitor, devices, now } = input
  const targets = targetDevices(monitor, devices)
  if (targets.length === 0) return null

  const latencyMs = average(targets.map((device) => device.latencyMs))
  const lossPct = average(targets.map((device) => device.packetLossPct))
  const availabilityPct = average(
    targets.map((device) => device.availabilityPct),
  )
  return {
    at: now,
    latencyMs: Number(latencyMs.toFixed(1)),
    lossPct: Number(lossPct.toFixed(2)),
    availabilityPct: Number(availabilityPct.toFixed(3)),
    status: monitorStatus(
      latencyMs,
      lossPct,
      availabilityPct,
      monitor.latencyThresholdMs,
      monitor.lossThresholdPct,
    ),
  }
}

/** Availability percentage over the retained checks (down = unavailable). */
export function uptimePct(checks: MonitorCheck[]): number | null {
  if (checks.length === 0) return null
  const available = checks.filter((check) => check.status !== 'down').length
  return (available / checks.length) * 100
}

/** Check history trimmed to the retained window. */
export function trimChecks(checks: MonitorCheck[]): MonitorCheck[] {
  return checks.slice(-MAX_CHECK_HISTORY)
}

export interface NewMonitorInput {
  name: string
  target: MonitorTargetKind
  targetId: string | null
  intervalMs: number
  latencyThresholdMs: number
  lossThresholdPct: number
}

export const MONITOR_INTERVAL_OPTIONS = [5_000, 10_000, 30_000, 60_000] as const

export const DEFAULT_MONITOR: NewMonitorInput = {
  name: '',
  target: 'fleet',
  targetId: null,
  intervalMs: 10_000,
  latencyThresholdMs: 120,
  lossThresholdPct: 5,
}

export const MONITOR_STATUS_LABELS: Record<MonitorStatus, string> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Outage',
}
