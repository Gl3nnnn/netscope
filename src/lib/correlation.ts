/**
 * AIOps alert/incident correlation → Problems.
 *
 * Groups live alert instances and open incidents into a smaller set of
 * "problems" using four signals (shared device, topology proximity ≤2 hops,
 * shared site, shared business service) inside a 5-minute window, then picks a
 * root cause with the existing dependency-graph ranker. Groups of one are
 * reported separately as uncorrelated singles.
 *
 * Pure — pass the fleet, the live signals and a tick.
 */
import type { AlertInstance } from '@/lib/alerts'
import type { BusinessService } from '@/lib/services'
import type { Device, Severity } from '@/types'
import { buildGraph, correlateRootCause } from '@/lib/dependency'
import { clamp01, round } from '@/lib/format'
import { resolveServiceDevices } from '@/lib/services'
import { deriveLinks } from '@/lib/topology'
import { hashSeed } from '@/simulation/random'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type SignalKind = 'device' | 'topology' | 'site' | 'service'

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  device: 'Shared device',
  topology: 'Topology ≤2 hops',
  site: 'Same site',
  service: 'Shared service',
}

const SIGNAL_PRIORITY: SignalKind[] = ['device', 'topology', 'site', 'service']

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
}

/** Pairwise grouping window. */
export const CORRELATION_WINDOW_MS = 5 * 60_000
/** Maximum link distance for the topology signal. */
export const TOPOLOGY_HOPS = 2

export interface ProblemMember {
  source: 'alert' | 'incident'
  id: string
  /** Alert rule name or incident title. */
  label: string
  deviceIds: string[]
  deviceName: string
  severity: Severity
  startedAt: number
}

export interface RootCauseInfo {
  deviceId: string
  deviceName: string
  score: number
  evidence: string[]
}

export interface Problem {
  /** Stable for a given member set: `prob_<hash>`. */
  id: string
  title: string
  severity: Severity
  /** Strongest signal that bound the group. */
  kind: SignalKind
  signals: SignalKind[]
  members: ProblemMember[]
  deviceIds: string[]
  site: string | null
  startedAt: number
  confidence: number
  rootCause: RootCauseInfo | null
}

export interface CorrelateInput {
  devices: Device[]
  alerts: AlertInstance[]
  incidents: {
    id: string
    title: string
    severity: Severity
    status: string
    deviceIds: string[]
    createdAt: number
  }[]
  services?: BusinessService[]
  now: number
}

export interface CorrelationResult {
  problems: Problem[]
  /** Uncorrelated inputs (groups of one). */
  singles: ProblemMember[]
  inputs: number
}

export interface CorrelationSummary {
  inputs: number
  problems: number
  singles: number
  grouped: number
  /** 1 − problems/inputs, only when something was actually grouped. */
  reductionPct: number
  /** Share of inputs absorbed into a multi-signal group. */
  absorbedPct: number
  meanMembers: number
  critical: number
  signalCounts: Record<SignalKind, number>
}

export type AckMap = Record<string, number>

export type AcknowledgedProblem = Problem & { acknowledgedAt: number | null }

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

function alertMember(alert: AlertInstance): ProblemMember | null {
  if (alert.status !== 'firing' || alert.firedAt === null) return null
  return {
    source: 'alert',
    id: alert.id,
    label: alert.ruleName,
    deviceIds: [alert.deviceId],
    deviceName: alert.deviceName,
    severity: alert.severity,
    startedAt: alert.firedAt,
  }
}

function incidentMember(
  incident: CorrelateInput['incidents'][number],
  devices: Map<string, Device>,
): ProblemMember | null {
  if (incident.status === 'resolved') return null
  const primary = incident.deviceIds[0]
  const device = primary ? devices.get(primary) : undefined
  return {
    source: 'incident',
    id: incident.id,
    label: incident.title,
    deviceIds: [...incident.deviceIds],
    deviceName: device?.name ?? 'unknown device',
    severity: incident.severity,
    startedAt: incident.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Pairwise signals
// ---------------------------------------------------------------------------

function buildAdjacency(devices: Device[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const device of devices) adjacency.set(device.id, [])
  for (const link of deriveLinks(devices)) {
    adjacency.get(link.source)?.push(link.target)
    adjacency.get(link.target)?.push(link.source)
  }
  return adjacency
}

/** Bounded BFS: true when `from` reaches `to` within `maxHops` links. */
function withinHops(
  adjacency: Map<string, string[]>,
  from: string,
  to: string,
  maxHops: number,
): boolean {
  if (from === to) return false
  const seen = new Set([from])
  let frontier = [from]
  for (let hop = 0; hop < maxHops; hop += 1) {
    const next: string[] = []
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (neighbour === to) return true
        if (seen.has(neighbour)) continue
        seen.add(neighbour)
        next.push(neighbour)
      }
    }
    if (next.length === 0) return false
    frontier = next
  }
  return false
}

function pairSignals(
  a: ProblemMember,
  b: ProblemMember,
  input: {
    deviceSite: Map<string, string>
    adjacency: Map<string, string[]>
    serviceDevices: Map<string, Set<string>>
  },
): SignalKind[] {
  const shared = a.deviceIds.some((id) => b.deviceIds.includes(id))
  if (shared) return ['device']

  const kinds: SignalKind[] = []

  const topology = a.deviceIds.some((left) =>
    b.deviceIds.some((right) =>
      withinHops(input.adjacency, left, right, TOPOLOGY_HOPS),
    ),
  )
  if (topology) kinds.push('topology')

  const sitesA = new Set(
    a.deviceIds.map((id) => input.deviceSite.get(id)).filter(Boolean),
  )
  const sharedSite = b.deviceIds.some((id) => {
    const site = input.deviceSite.get(id)
    return site !== undefined && sitesA.has(site)
  })
  if (sharedSite) kinds.push('site')

  const sharedService = [...input.serviceDevices.values()].some((set) => {
    const inA = a.deviceIds.some((id) => set.has(id))
    const inB = b.deviceIds.some((id) => set.has(id))
    return inA && inB
  })
  if (sharedService) kinds.push('service')

  return kinds
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index)
  }

  find(x: number): number {
    let root = x
    while (this.parent[root] !== root) root = this.parent[root]!
    let cursor = x
    while (this.parent[cursor] !== cursor) {
      const next = this.parent[cursor]!
      this.parent[cursor] = root
      cursor = next
    }
    return root
  }

  union(a: number, b: number): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent[rootB] = rootA
  }
}

function problemId(members: ProblemMember[]): string {
  const key = members
    .map((member) => `${member.id}#${member.deviceIds.join('+')}`)
    .slice()
    .sort()
    .join(',')
  return `prob_${hashSeed(key).toString(36)}`
}

function dominantLabel(members: ProblemMember[]): string {
  const counts = new Map<string, { count: number; first: number }>()
  for (const member of members) {
    const entry = counts.get(member.label)
    if (entry) entry.count += 1
    else counts.set(member.label, { count: 1, first: member.startedAt })
  }
  let best: { label: string; count: number; first: number } | null = null
  for (const [label, entry] of counts) {
    if (
      best === null ||
      entry.count > best.count ||
      (entry.count === best.count && entry.first < best.first)
    ) {
      best = { label, count: entry.count, first: entry.first }
    }
  }
  return best?.label ?? 'Correlated problem'
}

function buildProblem(
  members: ProblemMember[],
  signalKinds: SignalKind[],
  input: {
    devices: Map<string, Device>
    deviceSite: Map<string, string>
    allDevices: Device[]
    now: number
  },
): Problem {
  const deviceIds = [...new Set(members.flatMap((member) => member.deviceIds))]
  const severity = members.reduce(
    (worst, member) =>
      SEVERITY_RANK[member.severity] > SEVERITY_RANK[worst]
        ? member.severity
        : worst,
    'low' as Severity,
  )
  const startedAt = Math.min(...members.map((member) => member.startedAt))
  const signals = SIGNAL_PRIORITY.filter((kind) => signalKinds.includes(kind))
  const kind = signals[0] ?? 'device'

  const sites = new Set(
    deviceIds.map((id) => input.deviceSite.get(id)).filter(Boolean),
  )
  const site = sites.size === 1 ? [...sites][0]! : null

  let rootCause: RootCauseInfo | null = null
  if (deviceIds.length > 1) {
    const graph = buildGraph(input.allDevices)
    const roots = correlateRootCause({
      devices: input.allDevices,
      graph,
      affected: deviceIds,
      limit: 1,
    })
    const root = roots[0]
    if (root) {
      rootCause = {
        deviceId: root.deviceId,
        deviceName: input.devices.get(root.deviceId)?.name ?? root.deviceId,
        score: round(root.score, 2),
        evidence: root.evidence,
      }
    }
  } else if (deviceIds.length === 1) {
    const id = deviceIds[0]!
    rootCause = {
      deviceId: id,
      deviceName: input.devices.get(id)?.name ?? id,
      score: 1,
      evidence: ['Every member points at the same device'],
    }
  }

  const label = dominantLabel(members)
  const title = rootCause ? `${rootCause.deviceName}: ${label}` : label
  const confidence = clamp01(
    round(
      0.45 +
        0.12 * Math.max(0, members.length - 2) +
        0.12 * Math.max(0, signals.length - 1),
      2,
    ),
  )

  const sortedMembers = members
    .slice()
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.startedAt - b.startedAt ||
        a.id.localeCompare(b.id),
    )

  return {
    id: problemId(members),
    title,
    severity,
    kind,
    signals,
    members: sortedMembers,
    deviceIds,
    site,
    startedAt,
    confidence,
    rootCause,
  }
}

/** Group alerts and incidents into problems; leftovers return as singles. */
export function correlate(input: CorrelateInput): CorrelationResult {
  const deviceMap = new Map(input.devices.map((device) => [device.id, device]))
  const deviceSite = new Map(
    input.devices.map((device) => [device.id, device.site]),
  )
  const adjacency = buildAdjacency(input.devices)

  const serviceDevices = new Map<string, Set<string>>()
  for (const service of input.services ?? []) {
    serviceDevices.set(
      service.id,
      new Set(resolveServiceDevices(service, input.devices).map((d) => d.id)),
    )
  }

  const members: ProblemMember[] = []
  for (const alert of input.alerts) {
    const member = alertMember(alert)
    if (member) members.push(member)
  }
  for (const incident of input.incidents) {
    const member = incidentMember(incident, deviceMap)
    if (member) members.push(member)
  }

  if (members.length === 0) {
    return { problems: [], singles: [], inputs: 0 }
  }

  const union = new UnionFind(members.length)
  const pairKinds: SignalKind[][] = Array.from(
    { length: members.length },
    () => [],
  )

  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      const a = members[i]!
      const b = members[j]!
      if (Math.abs(a.startedAt - b.startedAt) > CORRELATION_WINDOW_MS) continue
      const kinds = pairSignals(a, b, {
        deviceSite,
        adjacency,
        serviceDevices,
      })
      if (kinds.length === 0) continue
      union.union(i, j)
      pairKinds[i]!.push(...kinds)
      pairKinds[j]!.push(...kinds)
    }
  }

  const groups = new Map<
    number,
    { members: ProblemMember[]; kinds: SignalKind[] }
  >()
  for (let index = 0; index < members.length; index += 1) {
    const root = union.find(index)
    const group = groups.get(root) ?? { members: [], kinds: [] }
    group.members.push(members[index]!)
    group.kinds.push(...pairKinds[index]!)
    groups.set(root, group)
  }

  const problems: Problem[] = []
  const singles: ProblemMember[] = []

  for (const group of groups.values()) {
    if (group.members.length === 1) {
      singles.push(group.members[0]!)
      continue
    }
    problems.push(
      buildProblem(group.members, group.kinds, {
        devices: deviceMap,
        deviceSite,
        allDevices: input.devices,
        now: input.now,
      }),
    )
  }

  problems.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.members.length - a.members.length ||
      a.startedAt - b.startedAt ||
      a.id.localeCompare(b.id),
  )
  singles.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      a.startedAt - b.startedAt ||
      a.id.localeCompare(b.id),
  )

  return { problems, singles, inputs: members.length }
}

// ---------------------------------------------------------------------------
// Summary & acknowledgements
// ---------------------------------------------------------------------------

export function correlationSummary(
  result: CorrelationResult,
): CorrelationSummary {
  const { problems, singles, inputs } = result
  const grouped = inputs - singles.length
  const signalCounts: Record<SignalKind, number> = {
    device: 0,
    topology: 0,
    site: 0,
    service: 0,
  }
  for (const problem of problems) {
    for (const kind of problem.signals) signalCounts[kind] += 1
  }

  return {
    inputs,
    problems: problems.length,
    singles: singles.length,
    grouped,
    reductionPct:
      problems.length > 0 && inputs > 0
        ? round((1 - problems.length / inputs) * 100, 1)
        : 0,
    absorbedPct: inputs > 0 ? round((grouped / inputs) * 100, 1) : 0,
    meanMembers:
      problems.length > 0
        ? round(
            problems.reduce((sum, problem) => sum + problem.members.length, 0) /
              problems.length,
            1,
          )
        : 0,
    critical: problems.filter((problem) => problem.severity === 'critical')
      .length,
    signalCounts,
  }
}

/** Overlay persisted acknowledgements onto freshly-correlated problems. */
export function withAcknowledged(
  problems: Problem[],
  acks: AckMap,
): AcknowledgedProblem[] {
  return problems.map((problem) => ({
    ...problem,
    acknowledgedAt: acks[problem.id] ?? null,
  }))
}
