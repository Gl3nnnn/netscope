import type { Device, DeviceType, Severity } from '@/types'
import { utilizationPct } from './capacity'
import { round } from './format'

/**
 * A small, dependency-free alerting engine. Users define rules over the
 * simulated metrics; each tick the engine evaluates every device against every
 * rule and tracks pending -> firing -> resolved transitions. Pure and
 * deterministic so it can be unit tested and reasoned about.
 */

export type AlertMetric =
  | 'latencyMs'
  | 'packetLossPct'
  | 'availabilityPct'
  | 'cpuPct'
  | 'memoryPct'
  | 'utilizationPct'

export type AlertOp = 'gt' | 'gte' | 'lt' | 'lte'

export interface AlertScope {
  type?: DeviceType
  site?: string
  tag?: string
}

export interface AlertRule {
  id: string
  name: string
  metric: AlertMetric
  op: AlertOp
  threshold: number
  /** Condition must hold continuously for this long before firing. */
  forMs: number
  severity: Severity
  scope?: AlertScope
}

export type AlertStatus = 'pending' | 'firing'

export interface AlertInstance {
  /** `${ruleId}:${deviceId}` - stable identity across evaluations. */
  id: string
  ruleId: string
  ruleName: string
  deviceId: string
  deviceName: string
  severity: Severity
  status: AlertStatus
  /** Epoch ms the condition first became true. */
  startedAt: number
  /** Epoch ms the alert began firing, or null while still pending. */
  firedAt: number | null
  /** Epoch ms the alert resolved; only set on history entries. */
  resolvedAt?: number | null
  /** Latest observed metric value. */
  value: number
}

export interface AlertChange {
  kind: 'firing' | 'resolved'
  instance: AlertInstance
}

export interface MetricMeta {
  key: AlertMetric
  label: string
  unit: string
  /** Default operator/threshold used when building a new rule. */
  op: AlertOp
  threshold: number
  /** Minimum sane value used by the rule editor. */
  max: number
}

export const ALERT_METRICS: MetricMeta[] = [
  {
    key: 'latencyMs',
    label: 'Latency',
    unit: 'ms',
    op: 'gt',
    threshold: 120,
    max: 2000,
  },
  {
    key: 'packetLossPct',
    label: 'Packet loss',
    unit: '%',
    op: 'gt',
    threshold: 5,
    max: 100,
  },
  {
    key: 'availabilityPct',
    label: 'Availability',
    unit: '%',
    op: 'lt',
    threshold: 97,
    max: 100,
  },
  { key: 'cpuPct', label: 'CPU', unit: '%', op: 'gt', threshold: 90, max: 100 },
  {
    key: 'memoryPct',
    label: 'Memory',
    unit: '%',
    op: 'gt',
    threshold: 92,
    max: 100,
  },
  {
    key: 'utilizationPct',
    label: 'Link utilisation',
    unit: '%',
    op: 'gt',
    threshold: 90,
    max: 100,
  },
]

const METRIC_BY_KEY = new Map(ALERT_METRICS.map((meta) => [meta.key, meta]))

export function metricMeta(metric: AlertMetric): MetricMeta {
  return METRIC_BY_KEY.get(metric) ?? ALERT_METRICS[0]
}

export function metricValue(device: Device, metric: AlertMetric): number {
  switch (metric) {
    case 'latencyMs':
      return device.latencyMs
    case 'packetLossPct':
      return device.packetLossPct
    case 'availabilityPct':
      return device.availabilityPct
    case 'cpuPct':
      return device.cpuPct
    case 'memoryPct':
      return device.memoryPct
    case 'utilizationPct':
      return utilizationPct(device.throughputMbps, device.capacityMbps)
  }
}

export const OP_SYMBOLS: Record<AlertOp, string> = {
  gt: '>',
  gte: '\u2265',
  lt: '<',
  lte: '\u2264',
}

export function compare(
  value: number,
  op: AlertOp,
  threshold: number,
): boolean {
  switch (op) {
    case 'gt':
      return value > threshold
    case 'gte':
      return value >= threshold
    case 'lt':
      return value < threshold
    case 'lte':
      return value <= threshold
  }
}

export function scopeMatches(
  device: Pick<Device, 'type' | 'site' | 'tags'>,
  scope?: AlertScope,
): boolean {
  if (!scope) return true
  if (scope.type && device.type !== scope.type) return false
  if (scope.site && device.site !== scope.site) return false
  if (scope.tag && !device.tags.includes(scope.tag)) return false
  return true
}

export function describeCondition(rule: AlertRule): string {
  const meta = metricMeta(rule.metric)
  return `${meta.label} ${OP_SYMBOLS[rule.op]} ${rule.threshold}${meta.unit}`
}

export function describeDuration(ms: number): string {
  if (ms <= 0) return 'immediately'
  if (ms < 60000) return `for ${Math.round(ms / 1000)}s`
  return `for ${Math.round(ms / 60000)}m`
}

export function alertMessage(
  instance: AlertInstance,
  metric: AlertMetric,
): string {
  const meta = metricMeta(metric)
  const value = `${round(instance.value, 1)}${meta.unit}`
  return `${instance.ruleName}: ${instance.deviceName} ${meta.label.toLowerCase()} at ${value}`
}

export const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'rule_latency',
    name: 'High latency',
    metric: 'latencyMs',
    op: 'gt',
    threshold: 120,
    forMs: 10_000,
    severity: 'high',
  },
  {
    id: 'rule_loss',
    name: 'Packet loss',
    metric: 'packetLossPct',
    op: 'gt',
    threshold: 5,
    forMs: 10_000,
    severity: 'high',
  },
  {
    id: 'rule_down',
    name: 'Host unreachable',
    metric: 'availabilityPct',
    op: 'lt',
    threshold: 97,
    forMs: 5_000,
    severity: 'critical',
  },
  {
    id: 'rule_cpu',
    name: 'CPU saturation',
    metric: 'cpuPct',
    op: 'gt',
    threshold: 90,
    forMs: 30_000,
    severity: 'medium',
  },
  {
    id: 'rule_link',
    name: 'Link saturation',
    metric: 'utilizationPct',
    op: 'gt',
    threshold: 90,
    forMs: 30_000,
    severity: 'medium',
  },
  {
    id: 'rule_memory',
    name: 'Memory pressure',
    metric: 'memoryPct',
    op: 'gt',
    threshold: 92,
    forMs: 30_000,
    severity: 'low',
  },
]

export interface EvaluateInput {
  devices: Device[]
  rules: AlertRule[]
  /** Prior alert states keyed by instance id. */
  states: Record<string, AlertInstance>
  now: number
}

export interface EvaluateResult {
  states: Record<string, AlertInstance>
  changes: AlertChange[]
}

export function alertInstanceId(ruleId: string, deviceId: string): string {
  return `${ruleId}:${deviceId}`
}

/**
 * Evaluate all rules against all devices, advancing pending/firing/resolved
 * state. Returns the next state map plus the transitions to surface.
 */
export function evaluateAlerts(input: EvaluateInput): EvaluateResult {
  const { devices, rules, states, now } = input
  const next: Record<string, AlertInstance> = {}
  const changes: AlertChange[] = []

  for (const rule of rules) {
    for (const device of devices) {
      if (!scopeMatches(device, rule.scope)) continue
      const value = round(metricValue(device, rule.metric), 2)
      const violating = compare(
        metricValue(device, rule.metric),
        rule.op,
        rule.threshold,
      )
      const id = alertInstanceId(rule.id, device.id)
      const prev = states[id]

      if (!violating) {
        if (prev?.status === 'firing') {
          changes.push({ kind: 'resolved', instance: prev })
        }
        continue
      }

      if (!prev) {
        const fired = rule.forMs <= 0
        next[id] = {
          id,
          ruleId: rule.id,
          ruleName: rule.name,
          deviceId: device.id,
          deviceName: device.name,
          severity: rule.severity,
          status: fired ? 'firing' : 'pending',
          startedAt: now,
          firedAt: fired ? now : null,
          value,
        }
        if (fired) changes.push({ kind: 'firing', instance: next[id] })
        continue
      }

      const shouldFire =
        prev.status === 'firing' || now - prev.startedAt >= rule.forMs
      const updated: AlertInstance = {
        ...prev,
        ruleName: rule.name,
        deviceName: device.name,
        severity: rule.severity,
        value,
        status: shouldFire ? 'firing' : 'pending',
        firedAt: shouldFire ? (prev.firedAt ?? now) : null,
      }
      next[id] = updated
      if (shouldFire && prev.status !== 'firing') {
        changes.push({ kind: 'firing', instance: updated })
      }
    }
  }

  return { states: next, changes }
}

/** Firing alerts from a state map, newest first. */
export function firingAlerts(
  states: Record<string, AlertInstance>,
): AlertInstance[] {
  return Object.values(states)
    .filter((instance) => instance.status === 'firing')
    .sort((a, b) => (b.firedAt ?? 0) - (a.firedAt ?? 0))
}

/** Pending alerts from a state map, newest first. */
export function pendingAlerts(
  states: Record<string, AlertInstance>,
): AlertInstance[] {
  return Object.values(states)
    .filter((instance) => instance.status === 'pending')
    .sort((a, b) => b.startedAt - a.startedAt)
}
