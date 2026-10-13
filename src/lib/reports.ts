import type {
  Device,
  Incident,
  MetricSample,
  Severity,
  Thresholds,
  TimelineEvent,
} from '@/types'
import {
  aggregateHistory,
  averageAvailability,
  averageLatency,
  averagePacketLoss,
  healthDistribution,
  overallHealth,
  statusCounts,
} from './aggregate'
import {
  avgUtilization,
  fleetUtilization,
  maxUtilization,
  saturated,
  SATURATION_THRESHOLD_PCT,
  utilizationPct,
} from './capacity'
import { saturationForecast } from './forecast'
import { formatDuration, round } from './format'
import { HEALTH_LABELS, SEVERITY_LABELS, healthLevel } from './health'
import { DAY_MS, type CurrentOnCall } from './oncall'
import { computeSla, incidentsBySeverity, siteSla } from './sla'
import {
  DEFAULT_SLO,
  budgetRemainingPct,
  burnRateWindows,
  mergeHistory,
  type BurnState,
  type SloTarget,
} from './slo'

/**
 * Executive reporting.
 *
 * Assembles a self-contained, deterministic report document from the current
 * simulation state: fleet health, service levels, error budget, per-site SLA,
 * capacity outlook, top incidents, recent changes and on-call coverage. The
 * same structured `ExecutiveReport` renders to Markdown or standalone HTML, so a
 * report can be exported as text or printed straight from the browser.
 */

export type ReportSectionId =
  | 'overview'
  | 'sla'
  | 'slo'
  | 'sites'
  | 'capacity'
  | 'incidents'
  | 'changes'
  | 'oncall'

export const ALL_REPORT_SECTIONS: ReportSectionId[] = [
  'overview',
  'sla',
  'slo',
  'sites',
  'capacity',
  'incidents',
  'changes',
  'oncall',
]

export const REPORT_SECTION_LABELS: Record<ReportSectionId, string> = {
  overview: 'Fleet health',
  sla: 'Service levels',
  slo: 'Error budget',
  sites: 'Site SLA',
  capacity: 'Capacity outlook',
  incidents: 'Top incidents',
  changes: 'Recent changes',
  oncall: 'On-call coverage',
}

export interface ReportRange {
  from: number
  to: number
}

export const RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: DAY_MS, label: 'Last 24 hours' },
  { value: 7 * DAY_MS, label: 'Last 7 days' },
  { value: 30 * DAY_MS, label: 'Last 30 days' },
]

export interface ReportPreset {
  id: string
  name: string
  description: string
  sections: ReportSectionId[]
  rangeMs: number
}

export const REPORT_PRESETS: ReportPreset[] = [
  {
    id: 'fleet',
    name: 'Fleet health',
    description: 'Overall health snapshot and service levels.',
    sections: ['overview', 'sla'],
    rangeMs: DAY_MS,
  },
  {
    id: 'slo',
    name: 'SLA & SLO',
    description: 'Uptime, response times and error budgets.',
    sections: ['sla', 'slo', 'sites'],
    rangeMs: 7 * DAY_MS,
  },
  {
    id: 'capacity',
    name: 'Capacity forecast',
    description: 'Utilisation and saturation outlook.',
    sections: ['capacity'],
    rangeMs: DAY_MS,
  },
  {
    id: 'incidents',
    name: 'Incidents & changes',
    description: 'Severity-ranked incidents with the change log.',
    sections: ['incidents', 'changes'],
    rangeMs: 7 * DAY_MS,
  },
  {
    id: 'oncall',
    name: 'On-call & coverage',
    description: 'Who is on call and the change log.',
    sections: ['oncall', 'changes'],
    rangeMs: DAY_MS,
  },
  {
    id: 'exec',
    name: 'Executive summary',
    description: 'Everything, in one document.',
    sections: ALL_REPORT_SECTIONS,
    rangeMs: 7 * DAY_MS,
  },
]

export interface ReportMetric {
  label: string
  value: string
  hint?: string
}

export interface ReportTable {
  columns: string[]
  rows: string[][]
}

export interface ReportSection {
  id: ReportSectionId
  title: string
  summary: string
  metrics: ReportMetric[]
  table?: ReportTable
  sparkline?: number[]
  notes?: string[]
}

export interface ExecutiveReport {
  title: string
  generatedAt: number
  range: ReportRange
  headline: string
  sections: ReportSection[]
}

export interface ReportContext {
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
  history: Record<string, MetricSample[]>
  thresholds: Thresholds
  range: ReportRange
  generatedAt: number
  /** Which sections to include (defaults to all, de-duplicated, in canon order). */
  sections?: ReportSectionId[]
  /** Current on-call snapshot, e.g. from `useOnCallStore` + `currentOnCall`. */
  onCall?: CurrentOnCall[]
  /** SLO target for the error-budget section. */
  slo?: SloTarget
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const BURN_STATE_LABELS: Record<BurnState, string> = {
  ok: 'Healthy',
  warning: 'Warning',
  critical: 'Critical',
}

function inRange(t: number, range: ReportRange): boolean {
  return t >= range.from && t <= range.to
}

function scopedSections(input?: ReportSectionId[]): ReportSectionId[] {
  if (!input || input.length === 0) return [...ALL_REPORT_SECTIONS]
  const wanted = new Set(input)
  return ALL_REPORT_SECTIONS.filter((id) => wanted.has(id))
}

function pct(value: number, decimals = 1): string {
  return `${round(value, decimals)}%`
}

function secsFromMs(ms: number | null): string {
  return ms === null ? 'n/a' : formatDuration(ms / 1000)
}

function overviewSection(
  ctx: ReportContext,
  incidents: Incident[],
): ReportSection {
  const { devices, thresholds, history } = ctx
  const health = overallHealth(devices, thresholds)
  const level = healthLevel(health)
  const counts = statusCounts(devices)
  const dist = healthDistribution(devices, thresholds)
  const sparkline = aggregateHistory(devices, history)
    .map((sample) => sample.availabilityPct)
    .slice(-24)

  return {
    id: 'overview',
    title: 'Fleet health',
    summary: `The fleet scores ${round(health, 1)}/100 (${HEALTH_LABELS[
      level
    ].toLowerCase()}) across ${devices.length} device${
      devices.length === 1 ? '' : 's'
    }, with ${incidents.length} incident${
      incidents.length === 1 ? '' : 's'
    } in the reporting window.`,
    metrics: [
      {
        label: 'Fleet health',
        value: `${round(health, 1)}/100`,
        hint: HEALTH_LABELS[level],
      },
      { label: 'Devices', value: `${devices.length}` },
      { label: 'Online', value: `${counts.online}` },
      { label: 'Degraded', value: `${counts.degraded}` },
      { label: 'Offline', value: `${counts.offline}` },
      { label: 'Availability', value: pct(averageAvailability(devices), 2) },
      {
        label: 'Avg latency',
        value: `${round(averageLatency(devices), 1)} ms`,
      },
      {
        label: 'Avg packet loss',
        value: pct(averagePacketLoss(devices), 2),
      },
    ],
    table: {
      columns: ['Health', 'Devices'],
      rows: [
        ['Healthy', `${dist.healthy}`],
        ['Degraded', `${dist.degraded}`],
        ['Critical', `${dist.critical}`],
      ],
    },
    sparkline: sparkline.length > 1 ? sparkline : undefined,
  }
}

function slaSection(ctx: ReportContext, incidents: Incident[]): ReportSection {
  const { devices, history } = ctx
  const sla = computeSla(devices, incidents, history)
  const bySeverity = incidentsBySeverity(incidents)

  return {
    id: 'sla',
    title: 'Service levels',
    summary: `Fleet availability was ${pct(
      sla.uptimePct,
      3,
    )} with a mean time to acknowledge of ${secsFromMs(
      sla.mttaMs,
    )} and mean time to resolve of ${secsFromMs(sla.mttrMs)}.`,
    metrics: [
      { label: 'Uptime', value: pct(sla.uptimePct, 3) },
      { label: 'MTTA', value: secsFromMs(sla.mttaMs) },
      { label: 'MTTR', value: secsFromMs(sla.mttrMs) },
      { label: 'Incidents', value: `${sla.totalIncidents}` },
      { label: 'Open', value: `${sla.openIncidents}` },
      { label: 'Resolved', value: `${sla.resolvedIncidents}` },
    ],
    table: {
      columns: ['Severity', 'Incidents'],
      rows: (Object.keys(bySeverity) as Severity[]).map((severity) => [
        SEVERITY_LABELS[severity],
        `${bySeverity[severity]}`,
      ]),
    },
  }
}

function sloSection(ctx: ReportContext): ReportSection {
  const target = ctx.slo ?? DEFAULT_SLO
  const samples = mergeHistory(ctx.history).filter((sample) =>
    inRange(sample.t, ctx.range),
  )
  const remaining = budgetRemainingPct(samples, target)
  const burn = burnRateWindows(samples, target, ctx.generatedAt)

  return {
    id: 'slo',
    title: 'Error budget',
    summary: `Against a ${target.objectivePct}% ${target.name} objective, ${pct(
      Math.max(0, remaining),
      1,
    )} of the error budget remains. Burn rate is ${
      BURN_STATE_LABELS[burn.state]
    }.`,
    metrics: [
      { label: 'Objective', value: pct(target.objectivePct, 3) },
      {
        label: 'Budget remaining',
        value: remaining < 0 ? 'Exhausted' : pct(remaining, 1),
      },
      { label: 'Fast burn (1h)', value: `${round(burn.fast, 2)}x` },
      { label: 'Slow burn (6h)', value: `${round(burn.slow, 2)}x` },
      {
        label: 'Burn state',
        value: BURN_STATE_LABELS[burn.state],
        hint: 'Multi-window evaluation',
      },
      { label: 'Samples', value: `${samples.length}` },
    ],
    notes:
      samples.length === 0
        ? ['No telemetry samples fell inside the reporting window.']
        : undefined,
  }
}

function sitesSection(
  ctx: ReportContext,
  incidents: Incident[],
): ReportSection {
  const sites = siteSla(ctx.devices, incidents, ctx.history)
  return {
    id: 'sites',
    title: 'Site SLA',
    summary: `${sites.length} site${
      sites.length === 1 ? '' : 's'
    } reported, worst availability first.`,
    metrics: [
      {
        label: 'Sites',
        value: `${sites.length}`,
      },
      {
        label: 'Worst site',
        value: sites[0] ? `${sites[0].site}` : 'n/a',
        hint: sites[0] ? pct(sites[0].uptimePct, 2) : undefined,
      },
      {
        label: 'Best site',
        value: sites.length > 0 ? `${sites[sites.length - 1].site}` : 'n/a',
        hint:
          sites.length > 0
            ? pct(sites[sites.length - 1].uptimePct, 2)
            : undefined,
      },
    ],
    table:
      sites.length > 0
        ? {
            columns: ['Site', 'Devices', 'Incidents', 'Uptime'],
            rows: sites.map((entry) => [
              entry.site,
              `${entry.devices}`,
              `${entry.incidents}`,
              pct(entry.uptimePct, 2),
            ]),
          }
        : undefined,
  }
}

function capacitySection(ctx: ReportContext): ReportSection {
  const devices = ctx.devices
  const hot = saturated(devices)
  const worst = [...devices]
    .map((device) => ({
      device,
      util: utilizationPct(device.throughputMbps, device.capacityMbps),
    }))
    .sort((a, b) => b.util - a.util)

  const notes: string[] = []
  const forecastTarget = worst.find(
    (entry) => (ctx.history[entry.device.id] ?? []).length > 1,
  )
  if (forecastTarget) {
    const samples = ctx.history[forecastTarget.device.id]
    const stepMs =
      samples.length > 1 ? Math.max(1000, samples[1].t - samples[0].t) : 60_000
    const forecast = saturationForecast(
      samples,
      forecastTarget.device.capacityMbps,
      12,
      stepMs,
    )
    if (forecast.etaMs !== null) {
      notes.push(
        `${forecastTarget.device.name} is projected to reach ${SATURATION_THRESHOLD_PCT}% utilisation in ${secsFromMs(
          forecast.etaMs,
        )}.`,
      )
    } else {
      notes.push(
        `${forecastTarget.device.name} is trending toward ${round(
          forecast.projectedPct,
          1,
        )}% utilisation (no saturation crossing).`,
      )
    }
  }

  return {
    id: 'capacity',
    title: 'Capacity outlook',
    summary: `Fleet utilisation is ${pct(
      fleetUtilization(devices),
      1,
    )}, peaking at ${pct(maxUtilization(devices), 1)}. ${hot.length} device${
      hot.length === 1 ? '' : 's'
    } at or above the ${SATURATION_THRESHOLD_PCT}% saturation threshold.`,
    metrics: [
      { label: 'Fleet utilisation', value: pct(fleetUtilization(devices), 1) },
      { label: 'Avg utilisation', value: pct(avgUtilization(devices), 1) },
      { label: 'Peak utilisation', value: pct(maxUtilization(devices), 1) },
      { label: 'Saturated', value: `${hot.length}` },
    ],
    table:
      worst.length > 0
        ? {
            columns: ['Device', 'Site', 'Utilisation'],
            rows: worst
              .slice(0, 10)
              .map((entry) => [
                entry.device.name,
                entry.device.site,
                pct(entry.util, 1),
              ]),
          }
        : undefined,
    notes: notes.length > 0 ? notes : undefined,
  }
}

function incidentsSection(
  ctx: ReportContext,
  incidents: Incident[],
): ReportSection {
  const ranked = [...incidents]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.createdAt - a.createdAt,
    )
    .slice(0, 10)
  const bySeverity = incidentsBySeverity(incidents)
  const resolved = incidents.filter(
    (incident) => incident.status === 'resolved',
  ).length

  return {
    id: 'incidents',
    title: 'Top incidents',
    summary: `${incidents.length} incident${
      incidents.length === 1 ? '' : 's'
    } in the window: ${bySeverity.critical} critical, ${bySeverity.high} high.`,
    metrics: [
      { label: 'Total', value: `${incidents.length}` },
      { label: 'Open', value: `${incidents.length - resolved}` },
      { label: 'Resolved', value: `${resolved}` },
      { label: 'Critical', value: `${bySeverity.critical}` },
      { label: 'High', value: `${bySeverity.high}` },
    ],
    table:
      ranked.length > 0
        ? {
            columns: ['Severity', 'Title', 'Status', 'Duration', 'Devices'],
            rows: ranked.map((incident) => [
              SEVERITY_LABELS[incident.severity],
              incident.title,
              incident.status,
              formatDuration(
                ((incident.resolvedAt ?? ctx.generatedAt) -
                  incident.createdAt) /
                  1000,
              ),
              `${incident.deviceIds.length}`,
            ]),
          }
        : undefined,
  }
}

function changesSection(
  ctx: ReportContext,
  events: TimelineEvent[],
): ReportSection {
  const nameById = new Map(
    ctx.devices.map((device) => [device.id, device.name]),
  )
  const changes = events
    .filter((event) => event.type === 'config')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20)

  return {
    id: 'changes',
    title: 'Recent changes',
    summary: `${changes.length} configuration change${
      changes.length === 1 ? '' : 's'
    } recorded in the window.`,
    metrics: [{ label: 'Changes', value: `${changes.length}` }],
    table:
      changes.length > 0
        ? {
            columns: ['Time', 'Device', 'Change'],
            rows: changes.map((event) => [
              new Date(event.timestamp).toISOString(),
              event.deviceId ? (nameById.get(event.deviceId) ?? '—') : '—',
              event.message,
            ]),
          }
        : undefined,
    notes:
      changes.length === 0
        ? ['No configuration changes were recorded in this window.']
        : undefined,
  }
}

function onCallSection(ctx: ReportContext): ReportSection {
  const entries = ctx.onCall ?? []
  return {
    id: 'oncall',
    title: 'On-call coverage',
    summary:
      entries.length === 0
        ? 'No rotations are configured.'
        : `${entries.length} rotation${
            entries.length === 1 ? '' : 's'
          } actively covered.`,
    metrics: [
      { label: 'Rotations', value: `${entries.length}` },
      {
        label: 'Teams',
        value: `${new Set(entries.map((entry) => entry.team.id)).size}`,
      },
    ],
    table:
      entries.length > 0
        ? {
            columns: ['Team', 'Rotation', 'On call', 'Until'],
            rows: entries.map((entry) => [
              entry.team.name,
              entry.rotation.name,
              entry.member?.name ?? 'Unassigned',
              entry.next ? new Date(entry.next.at).toISOString() : '—',
            ]),
          }
        : undefined,
  }
}

/**
 * Assemble the executive report. Pure and deterministic given `generatedAt`, so
 * it can be unit tested and exported to Markdown or HTML.
 */
export function buildExecutiveReport(ctx: ReportContext): ExecutiveReport {
  const incidents = ctx.incidents.filter((incident) =>
    inRange(incident.createdAt, ctx.range),
  )
  const events = ctx.events.filter((event) =>
    inRange(event.timestamp, ctx.range),
  )

  const builders: Record<ReportSectionId, () => ReportSection> = {
    overview: () => overviewSection(ctx, incidents),
    sla: () => slaSection(ctx, incidents),
    slo: () => sloSection(ctx),
    sites: () => sitesSection(ctx, incidents),
    capacity: () => capacitySection(ctx),
    incidents: () => incidentsSection(ctx, incidents),
    changes: () => changesSection(ctx, events),
    oncall: () => onCallSection(ctx),
  }

  const sections = scopedSections(ctx.sections).map((id) => builders[id]())

  const health = overallHealth(ctx.devices, ctx.thresholds)
  const openIncidents = incidents.filter(
    (incident) => incident.status !== 'resolved',
  ).length
  const headline = `${ctx.devices.length} devices · health ${round(
    health,
    1,
  )}/100 (${HEALTH_LABELS[healthLevel(health)].toLowerCase()}) · ${
    openIncidents
  } open incident${openIncidents === 1 ? '' : 's'}`

  return {
    title: 'NetScope Executive Report',
    generatedAt: ctx.generatedAt,
    range: ctx.range,
    headline,
    sections,
  }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/** Render the report as a Markdown document. */
export function executiveToMarkdown(report: ExecutiveReport): string {
  const lines: string[] = []
  lines.push(`# ${report.title}`)
  lines.push('')
  lines.push(
    `_${new Date(report.range.from).toISOString()} → ${new Date(
      report.range.to,
    ).toISOString()}_`,
  )
  lines.push('')
  lines.push(`**${report.headline}**`)
  lines.push('')

  for (const section of report.sections) {
    lines.push(`## ${section.title}`)
    lines.push('')
    lines.push(section.summary)
    lines.push('')
    for (const metric of section.metrics) {
      lines.push(
        `- **${metric.label}:** ${metric.value}${
          metric.hint ? ` (${metric.hint})` : ''
        }`,
      )
    }
    lines.push('')
    if (section.table) {
      lines.push(`| ${section.table.columns.join(' | ')} |`)
      lines.push(`| ${section.table.columns.map(() => '---').join(' | ')} |`)
      for (const row of section.table.rows) {
        lines.push(`| ${row.join(' | ')} |`)
      }
      lines.push('')
    }
    if (section.notes) {
      for (const note of section.notes) {
        lines.push(`> ${note}`)
      }
      lines.push('')
    }
  }

  lines.push(
    '> Generated by NetScope (DEMO data, simulated telemetry). Not for operational use.',
  )
  return lines.join('\n')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sparklineSvg(values: number[]): string {
  if (values.length < 2) return ''
  const width = 560
  const height = 80
  const pad = 6
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = (width - pad * 2) / (values.length - 1)
  const points = values.map((value, index) => {
    const x = pad + index * stepX
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return `${x.toFixed(1)} ${y.toFixed(1)}`
  })
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point}`)
    .join(' ')
  const lastX = pad + (values.length - 1) * stepX
  const area = `${path} L${lastX.toFixed(1)} ${height - pad} L${pad} ${
    height - pad
  } Z`
  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Availability trend" style="display:block">` +
    `<path d="${area}" fill="rgba(56,189,248,0.14)" stroke="none"/>` +
    `<path d="${path}" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `</svg>`
  )
}

/** Render the report as a standalone, self-contained HTML document. */
export function executiveToHtml(report: ExecutiveReport): string {
  const body = report.sections
    .map((section) => {
      const metrics = section.metrics
        .map(
          (metric) =>
            `<div class="metric"><span class="metric-label">${escapeHtml(
              metric.label,
            )}</span><span class="metric-value">${escapeHtml(
              metric.value,
            )}</span>${
              metric.hint
                ? `<span class="metric-hint">${escapeHtml(metric.hint)}</span>`
                : ''
            }</div>`,
        )
        .join('')
      const table = section.table
        ? `<table><thead><tr>${section.table.columns
            .map((column) => `<th>${escapeHtml(column)}</th>`)
            .join('')}</tr></thead><tbody>${section.table.rows
            .map(
              (row) =>
                `<tr>${row
                  .map((cell) => `<td>${escapeHtml(cell)}</td>`)
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table>`
        : ''
      const notes = section.notes
        ? section.notes
            .map((note) => `<p class="note">${escapeHtml(note)}</p>`)
            .join('')
        : ''
      const sparkline = section.sparkline
        ? `<div class="spark">${sparklineSvg(section.sparkline)}</div>`
        : ''
      return `<section><h2>${escapeHtml(section.title)}</h2><p class="summary">${escapeHtml(
        section.summary,
      )}</p>${sparkline}<div class="metrics">${metrics}</div>${table}${notes}</section>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(report.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px; background: #f7f9fc; color: #0f172a; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 0 0 6px; color: #0b3b66; }
  .range { color: #64748b; font-size: 13px; margin: 0 0 18px; }
  .headline { font-size: 16px; font-weight: 600; padding: 14px 16px; background: #e8f2fb; border: 1px solid #cfe3f4; border-radius: 10px; margin: 0 0 24px; }
  section { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; }
  .summary { margin: 0 0 14px; color: #334155; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin: 0 0 12px; }
  .metric { display: flex; flex-direction: column; padding: 10px 12px; background: #f1f5f9; border-radius: 8px; }
  .metric-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  .metric-value { font-size: 18px; font-weight: 650; }
  .metric-hint { font-size: 12px; color: #64748b; }
  .spark { margin: 0 0 14px; }
  table { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eef2f7; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  tr:last-child td { border-bottom: none; }
  .note { margin: 6px 0 0; padding: 8px 12px; background: #fffbeb; border-left: 3px solid #f59e0b; border-radius: 4px; color: #78350f; font-size: 14px; }
  footer { margin-top: 24px; color: #94a3b8; font-size: 12px; text-align: center; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(report.title)}</h1>
<p class="range">${escapeHtml(
    new Date(report.range.from).toISOString(),
  )} → ${escapeHtml(new Date(report.range.to).toISOString())} · generated ${escapeHtml(
    new Date(report.generatedAt).toISOString(),
  )}</p>
<p class="headline">${escapeHtml(report.headline)}</p>
${body}
<footer>Generated by NetScope (DEMO data, simulated telemetry). Not for operational use.</footer>
</main>
</body>
</html>`
}
