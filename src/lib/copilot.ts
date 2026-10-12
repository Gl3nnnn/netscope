import type {
  Device,
  DeviceStatus,
  DeviceType,
  Incident,
  Severity,
  Thresholds,
} from '@/types'
import {
  averageAvailability,
  averageLatency,
  overallHealth,
  statusCounts,
} from '@/lib/aggregate'
import {
  avgUtilization,
  fleetUtilization,
  SATURATION_THRESHOLD_PCT,
  utilizationPct,
} from '@/lib/capacity'
import { deviceSites } from '@/lib/devices'
import { formatMbps, round } from '@/lib/format'
import {
  computeHealthScore,
  DEVICE_STATUS_LABELS,
  DEVICE_TYPE_LABELS,
  healthLevel,
} from '@/lib/health'
import { trace } from '@/lib/tracer'

/**
 * Ask NetScope — a deterministic, offline "copilot".
 *
 * Rather than calling an LLM, this interprets a natural-language question with
 * a small cascade of intent matchers over the live fleet and returns a
 * structured, cited answer. Pure and unit-testable.
 */

export type CopilotIntent =
  | 'help'
  | 'fleet-status'
  | 'device-status'
  | 'site-status'
  | 'count-status'
  | 'rank-devices'
  | 'incidents'
  | 'capacity'
  | 'route'
  | 'slo'
  | 'unknown'

export interface CopilotLink {
  label: string
  to: string
}

export interface CopilotAlert {
  title: string
  severity: Severity
}

export interface CopilotContext {
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
  now: number
  /** Optional firing alerts for "what's alerting" questions. */
  alerts?: CopilotAlert[]
}

export interface CopilotAnswer {
  intent: CopilotIntent
  title: string
  summary: string
  bullets: string[]
  devices?: Device[]
  links?: CopilotLink[]
}

export const COPILOT_EXAMPLES: string[] = [
  'How is the fleet doing?',
  'Which devices are the worst?',
  'How many devices are offline?',
  'Tell me about DC-A',
  'What incidents are open?',
  'Which devices are near capacity?',
  'How do I get from HQ-Core-Router to DC-A-Switch?',
  "What's our uptime?",
]

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
}

type RankMetric =
  | 'latency'
  | 'loss'
  | 'availability'
  | 'throughput'
  | 'cpu'
  | 'memory'
  | 'utilisation'
  | 'health'

interface MetricSpec {
  label: string
  unit: string
  /** Whether a larger number is worse (drives "worst" ordering). */
  higherIsWorse: boolean
  value: (device: Device, thresholds: Thresholds) => number
}

const METRIC_SPECS: Record<RankMetric, MetricSpec> = {
  latency: {
    label: 'latency',
    unit: 'ms',
    higherIsWorse: true,
    value: (device) => device.latencyMs,
  },
  loss: {
    label: 'packet loss',
    unit: '%',
    higherIsWorse: true,
    value: (device) => device.packetLossPct,
  },
  availability: {
    label: 'availability',
    unit: '%',
    higherIsWorse: false,
    value: (device) => device.availabilityPct,
  },
  throughput: {
    label: 'throughput',
    unit: 'Mbps',
    higherIsWorse: true,
    value: (device) => device.throughputMbps,
  },
  cpu: {
    label: 'CPU',
    unit: '%',
    higherIsWorse: true,
    value: (device) => device.cpuPct,
  },
  memory: {
    label: 'memory',
    unit: '%',
    higherIsWorse: true,
    value: (device) => device.memoryPct,
  },
  utilisation: {
    label: 'utilisation',
    unit: '%',
    higherIsWorse: true,
    value: (device) =>
      utilizationPct(device.throughputMbps, device.capacityMbps),
  },
  health: {
    label: 'health',
    unit: '',
    higherIsWorse: false,
    value: (device, thresholds) => computeHealthScore(device, thresholds),
  },
}

function normalize(question: string): string {
  return question
    .toLowerCase()
    .replace(/[?!.,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findDevice(q: string, devices: Device[]): Device | null {
  let match: Device | null = null
  for (const device of devices) {
    const name = device.name.toLowerCase()
    if (q.includes(name) && (!match || name.length > match.name.length)) {
      match = device
    }
  }
  if (match) return match
  for (const device of devices) {
    if (q.includes(device.ip.toLowerCase())) return device
  }
  return null
}

function findSite(q: string, devices: Device[]): string | null {
  let match: string | null = null
  for (const site of deviceSites(devices)) {
    const needle = site.toLowerCase()
    if (
      needle.length >= 2 &&
      q.includes(needle) &&
      (!match || needle.length > match.toLowerCase().length)
    ) {
      match = site
    }
  }
  return match
}

function detectStatus(q: string): DeviceStatus | null {
  if (/\boffline\b|\bdown\b/.test(q)) return 'offline'
  if (/\bdegraded\b|\bslow\b|\bstressed\b/.test(q)) return 'degraded'
  if (/\bonline\b|\bup\b|\bhealthy\b/.test(q)) return 'online'
  return null
}

function detectType(q: string): DeviceType | null {
  if (/\brouters?\b/.test(q)) return 'router'
  if (/\bswitches?\b|\bswitch\b/.test(q)) return 'switch'
  if (/\bfirewalls?\b/.test(q)) return 'firewall'
  if (/\bservers?\b/.test(q)) return 'server'
  if (/\baccess\s*points?\b|\bwifi\b|\bwi-fi\b|\baps?\b/.test(q))
    return 'accessPoint'
  return null
}

function detectMetric(q: string): RankMetric | null {
  if (/\blatenc|\bslow|ms\b/.test(q)) return 'latency'
  if (/\bloss|packet/.test(q)) return 'loss'
  if (/\buptime|availabilit|avail\b/.test(q)) return 'availability'
  if (/\bthroughput|traffic|bandwidth\b/.test(q)) return 'throughput'
  if (/\bcpu|processor\b/.test(q)) return 'cpu'
  if (/\bmemory|\bmem\b|\bram\b/.test(q)) return 'memory'
  if (/\butili|utilisation|utilization|\bload\b|\bbusy\b|\bcapacity\b/.test(q))
    return 'utilisation'
  if (/\bhealth|healthy\b/.test(q)) return 'health'
  return null
}

function detectLimit(q: string): number {
  const match = q.match(/\b(\d{1,2})\b/)
  const value = match ? Number(match[1]) : 5
  return Math.min(10, Math.max(1, value))
}

function linkDevice(device: Device): CopilotLink {
  return { label: device.name, to: `/devices/${device.id}` }
}

function helpAnswer(): CopilotAnswer {
  return {
    intent: 'help',
    title: 'Ask NetScope',
    summary:
      'I answer questions about the live simulated fleet using the same engines as the rest of the app.',
    bullets: COPILOT_EXAMPLES,
    links: [
      { label: 'Dashboard', to: '/' },
      { label: 'Incidents', to: '/incidents' },
    ],
  }
}

function fleetStatus(ctx: CopilotContext): CopilotAnswer {
  const { devices, incidents, thresholds } = ctx
  const health = round(overallHealth(devices, thresholds), 1)
  const counts = statusCounts(devices)
  const open = incidents.filter((incident) => incident.status !== 'resolved')
  const critical = open.filter((incident) => incident.severity === 'critical')
  const util = round(fleetUtilization(devices), 1)
  const nearCapacity = devices.filter(
    (device) =>
      utilizationPct(device.throughputMbps, device.capacityMbps) >=
      SATURATION_THRESHOLD_PCT,
  )
  const problems = [...devices]
    .filter((device) => device.status !== 'online')
    .sort(
      (a, b) =>
        computeHealthScore(a, thresholds) - computeHealthScore(b, thresholds),
    )

  const bullets = [
    `${counts.online} online, ${counts.degraded} degraded, ${counts.offline} offline across ${deviceSites(devices).length} sites.`,
    `${open.length} open incident${open.length === 1 ? '' : 's'}${critical.length > 0 ? ` (${critical.length} critical)` : ''}.`,
    `Fleet utilisation is ${util}%${nearCapacity.length > 0 ? ` and ${nearCapacity.length} device${nearCapacity.length === 1 ? ' is' : 's are'} near capacity` : ''}.`,
    `Average latency is ${round(averageLatency(devices), 1)} ms; average uptime ${round(averageAvailability(devices), 2)}%.`,
  ]

  return {
    intent: 'fleet-status',
    title: 'Fleet status',
    summary: `Fleet health is ${health}/100 (${healthLevel(health)}).`,
    bullets,
    devices: problems.slice(0, 5),
    links: [
      { label: 'Dashboard', to: '/' },
      { label: 'Incidents', to: '/incidents' },
    ],
  }
}

function deviceStatus(device: Device, ctx: CopilotContext): CopilotAnswer {
  const score = round(computeHealthScore(device, ctx.thresholds), 1)
  const util = round(
    utilizationPct(device.throughputMbps, device.capacityMbps),
    1,
  )
  const bullets = [
    `Status: ${DEVICE_STATUS_LABELS[device.status]}${device.inMaintenance ? ' (in maintenance)' : ''}${device.flapping ? ', flapping' : ''}.`,
    `Health ${score}/100 (${healthLevel(score)}), site ${device.site}, type ${DEVICE_TYPE_LABELS[device.type]}.`,
    `Latency ${round(device.latencyMs, 1)} ms, packet loss ${round(device.packetLossPct, 2)}%, availability ${round(device.availabilityPct, 2)}%.`,
    `Throughput ${formatMbps(device.throughputMbps)} at ${util}% utilisation; CPU ${round(device.cpuPct, 1)}%, memory ${round(device.memoryPct, 1)}%.`,
  ]
  const related = ctx.incidents.filter(
    (incident) =>
      incident.status !== 'resolved' && incident.deviceIds.includes(device.id),
  )
  if (related.length > 0) {
    bullets.push(
      `${related.length} open incident${related.length === 1 ? '' : 's'}: ${related.map((incident) => incident.title).join('; ')}.`,
    )
  }
  return {
    intent: 'device-status',
    title: device.name,
    summary: `${device.name} is ${DEVICE_STATUS_LABELS[device.status].toLowerCase()} with a health score of ${score}.`,
    bullets,
    devices: [device],
    links: [linkDevice(device), { label: 'Devices', to: '/devices' }],
  }
}

function siteStatus(site: string, ctx: CopilotContext): CopilotAnswer {
  const devices = ctx.devices.filter((device) => device.site === site)
  const health = round(overallHealth(devices, ctx.thresholds), 1)
  const counts = statusCounts(devices)
  const worst = [...devices].sort(
    (a, b) =>
      computeHealthScore(a, ctx.thresholds) -
      computeHealthScore(b, ctx.thresholds),
  )
  const incidents = ctx.incidents.filter(
    (incident) =>
      incident.status !== 'resolved' &&
      incident.deviceIds.some((id) =>
        devices.some((device) => device.id === id),
      ),
  )
  return {
    intent: 'site-status',
    title: `Site ${site}`,
    summary: `${site} has ${devices.length} device${devices.length === 1 ? '' : 's'} at health ${health}/100.`,
    bullets: [
      `${counts.online} online, ${counts.degraded} degraded, ${counts.offline} offline.`,
      `Average latency ${round(averageLatency(devices), 1)} ms, utilisation ${round(avgUtilization(devices), 1)}%.`,
      `${incidents.length} open incident${incidents.length === 1 ? '' : 's'} affecting this site.`,
    ],
    devices: worst.slice(0, 5),
    links: [
      { label: 'Topology', to: '/topology' },
      { label: 'Devices', to: '/devices' },
    ],
  }
}

function countStatus(q: string, ctx: CopilotContext): CopilotAnswer {
  const status = detectStatus(q)
  const type = detectType(q)
  let devices = ctx.devices
  if (status) devices = devices.filter((device) => device.status === status)
  if (type) devices = devices.filter((device) => device.type === type)

  const parts: string[] = []
  if (status) parts.push(DEVICE_STATUS_LABELS[status].toLowerCase())
  if (type) parts.push(DEVICE_TYPE_LABELS[type].toLowerCase())
  const label = parts.length > 0 ? parts.join(' ') : 'matching'

  return {
    intent: 'count-status',
    title: 'Device count',
    summary: `${devices.length} ${label} device${devices.length === 1 ? '' : 's'}.`,
    bullets:
      devices.length > 0
        ? [
            `Includes: ${devices
              .slice(0, 6)
              .map((device) => device.name)
              .join(', ')}${devices.length > 6 ? ', …' : ''}.`,
          ]
        : ['Nothing matches that description right now.'],
    devices: devices.slice(0, 10),
    links: [{ label: 'Devices', to: '/devices' }],
  }
}

function rankDevices(
  q: string,
  ctx: CopilotContext,
  metric: RankMetric,
): CopilotAnswer {
  const spec = METRIC_SPECS[metric]
  const type = detectType(q)
  const status = detectStatus(q)
  const limit = detectLimit(q)

  let devices = ctx.devices
  if (type) devices = devices.filter((device) => device.type === type)
  if (status) devices = devices.filter((device) => device.status === status)

  const wantsBest = /\b(best|healthiest|fastest|lowest|least)\b/.test(q)
  const descending = spec.higherIsWorse ? !wantsBest : wantsBest

  const ranked = [...devices].sort((a, b) => {
    const delta = spec.value(b, ctx.thresholds) - spec.value(a, ctx.thresholds)
    return descending ? delta : -delta
  })
  const top = ranked.slice(0, limit)
  const super1 = wantsBest ? 'best' : 'worst'
  const unit = spec.unit ? ` ${spec.unit}` : ''

  return {
    intent: 'rank-devices',
    title: `Top ${top.length} by ${spec.label}`,
    summary: `The ${super1} ${top.length} device${top.length === 1 ? '' : 's'} by ${spec.label}${type ? ` (${DEVICE_TYPE_LABELS[type].toLowerCase()}s)` : ''}.`,
    bullets: top.map(
      (device) =>
        `${device.name} — ${round(spec.value(device, ctx.thresholds), 1)}${unit} (${DEVICE_STATUS_LABELS[device.status].toLowerCase()}, ${device.site})`,
    ),
    devices: top,
    links: [{ label: 'Devices', to: '/devices' }],
  }
}

function incidentsAnswer(ctx: CopilotContext): CopilotAnswer {
  const open = ctx.incidents
    .filter((incident) => incident.status !== 'resolved')
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.createdAt - a.createdAt,
    )
  const alerts = ctx.alerts ?? []
  const bySeverity = open.reduce<Record<string, number>>((acc, incident) => {
    acc[incident.severity] = (acc[incident.severity] ?? 0) + 1
    return acc
  }, {})
  const breakdown = (['critical', 'high', 'medium', 'low'] as Severity[])
    .filter((severity) => bySeverity[severity])
    .map((severity) => `${bySeverity[severity]} ${severity}`)
    .join(', ')
  const bullets = open
    .slice(0, 6)
    .map(
      (incident) =>
        `${incident.title} — ${incident.severity}, ${incident.status}`,
    )
  if (alerts.length > 0) {
    bullets.push(
      `${alerts.length} alert${alerts.length === 1 ? '' : 's'} firing: ${alerts
        .slice(0, 4)
        .map((alert) => alert.title)
        .join('; ')}.`,
    )
  }

  return {
    intent: 'incidents',
    title: 'Open incidents',
    summary:
      open.length === 0
        ? 'No open incidents — the fleet is quiet.'
        : `${open.length} open incident${open.length === 1 ? '' : 's'}${breakdown ? ` (${breakdown})` : ''}.`,
    bullets,
    links: [{ label: 'Incidents', to: '/incidents' }],
  }
}

function capacityAnswer(ctx: CopilotContext): CopilotAnswer {
  const util = round(fleetUtilization(ctx.devices), 1)
  const ranked = [...ctx.devices]
    .map((device) => ({
      device,
      util: utilizationPct(device.throughputMbps, device.capacityMbps),
    }))
    .sort((a, b) => b.util - a.util)
  const hot = ranked.filter((entry) => entry.util >= SATURATION_THRESHOLD_PCT)
  return {
    intent: 'capacity',
    title: 'Capacity',
    summary: `Fleet utilisation is ${util}%; ${hot.length} device${hot.length === 1 ? ' is' : 's are'} at or above ${SATURATION_THRESHOLD_PCT}%.`,
    bullets: ranked
      .slice(0, 5)
      .map(
        (entry) =>
          `${entry.device.name} — ${round(entry.util, 1)}% of ${formatMbps(entry.device.capacityMbps)}`,
      ),
    devices: hot.slice(0, 8).map((entry) => entry.device),
    links: [
      { label: 'Planner', to: '/planner' },
      { label: 'Performance', to: '/performance' },
    ],
  }
}

function routeAnswer(q: string, ctx: CopilotContext): CopilotAnswer | null {
  const between = q.match(/\bbetween\s+(.+?)\s+and\s+(.+)$/)
  const fromTo = q.match(/\bfrom\s+(.+?)\s+to\s+(.+)$/)
  const parts = between
    ? [between[1], between[2]]
    : fromTo
      ? [fromTo[1], fromTo[2]]
      : null
  if (!parts) return null

  const from = findDevice(parts[0], ctx.devices)
  const to = findDevice(parts[1], ctx.devices)
  if (!from || !to) {
    return {
      intent: 'route',
      title: 'Path trace',
      summary: "I couldn't match both endpoints to known devices.",
      bullets: [
        `Heard: from “${parts[0].trim()}” to “${parts[1].trim()}”.`,
        'Try full device names, e.g. a device shown on the Devices page.',
      ],
      links: [{ label: 'Path Tracer', to: '/tracer' }],
    }
  }

  const result = trace(ctx.devices, from.id, to.id)
  if (!result.found || !result.primary) {
    return {
      intent: 'route',
      title: `${from.name} → ${to.name}`,
      summary: 'No route found between those devices in the current topology.',
      bullets: [],
      devices: [from, to],
      links: [{ label: 'Path Tracer', to: '/tracer' }],
    }
  }

  const primary = result.primary
  const critical = primary.hops.find(
    (hop) => hop.deviceId === primary.criticalHopId,
  )
  const bullets = [
    `${primary.path.length} hops, total latency ${round(primary.totalLatencyMs, 1)} ms, loss ${round(primary.totalLossPct, 2)}%.`,
  ]
  if (critical) {
    bullets.push(
      `Critical hop: ${critical.device.name} (${round(critical.latencyMs, 1)} ms, ${round(critical.contribution, 1)}% of latency).`,
    )
  }
  if (result.healthyDetour) {
    bullets.push(
      `A healthy detour exists via ${result.healthyDetour.path.map((id) => ctx.devices.find((device) => device.id === id)?.name ?? id).join(' → ')}.`,
    )
  }
  bullets.push(
    `Route: ${primary.path.map((id) => ctx.devices.find((device) => device.id === id)?.name ?? id).join(' → ')}.`,
  )

  return {
    intent: 'route',
    title: `${from.name} → ${to.name}`,
    summary: `Path status: ${primary.status}.`,
    bullets,
    devices: [from, to],
    links: [{ label: 'Path Tracer', to: '/tracer' }],
  }
}

function sloAnswer(ctx: CopilotContext): CopilotAnswer {
  const uptime = round(averageAvailability(ctx.devices), 3)
  const target = 99.9
  const met = uptime >= target
  return {
    intent: 'slo',
    title: 'Service level',
    summary: `Fleet-wide average availability is ${uptime}% against a ${target}% target — ${met ? 'within' : 'below'} budget.`,
    bullets: [
      `Error budget ${met ? 'remaining' : 'at risk'}: ${round(Math.max(0, uptime - target), 3)} pts vs ${target}%.`,
      `Lowest-availability device: ${
        [...ctx.devices].sort(
          (a, b) => a.availabilityPct - b.availabilityPct,
        )[0]?.name ?? 'n/a'
      }.`,
    ],
    links: [{ label: 'SLA & Uptime', to: '/sla' }],
  }
}

/**
 * Answer a natural-language question about the fleet. Always returns an answer
 * (falling back to a helpful prompt) so the UI never has to handle a null.
 */
export function answerQuestion(
  question: string,
  ctx: CopilotContext,
): CopilotAnswer {
  const q = normalize(question)
  if (
    !q ||
    /\bhelp\b/.test(q) ||
    /what can you|what do you do|examples?/.test(q)
  ) {
    return helpAnswer()
  }

  if (/\b(route|path|trace|hops?|connect|reach|from|between|get)\b/.test(q)) {
    const route = routeAnswer(q, ctx)
    if (route) return route
  }

  if (/\bincident|\balerts?\b|\bfiring\b|\bbreaking\b/.test(q)) {
    return incidentsAnswer(ctx)
  }

  if (/\bcapacity|saturat|\boverload|headroom\b/.test(q)) {
    return capacityAnswer(ctx)
  }

  if (/\bslo\b|\buptime|availabilit|error budget|\bsla\b|reliabilit/.test(q)) {
    return sloAnswer(ctx)
  }

  if (/\bhow many|number of|\bcount\b/.test(q)) {
    return countStatus(q, ctx)
  }

  const rankWords =
    /\b(worst|best|healthiest|unhealthiest|slowest|fastest|busiest|top|bottom|highest|lowest|most|least)\b/.test(
      q,
    )
  const metric = detectMetric(q)
  if (rankWords) {
    return rankDevices(q, ctx, metric ?? 'health')
  }

  const device = findDevice(q, ctx.devices)
  if (device) return deviceStatus(device, ctx)

  if (/\bsite|region|datacent|location\b/.test(q)) {
    const site = findSite(q, ctx.devices)
    if (site) return siteStatus(site, ctx)
  }
  const site = findSite(q, ctx.devices)
  if (site && q.includes(site.toLowerCase())) return siteStatus(site, ctx)

  if (
    /\bfleet|network|overall|everything|status|health|summary|how are (we|things)|overview\b/.test(
      q,
    ) ||
    metric
  ) {
    return fleetStatus(ctx)
  }

  return {
    intent: 'unknown',
    title: 'Ask NetScope',
    summary: "I'm not sure what you're asking for yet.",
    bullets: ['Try one of these:', ...COPILOT_EXAMPLES],
    links: [{ label: 'Dashboard', to: '/' }],
  }
}
