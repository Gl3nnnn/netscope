import type { Severity } from '@/types'
import { SEVERITY_LABELS } from '@/lib/health'

/**
 * Notification channels and escalation. Channels receive alert traffic above a
 * minimum severity; escalation levels re-notify on stale firing alerts so the
 * demo can show a page/resolve loop. Pure and dependency-free.
 */

export type ChannelKind = 'email' | 'slack' | 'webhook' | 'sms'

export interface NotificationChannel {
  id: string
  kind: ChannelKind
  name: string
  /** Destination — an address, channel or endpoint URL. */
  target: string
  enabled: boolean
  /** Only alerts at or above this severity reach the channel. */
  minSeverity: Severity
  /** Whether the channel is paged on final (critical) escalation. */
  escalate: boolean
}

export const CHANNEL_KIND_LABELS: Record<ChannelKind, string> = {
  email: 'Email',
  slack: 'Slack',
  webhook: 'Webhook',
  sms: 'SMS / Pager',
}

export const CHANNEL_SEVERITIES: Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
]

export const DEFAULT_CHANNELS: NotificationChannel[] = [
  {
    id: 'channel_ops_email',
    kind: 'email',
    name: 'Ops digest',
    target: 'ops@netscope.demo',
    minSeverity: 'high',
    enabled: true,
    escalate: false,
  },
  {
    id: 'channel_slack',
    kind: 'slack',
    name: '#alerts',
    target: 'netscope.slack.com/#alerts',
    minSeverity: 'medium',
    enabled: true,
    escalate: false,
  },
  {
    id: 'channel_pager',
    kind: 'sms',
    name: 'On-call pager',
    target: '+1 555 0100',
    minSeverity: 'critical',
    enabled: true,
    escalate: true,
  },
]

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

/** Alerts at `severity` reach a channel needing `minSeverity`. */
export function severityHitsChannel(
  minSeverity: Severity,
  severity: Severity,
): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity]
}

/** Enabled channels that should hear an alert at this severity. */
export function channelsForSeverity(
  channels: NotificationChannel[],
  severity: Severity,
): NotificationChannel[] {
  return channels.filter(
    (channel) =>
      channel.enabled && severityHitsChannel(channel.minSeverity, severity),
  )
}

export type EscalationLevel = 0 | 1 | 2

export interface EscalationConfig {
  /** Re-notify after this many firing ms (level 1). */
  firstAfterMs: number
  /** Page escalate-only channels after this many firing ms (level 2). */
  secondAfterMs: number
}

export const DEFAULT_ESCALATION: EscalationConfig = {
  firstAfterMs: 30_000,
  secondAfterMs: 90_000,
}

/** Escalation level given how long an alert has been firing. */
export function escalationLevel(
  activeMs: number,
  config: EscalationConfig,
): EscalationLevel {
  if (activeMs >= config.secondAfterMs) return 2
  if (activeMs >= config.firstAfterMs) return 1
  return 0
}

/**
 * Whether a channel should receive a delivery at this escalation level:
 * level 0/1 reaches every enabled channel matching the severity; level 2 pages
 * only escalate-flagged channels on the most severe alerts.
 */
export function shouldDeliver(
  channel: NotificationChannel,
  severity: Severity,
  level: EscalationLevel,
): boolean {
  if (!channel.enabled) return false
  if (!severityHitsChannel(channel.minSeverity, severity)) return false
  if (level < 2) return true
  return channel.escalate && severity === 'critical'
}

export interface Delivery {
  id: string
  at: number
  channelId: string
  channelName: string
  kind: ChannelKind
  target: string
  alertInstanceId: string
  alertName: string
  severity: Severity
  level: EscalationLevel
}

export const ESCALATION_LABELS: Record<EscalationLevel, string> = {
  0: 'Initial',
  1: 'Escalated',
  2: 'Paged',
}

export function describeEscalation(config: EscalationConfig): string {
  return `Notify on fire · re-notify after ${config.firstAfterMs / 1000}s · page after ${config.secondAfterMs / 1000}s`
}

export function describeSeverity(severity: Severity): string {
  return SEVERITY_LABELS[severity]
}
