import type {
  Device,
  FaultInjection,
  Incident,
  MetricSample,
  Severity,
  TimelineEvent,
} from '@/types'
import {
  blastRadius,
  buildGraph,
  correlateRootCause,
  type RootCause,
} from './dependency'
import { round } from './format'
import { buildIncidentReport, type IncidentReport } from './report'
import { runbookForIncident, type Runbook } from './runbooks'

/**
 * Incident Command Center ("War Room").
 *
 * Assembles everything an operator needs for a single incident into one room:
 * the matched runbook, ranked probable root causes, the dependent blast radius,
 * incident metrics and a merged causal timeline of events and operator notes.
 * Pure and deterministic (aside from the caller-supplied `now`).
 */

export interface IncidentNote {
  id: string
  incidentId: string
  at: number
  author: string
  body: string
}

export type CausalKind = 'event' | 'note'

export interface CausalEntry {
  id: string
  at: number
  kind: CausalKind
  /** Underlying event type when `kind` is `event`. */
  type: TimelineEvent['type']
  severity?: Severity
  deviceId?: string
  author?: string
  message: string
}

export interface IncidentRoomInput {
  incident: Incident
  devices: Device[]
  events: TimelineEvent[]
  history: Record<string, MetricSample[]>
  faults: FaultInjection[]
  notes: IncidentNote[]
  now: number
}

export interface IncidentRoom {
  incident: Incident
  runbook: Runbook
  report: IncidentReport
  rootCauses: RootCause[]
  impactedDevices: Device[]
  /** Dependent devices outside the affected set that would also be hit. */
  blastRadius: Device[]
  causalChain: CausalEntry[]
  ageMs: number
}

/** Merge timeline events and operator notes for an incident, oldest first. */
export function buildCausalChain(input: {
  incident: Incident
  events: TimelineEvent[]
  notes: IncidentNote[]
  now: number
  limit?: number
}): CausalEntry[] {
  const { incident, events, notes, now } = input
  const targets = new Set(incident.deviceIds)
  const start = incident.createdAt
  const end = incident.resolvedAt ?? now

  const eventEntries: CausalEntry[] = events
    .filter(
      (event) =>
        (event.deviceId !== undefined && targets.has(event.deviceId)) ||
        (event.timestamp >= start && event.timestamp <= end),
    )
    .map((event) => ({
      id: `evt-${event.id}`,
      at: event.timestamp,
      kind: 'event',
      type: event.type,
      severity: event.severity,
      deviceId: event.deviceId,
      message: event.message,
    }))

  const noteEntries: CausalEntry[] = notes
    .filter((note) => note.incidentId === incident.id)
    .map((note) => ({
      id: `note-${note.id}`,
      at: note.at,
      kind: 'note',
      type: 'config',
      author: note.author,
      message: note.body,
    }))

  return [...eventEntries, ...noteEntries]
    .sort((a, b) => a.at - b.at)
    .slice(0, input.limit ?? 60)
}

/**
 * Build the full incident room. Root causes are correlated over the incident's
 * affected devices; the blast radius is the set of dependent devices that sit
 * outside the affected set but downstream of the top root cause.
 */
export function buildIncidentRoom(input: IncidentRoomInput): IncidentRoom {
  const { incident, devices, events, history, faults, notes, now } = input
  const graph = buildGraph(devices)
  const byId = new Map(devices.map((device) => [device.id, device]))
  const targets = new Set(incident.deviceIds)

  const impactedDevices = devices.filter((device) => targets.has(device.id))

  const rootCauses = correlateRootCause({
    devices,
    graph,
    affected: [...targets],
    limit: 3,
  })

  const probableCause =
    rootCauses.length > 0
      ? (byId.get(rootCauses[0].deviceId)?.name ?? rootCauses[0].deviceId)
      : null

  const runbook = runbookForIncident({ incident, devices, faults, now })

  const report = buildIncidentReport({
    incident,
    devices,
    events,
    history,
    generatedAt: now,
    runbook,
    probableCause,
  })

  const blastSet = new Set<string>()
  if (rootCauses.length > 0) {
    for (const id of blastRadius(graph, rootCauses[0].deviceId, 'downstream')) {
      blastSet.add(id)
    }
  } else {
    for (const id of targets) {
      for (const next of blastRadius(graph, id, 'downstream'))
        blastSet.add(next)
    }
  }
  for (const id of targets) blastSet.delete(id)

  const radius = [...blastSet]
    .map((id) => byId.get(id))
    .filter((device): device is Device => Boolean(device))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    incident,
    runbook,
    report,
    rootCauses,
    impactedDevices,
    blastRadius: radius,
    causalChain: buildCausalChain({ incident, events, notes, now }),
    ageMs: round(
      Math.max(0, (incident.resolvedAt ?? now) - incident.createdAt),
      0,
    ),
  }
}
