import type { Device, DeviceType, Severity } from '@/types'
import type { AlertInstance } from '@/lib/alerts'
import { utilizationPct, SATURATION_THRESHOLD_PCT } from '@/lib/capacity'

/**
 * Automation playbooks and maintenance windows.
 *
 * Playbooks are a thin orchestration layer that sits *on top of* the alert
 * engine: they react to already-firing alerts (or raw device conditions) and
 * carry out a small set of actions. Maintenance windows suppress that
 * orchestration (and incident noise) for scoped devices. Everything here is
 * pure and deterministic so it can be unit tested.
 */

export type PlaybookTriggerKind = 'offline' | 'saturation' | 'alert'

export interface PlaybookTrigger {
  kind: PlaybookTriggerKind
  /** For `alert` triggers: only match at/above this severity. */
  minSeverity?: Severity
  /** Optional scope filters applied to the matched device. */
  site?: string
  type?: DeviceType
}

export type PlaybookActionKind =
  'notify' | 'acknowledge' | 'remediate' | 'maintenance' | 'tag'

export interface PlaybookAction {
  kind: PlaybookActionKind
  /** Tag name for `tag`, or an optional note for `notify`. */
  value?: string
}

export interface Playbook {
  id: string
  name: string
  description: string
  enabled: boolean
  trigger: PlaybookTrigger
  actions: PlaybookAction[]
  /** Minimum ms between runs of this playbook for the same device. */
  cooldownMs: number
}

export interface MaintenanceWindow {
  id: string
  name: string
  /** Site scope (matches every device at the site). */
  site: string | null
  /** Explicit device ids to include. */
  deviceIds: string[]
  startsAt: number
  endsAt: number
  /** Whether alerting/automation is suppressed for matching devices. */
  suppressAlerts: boolean
}

export const TRIGGER_LABELS: Record<PlaybookTriggerKind, string> = {
  offline: 'Device goes offline',
  saturation: 'Link saturates',
  alert: 'Alert fires',
}

export const ACTION_LABELS: Record<PlaybookActionKind, string> = {
  notify: 'Post timeline note',
  acknowledge: 'Acknowledge incident',
  remediate: 'Apply runbook',
  maintenance: 'Enter maintenance',
  tag: 'Tag device',
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

export function severityAtLeast(severity: Severity, min: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[min]
}

export function describeTrigger(trigger: PlaybookTrigger): string {
  const scope: string[] = []
  if (trigger.type) scope.push(trigger.type)
  if (trigger.site) scope.push(`@${trigger.site}`)
  const suffix = scope.length > 0 ? ` (${scope.join(' ')})` : ''
  if (trigger.kind === 'alert') {
    return `${TRIGGER_LABELS.alert} (${trigger.minSeverity ?? 'low'}+)${suffix}`
  }
  return `${TRIGGER_LABELS[trigger.kind]}${suffix}`
}

export function isActionKind(value: string): value is PlaybookActionKind {
  return value in ACTION_LABELS
}

export function isTriggerKind(value: string): value is PlaybookTriggerKind {
  return value in TRIGGER_LABELS
}

/** Whether a maintenance window is active at `now`. */
export function windowActive(window: MaintenanceWindow, now: number): boolean {
  return window.startsAt <= now && now < window.endsAt
}

export function activeWindows(
  windows: MaintenanceWindow[],
  now: number,
): MaintenanceWindow[] {
  return windows.filter((window) => windowActive(window, now))
}

export function windowMatchesDevice(
  window: MaintenanceWindow,
  device: Pick<Device, 'id' | 'site'>,
): boolean {
  if (window.site && window.site === device.site) return true
  return window.deviceIds.includes(device.id)
}

/** True when a device is inside a suppression window at `now`. */
export function isSuppressed(
  device: Pick<Device, 'id' | 'site'>,
  windows: MaintenanceWindow[],
  now: number,
): boolean {
  return windows.some(
    (window) =>
      window.suppressAlerts &&
      windowActive(window, now) &&
      windowMatchesDevice(window, device),
  )
}

/** Ids of devices that should be flagged in-maintenance at `now`. */
export function maintenanceTargets(
  windows: MaintenanceWindow[],
  devices: Pick<Device, 'id' | 'site'>[],
  now: number,
): string[] {
  const active = activeWindows(windows, now)
  if (active.length === 0) return []
  const targetIds = new Set<string>()
  for (const device of devices) {
    if (active.some((window) => windowMatchesDevice(window, device))) {
      targetIds.add(device.id)
    }
  }
  return [...targetIds]
}

function scopeMatches(
  trigger: PlaybookTrigger,
  device: Pick<Device, 'type' | 'site'>,
): boolean {
  if (trigger.site && device.site !== trigger.site) return false
  if (trigger.type && device.type !== trigger.type) return false
  return true
}

function conditionMatches(trigger: PlaybookTrigger, device: Device): boolean {
  if (trigger.kind === 'offline') return device.status === 'offline'
  if (trigger.kind === 'saturation') {
    return (
      utilizationPct(device.throughputMbps, device.capacityMbps) >=
      SATURATION_THRESHOLD_PCT
    )
  }
  return false
}

export interface PlaybookContext {
  now: number
  devices: Device[]
  /** Currently firing alerts. */
  alerts: AlertInstance[]
  windows: MaintenanceWindow[]
  /** Last run epoch per `${playbookId}:${deviceId}`. */
  lastRunByKey: Record<string, number>
}

export interface PlaybookMatch {
  playbookId: string
  playbookName: string
  deviceIds: string[]
  alertIds: string[]
}

/** Resolve the devices (and alerts) a single playbook would act on now. */
export function matchPlaybook(
  playbook: Playbook,
  context: PlaybookContext,
): PlaybookMatch | null {
  if (!playbook.enabled) return null
  const deviceById = new Map(
    context.devices.map((device) => [device.id, device]),
  )
  const matched = new Set<string>()
  const alertIds: string[] = []

  if (playbook.trigger.kind === 'alert') {
    const min = playbook.trigger.minSeverity ?? 'low'
    for (const alert of context.alerts) {
      if (!severityAtLeast(alert.severity, min)) continue
      const device = deviceById.get(alert.deviceId)
      if (!device) continue
      if (!scopeMatches(playbook.trigger, device)) continue
      if (device.inMaintenance) continue
      if (isSuppressed(device, context.windows, context.now)) continue
      matched.add(device.id)
      alertIds.push(alert.id)
    }
  } else {
    for (const device of context.devices) {
      if (!scopeMatches(playbook.trigger, device)) continue
      if (device.inMaintenance) continue
      if (!conditionMatches(playbook.trigger, device)) continue
      if (isSuppressed(device, context.windows, context.now)) continue
      matched.add(device.id)
    }
  }

  if (matched.size === 0) return null
  return {
    playbookId: playbook.id,
    playbookName: playbook.name,
    deviceIds: [...matched],
    alertIds,
  }
}

export interface PlaybookRun {
  id: string
  playbookId: string
  playbookName: string
  deviceIds: string[]
  alertIds: string[]
  actions: PlaybookAction[]
  at: number
}

/** Plan the playbook runs due at `now`, honouring per-device cooldowns. */
export function planAutomation(
  playbooks: Playbook[],
  context: PlaybookContext,
): PlaybookRun[] {
  const runs: PlaybookRun[] = []
  for (const playbook of playbooks) {
    const match = matchPlaybook(playbook, context)
    if (!match) continue
    const cooldown = Math.max(0, playbook.cooldownMs)
    const deviceIds = match.deviceIds.filter((id) => {
      const last = context.lastRunByKey[`${playbook.id}:${id}`]
      return last === undefined || context.now - last >= cooldown
    })
    if (deviceIds.length === 0) continue
    const alertIds =
      match.alertIds.length > 0
        ? match.alertIds.filter((id) =>
            context.alerts.some(
              (alert) => alert.id === id && deviceIds.includes(alert.deviceId),
            ),
          )
        : []
    runs.push({
      id: `run_${playbook.id}_${context.now}`,
      playbookId: playbook.id,
      playbookName: playbook.name,
      deviceIds,
      alertIds,
      actions: playbook.actions.map((action) => ({ ...action })),
      at: context.now,
    })
  }
  return runs
}

/** Merge a completed run into the cooldown map. */
export function withRunKeys(
  lastRunByKey: Record<string, number>,
  runs: PlaybookRun[],
): Record<string, number> {
  const next = { ...lastRunByKey }
  for (const run of runs) {
    for (const deviceId of run.deviceIds) {
      next[`${run.playbookId}:${deviceId}`] = run.at
    }
  }
  return next
}

export const DEFAULT_PLAYBOOKS: Playbook[] = [
  {
    id: 'pb_offline',
    name: 'Note outages',
    description:
      'Posts a timeline note whenever a device goes offline so responders have a breadcrumb.',
    enabled: true,
    trigger: { kind: 'offline' },
    actions: [{ kind: 'notify', value: 'Device offline' }],
    cooldownMs: 120_000,
  },
  {
    id: 'pb_saturation',
    name: 'Note saturation',
    description:
      'Posts a timeline note whenever a link saturates its capacity ceiling.',
    enabled: true,
    trigger: { kind: 'saturation' },
    actions: [{ kind: 'notify', value: 'Link saturated' }],
    cooldownMs: 120_000,
  },
]
