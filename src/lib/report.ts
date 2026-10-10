import type {
  Device,
  Incident,
  IncidentStatus,
  MetricSample,
  Severity,
  TimelineEvent,
} from '@/types'
import { round } from './format'
import type { Runbook } from './runbooks'

export interface IncidentMetrics {
  deviceCount: number
  sampleCount: number
  peakLatencyMs: number
  peakPacketLossPct: number
  minAvailabilityPct: number
  meanAvailabilityPct: number
}

export interface IncidentReport {
  title: string
  severity: Severity
  status: IncidentStatus
  openedAt: number
  resolvedAt: number | null
  durationMs: number | null
  affectedDevices: { id: string; name: string; site: string }[]
  metrics: IncidentMetrics
  timeline: { timestamp: number; message: string }[]
  probableCause: string | null
  recommendedActions: string[]
  generatedAt: number
}

export interface IncidentReportInput {
  incident: Incident
  devices: Device[]
  events: TimelineEvent[]
  history: Record<string, MetricSample[]>
  generatedAt: number
  runbook?: Runbook
  /** Optional already-resolved root-cause label (e.g. from the RCA panel). */
  probableCause?: string | null
  /** Maximum number of timeline entries to include (most relevant kept). */
  timelineLimit?: number
}

const EMPTY_METRICS: IncidentMetrics = {
  deviceCount: 0,
  sampleCount: 0,
  peakLatencyMs: 0,
  peakPacketLossPct: 0,
  minAvailabilityPct: 100,
  meanAvailabilityPct: 100,
}

function metricsFromSamples(samples: MetricSample[]): IncidentMetrics {
  if (samples.length === 0) return { ...EMPTY_METRICS }
  let peakLatencyMs = 0
  let peakPacketLossPct = 0
  let minAvailabilityPct = 100
  let availabilitySum = 0
  for (const sample of samples) {
    peakLatencyMs = Math.max(peakLatencyMs, sample.latencyMs)
    peakPacketLossPct = Math.max(peakPacketLossPct, sample.packetLossPct)
    minAvailabilityPct = Math.min(minAvailabilityPct, sample.availabilityPct)
    availabilitySum += sample.availabilityPct
  }
  return {
    deviceCount: 0,
    sampleCount: samples.length,
    peakLatencyMs: round(peakLatencyMs, 1),
    peakPacketLossPct: round(peakPacketLossPct, 2),
    minAvailabilityPct: round(minAvailabilityPct, 3),
    meanAvailabilityPct: round(availabilitySum / samples.length, 3),
  }
}

/**
 * Assemble a postmortem-style report from an incident and the simulation state
 * it touched. Pure and deterministic (aside from the caller-supplied
 * `generatedAt`) so it can be unit tested and exported as Markdown or JSON.
 */
export function buildIncidentReport(
  input: IncidentReportInput,
): IncidentReport {
  const { incident, devices, events, history, generatedAt } = input
  const { createdAt } = incident
  const end = incident.resolvedAt ?? generatedAt
  const targets = new Set(incident.deviceIds)

  const affectedDevices = devices
    .filter((device) => targets.has(device.id))
    .map((device) => ({ id: device.id, name: device.name, site: device.site }))

  const samples: MetricSample[] = []
  for (const id of incident.deviceIds) {
    for (const sample of history[id] ?? []) {
      if (sample.t >= createdAt && sample.t <= end) samples.push(sample)
    }
  }

  let metrics = metricsFromSamples(samples)
  if (samples.length === 0) {
    const current = devices.filter((device) => targets.has(device.id))
    if (current.length > 0) {
      metrics = metricsFromSamples(
        current.map((device) => ({
          t: generatedAt,
          latencyMs: device.latencyMs,
          packetLossPct: device.packetLossPct,
          availabilityPct: device.availabilityPct,
          throughputMbps: device.throughputMbps,
          cpuPct: device.cpuPct,
          memoryPct: device.memoryPct,
        })),
      )
    }
  }
  metrics = { ...metrics, deviceCount: affectedDevices.length }

  const timeline = events
    .filter(
      (event) =>
        (event.deviceId !== undefined && targets.has(event.deviceId)) ||
        (event.timestamp >= createdAt && event.timestamp <= end),
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, input.timelineLimit ?? 20)
    .map((event) => ({ timestamp: event.timestamp, message: event.message }))

  return {
    title: incident.title,
    severity: incident.severity,
    status: incident.status,
    openedAt: createdAt,
    resolvedAt: incident.resolvedAt ?? null,
    durationMs: end - createdAt,
    affectedDevices,
    metrics,
    timeline,
    probableCause: input.probableCause ?? null,
    recommendedActions: input.runbook ? input.runbook.steps : [],
    generatedAt,
  }
}

/** Render a report as a human-readable Markdown document. */
export function reportToMarkdown(report: IncidentReport): string {
  const lines: string[] = []
  lines.push(`# Incident postmortem: ${report.title}`)
  lines.push('')
  lines.push(`- **Severity:** ${report.severity}`)
  lines.push(`- **Status:** ${report.status}`)
  lines.push(`- **Opened:** ${new Date(report.openedAt).toISOString()}`)
  lines.push(
    `- **Resolved:** ${
      report.resolvedAt ? new Date(report.resolvedAt).toISOString() : 'n/a'
    }`,
  )
  lines.push(
    `- **Duration:** ${report.durationMs !== null ? `${Math.round(report.durationMs / 1000)}s` : 'n/a'}`,
  )
  lines.push(`- **Generated:** ${new Date(report.generatedAt).toISOString()}`)
  lines.push('')

  lines.push('## Impact')
  lines.push(
    `${report.metrics.deviceCount} device(s) affected: ${
      report.affectedDevices
        .map((device) => `${device.name} (${device.site})`)
        .join(', ') || 'none'
    }`,
  )
  lines.push('')

  lines.push('## Key metrics')
  lines.push(`- Peak latency: ${report.metrics.peakLatencyMs} ms`)
  lines.push(`- Peak packet loss: ${report.metrics.peakPacketLossPct}%`)
  lines.push(`- Min availability: ${report.metrics.minAvailabilityPct}%`)
  lines.push(`- Mean availability: ${report.metrics.meanAvailabilityPct}%`)
  lines.push(`- Samples analysed: ${report.metrics.sampleCount}`)
  lines.push('')

  lines.push('## Probable cause')
  lines.push(report.probableCause ?? 'Not determined.')
  lines.push('')

  if (report.timeline.length > 0) {
    lines.push('## Timeline')
    for (const entry of report.timeline) {
      lines.push(
        `- ${new Date(entry.timestamp).toISOString()} - ${entry.message}`,
      )
    }
    lines.push('')
  }

  if (report.recommendedActions.length > 0) {
    lines.push('## Recommended actions')
    for (const action of report.recommendedActions) {
      lines.push(`- [ ] ${action}`)
    }
    lines.push('')
  }

  lines.push('> Generated by NetScope (DEMO data, simulated telemetry).')
  return lines.join('\n')
}

/** Render a report as pretty-printed JSON. */
export function reportToJson(report: IncidentReport): string {
  return JSON.stringify(report, null, 2)
}
