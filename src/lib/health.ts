import type {
  Device,
  DeviceStatus,
  DeviceType,
  HealthLevel,
  Severity,
  Thresholds,
} from '@/types'
import { clamp, clamp01 } from './format'

/**
 * Compute a 0-100 health score for a device from its simulated telemetry.
 *
 * The score blends latency, packet loss, availability and CPU pressure. It is
 * a pure function so it can be unit tested deterministically.
 */
export function computeHealthScore(
  device: Pick<
    Device,
    'latencyMs' | 'packetLossPct' | 'availabilityPct' | 'cpuPct' | 'status'
  >,
  thresholds: Thresholds,
): number {
  if (device.status === 'offline') return 0

  const latencyCeiling = Math.max(thousands(thresholds.latencyMs), 1) * 2
  const lossCeiling = Math.max(thresholds.packetLossPct, 0.1) * 4

  const latencyScore = clamp01(1 - device.latencyMs / latencyCeiling)
  const lossScore = clamp01(1 - device.packetLossPct / lossCeiling)
  const availabilityScore = clamp01(device.availabilityPct / 100)
  const cpuScore = clamp01(1 - device.cpuPct / 100)

  const score =
    100 *
    (0.3 * latencyScore +
      0.3 * lossScore +
      0.25 * availabilityScore +
      0.15 * cpuScore)

  return clamp(score, 0, 100)
}

function thousands(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1
}

export function healthLevel(score: number): HealthLevel {
  if (score >= 85) return 'healthy'
  if (score >= 60) return 'degraded'
  return 'critical'
}

/** Derive a device status purely from telemetry + thresholds. */
export function deriveStatus(
  device: Pick<
    Device,
    'latencyMs' | 'packetLossPct' | 'availabilityPct' | 'cpuPct' | 'status'
  >,
  thresholds: Thresholds,
): DeviceStatus {
  if (device.availabilityPct < thresholds.availabilityPct - 3) return 'offline'

  const score = computeHealthScore(device, thresholds)
  if (score >= 85) return 'online'
  if (score >= 55) return 'degraded'
  return 'offline'
}

/** Map a health score to an incident severity. */
export function severityForScore(score: number): Severity {
  if (score < 35) return 'critical'
  if (score < 55) return 'high'
  if (score < 70) return 'medium'
  return 'low'
}

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  router: 'Router',
  switch: 'Switch',
  firewall: 'Firewall',
  server: 'Server',
  accessPoint: 'Access Point',
}

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const HEALTH_LABELS: Record<HealthLevel, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
}

/** Tailwind classes per status, used by badges and topology nodes. */
export const STATUS_COLORS: Record<DeviceStatus, string> = {
  online: 'text-emerald-400',
  degraded: 'text-amber-400',
  offline: 'text-rose-500',
}

export const STATUS_HEX: Record<DeviceStatus, string> = {
  online: '#34d399',
  degraded: '#fbbf24',
  offline: '#f43f5e',
}

export const SEVERITY_HEX: Record<Severity, string> = {
  critical: '#f43f5e',
  high: '#fb923c',
  medium: '#fbbf24',
  low: '#38bdf8',
}
