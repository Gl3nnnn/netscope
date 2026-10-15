/**
 * Quality of Service engine.
 *
 * Classifies simulated flows into traffic classes with DSCP markings, computes
 * weighted-fair-queue allocation against device line capacity, detects drops,
 * starvation and priority inversion, and offers a clone-only what-if reshaper.
 *
 * Pure and dependency-free: pass in flows (from `@/lib/flow`) and optional
 * per-device capacity, get back deterministic numbers.
 */
import type { ApplicationKind, FlowRecord } from '@/lib/flow'
import { applicationMeta } from '@/lib/flow'
import { clamp01, formatPct, round } from '@/lib/format'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type TrafficClass =
  'realtime' | 'interactive' | 'transactional' | 'bulk' | 'best-effort'

export interface ClassMeta {
  class: TrafficClass
  label: string
  /** DSCP codepoint as configured on the ingress policy. */
  dscp: number
  dscpName: string
  /** Queue weight (%) under the default weighted-fair policy. */
  weight: number
  /** Tailwind-ish colour token used by the page. */
  colour: string
  /** Describes the queue's scheduling role. */
  queue: string
}

export const CLASS_ORDER: TrafficClass[] = [
  'realtime',
  'interactive',
  'transactional',
  'bulk',
  'best-effort',
]

export const CLASS_META: Record<TrafficClass, ClassMeta> = {
  realtime: {
    class: 'realtime',
    label: 'Realtime',
    dscp: 46,
    dscpName: 'EF',
    weight: 30,
    colour: 'bg-violet-500',
    queue: 'Priority queue (LLQ)',
  },
  interactive: {
    class: 'interactive',
    label: 'Interactive',
    dscp: 34,
    dscpName: 'AF41',
    weight: 25,
    colour: 'bg-sky-500',
    queue: 'Assured forwarding 4',
  },
  transactional: {
    class: 'transactional',
    label: 'Transactional',
    dscp: 18,
    dscpName: 'AF21',
    weight: 20,
    colour: 'bg-emerald-500',
    queue: 'Assured forwarding 2',
  },
  bulk: {
    class: 'bulk',
    label: 'Bulk / Backup',
    dscp: 8,
    dscpName: 'CS1',
    weight: 15,
    colour: 'bg-amber-500',
    queue: 'Scavenger (background)',
  },
  'best-effort': {
    class: 'best-effort',
    label: 'Best effort',
    dscp: 0,
    dscpName: 'BE',
    weight: 10,
    colour: 'bg-zinc-500',
    queue: 'Default queue',
  },
}

/** DSCP name lookup used by the table headers. */
export const DSCP_NAMES: Record<number, string> = {
  46: 'EF',
  34: 'AF41',
  18: 'AF21',
  8: 'CS1',
  0: 'BE',
}

/** Application → traffic class mapping. */
const CLASS_BY_APPLICATION: Record<ApplicationKind, TrafficClass> = {
  voip: 'realtime',
  video: 'realtime',
  ssh: 'interactive',
  database: 'interactive',
  dns: 'interactive',
  web: 'transactional',
  mail: 'transactional',
  backup: 'bulk',
  file: 'bulk',
  other: 'best-effort',
}

/** A flow joined with its class and DSCP marking. */
export interface ClassifiedFlow {
  flow: FlowRecord
  class: TrafficClass
  dscp: number
  dscpName: string
  /** Packets-per-second weight used for the drop estimate. */
  packetsPerSec: number
}

/** Per-class aggregate used throughout the page and tests. */
export interface ClassStat {
  class: TrafficClass
  label: string
  dscp: number
  dscpName: string
  queue: string
  weight: number
  flows: number
  throughputMbps: number
  /** Share of total classified throughput (0..100). */
  sharePct: number
  /** Bandwidth reserved for this class (weight% of line capacity). */
  allocatedMbps: number
  /** Utilisation against allocation (0..∞ as a ratio, clamped for display). */
  utilisationPct: number
  /** Simulated tail drops when demand exceeds allocation. */
  dropsPps: number
  dropsMbps: number
}

export interface QosSummary {
  totalFlows: number
  classifiedFlows: number
  throughputMbps: number
  capacityMbps: number
  byClass: ClassStat[]
  /** Sum of per-class drops. */
  dropsPps: number
  dropsMbps: number
  /** Classes whose demand exceeds their allocation. */
  starved: TrafficClass[]
  /** True when a demoted class outranks a starved priority class. */
  inversion: boolean
  inversionDetail: string | null
  /** 0-100 policy health. */
  score: number
  grade: 'clean' | 'stressed' | 'failing'
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Map a flow to its traffic class. */
export function classifyFlow(flow: FlowRecord): TrafficClass {
  return CLASS_BY_APPLICATION[flow.application] ?? 'best-effort'
}

/** Classify a batch of flows, preserving input order. */
export function classifyFlows(flows: FlowRecord[]): ClassifiedFlow[] {
  return flows.map((flow) => {
    const cls = classifyFlow(flow)
    const meta = CLASS_META[cls]
    return {
      flow,
      class: cls,
      dscp: meta.dscp,
      dscpName: meta.dscpName,
      packetsPerSec: flow.packetsPerSec,
    }
  })
}

/** Total classified throughput (Mbps). */
export function totalThroughput(flows: FlowRecord[]): number {
  return round(
    flows.reduce((sum, flow) => sum + flow.throughputMbps, 0),
    1,
  )
}

// ---------------------------------------------------------------------------
// Per-class statistics
// ---------------------------------------------------------------------------

/**
 * Aggregate flows per class against a line capacity.
 *
 * `capacityMbps` defaults to the total demand (i.e. a fully-loaded link), so
 * an unshaped run always shows the policy at its configured weights.
 */
export function classStats(
  flows: FlowRecord[],
  capacityMbps?: number,
): ClassStat[] {
  const classified = classifyFlows(flows)
  const total = classified.reduce(
    (sum, item) => sum + item.flow.throughputMbps,
    0,
  )
  const capacity = capacityMbps ?? total

  const buckets = new Map<
    TrafficClass,
    { flows: number; mbps: number; pps: number }
  >()
  for (const item of classified) {
    const bucket = buckets.get(item.class) ?? { flows: 0, mbps: 0, pps: 0 }
    bucket.flows += 1
    bucket.mbps += item.flow.throughputMbps
    bucket.pps += item.flow.packetsPerSec
    buckets.set(item.class, bucket)
  }

  return CLASS_ORDER.map((cls) => {
    const meta = CLASS_META[cls]
    const bucket = buckets.get(cls) ?? { flows: 0, mbps: 0, pps: 0 }
    const mbps = round(bucket.mbps, 1)
    const allocatedMbps = round((meta.weight / 100) * capacity, 1)
    const over = Math.max(0, mbps - allocatedMbps)
    // Tail-drop model: the excess shares the class's packet rate pro-rata.
    const dropsMbps = round(over, 1)
    const dropsPps =
      bucket.mbps > 0 && over > 0
        ? Math.round((bucket.pps * over) / bucket.mbps)
        : 0

    return {
      class: cls,
      label: meta.label,
      dscp: meta.dscp,
      dscpName: meta.dscpName,
      queue: meta.queue,
      weight: meta.weight,
      flows: bucket.flows,
      throughputMbps: mbps,
      sharePct: total > 0 ? round((mbps / total) * 100, 1) : 0,
      allocatedMbps,
      utilisationPct:
        allocatedMbps > 0 ? round((mbps / allocatedMbps) * 100, 1) : 0,
      dropsMbps,
      dropsPps,
    }
  })
}

// ---------------------------------------------------------------------------
// Starvation & inversion
// ---------------------------------------------------------------------------

/**
 * Classes that are over their configured allocation (demand > reserved
 * bandwidth) — the operator's "starved" list.
 */
export function detectStarvation(stats: ClassStat[]): TrafficClass[] {
  return stats
    .filter((stat) => stat.dropsMbps > 0 && stat.flows > 0)
    .map((stat) => stat.class)
}

/**
 * Priority inversion: a demoted (bulk / best-effort) class is carrying more
 * throughput than the realtime class while realtime is dropping packets.
 */
export function priorityInversion(stats: ClassStat[]): {
  inverted: boolean
  detail: string | null
} {
  const realtime = stats.find((stat) => stat.class === 'realtime')
  if (!realtime || realtime.dropsMbps <= 0) {
    return { inverted: false, detail: null }
  }
  for (const cls of ['bulk', 'best-effort'] as const) {
    const low = stats.find((stat) => stat.class === cls)
    if (low && low.throughputMbps > realtime.throughputMbps) {
      return {
        inverted: true,
        detail: `${low.label} (${formatPct(low.sharePct, 0)} of the link) outranks starved Realtime (${formatPct(realtime.sharePct, 0)}).`,
      }
    }
  }
  return { inverted: false, detail: null }
}

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export function qosScore(summary: Omit<QosSummary, 'score' | 'grade'>): number {
  let score = 100
  // Drops cost: up to 60 points when the whole link is in tail-drop.
  const dropRatio =
    summary.throughputMbps > 0
      ? clamp01(summary.dropsMbps / Math.max(summary.throughputMbps, 1))
      : 0
  score -= Math.round(dropRatio * 60)
  score -= summary.starved.length * 5
  if (summary.inversion) score -= 15
  return Math.max(0, Math.min(100, score))
}

export function qosGrade(score: number): QosSummary['grade'] {
  if (score >= 85) return 'clean'
  if (score >= 60) return 'stressed'
  return 'failing'
}

// ---------------------------------------------------------------------------
// Full summary
// ---------------------------------------------------------------------------

export function qosSummary(
  flows: FlowRecord[],
  capacityMbps?: number,
): QosSummary {
  const byClass = classStats(flows, capacityMbps)
  const throughputMbps = round(
    byClass.reduce((sum, stat) => sum + stat.throughputMbps, 0),
    1,
  )
  const capacity = capacityMbps ?? throughputMbps
  const dropsMbps = round(
    byClass.reduce((sum, stat) => sum + stat.dropsMbps, 0),
    1,
  )
  const dropsPps = byClass.reduce((sum, stat) => sum + stat.dropsPps, 0)
  const starved = detectStarvation(byClass)
  const { inverted, detail } = priorityInversion(byClass)

  const base = {
    totalFlows: flows.length,
    classifiedFlows: flows.length,
    throughputMbps,
    capacityMbps: round(capacity, 1),
    byClass,
    dropsPps,
    dropsMbps,
    starved,
    inversion: inverted,
    inversionDetail: detail,
  }
  const score = qosScore(base)
  return { ...base, score, grade: qosGrade(score) }
}

// ---------------------------------------------------------------------------
// What-if reshaping (clone-only)
// ---------------------------------------------------------------------------

export interface ReshapeResult {
  before: ClassStat[]
  after: ClassStat[]
  /** Per-class delta in drops (negative = improvement). */
  dropsDelta: Record<TrafficClass, number>
  /** Total drop change; negative is an improvement. */
  totalDropsDelta: number
  /** Whether the candidate weights are legal (sum to 100). */
  valid: boolean
}

/**
 * Evaluate a candidate weight policy WITHOUT touching the live state.
 * Inputs are cloned; the returned `after` stats reflect the new allocation.
 */
export function whatIfReshape(
  flows: FlowRecord[],
  candidate: Partial<Record<TrafficClass, number>>,
  capacityMbps?: number,
): ReshapeResult {
  const before = classStats(flows, capacityMbps)
  const total = candidate
    ? CLASS_ORDER.reduce(
        (sum, cls) =>
          sum + Math.max(0, candidate[cls] ?? CLASS_META[cls].weight),
        0,
      )
    : 100
  const valid = total === 100

  const totalDemand = before.reduce((sum, stat) => sum + stat.throughputMbps, 0)
  const capacity = capacityMbps ?? totalDemand

  const after: ClassStat[] = before.map((stat) => {
    const weight = valid
      ? Math.max(0, candidate[stat.class] ?? stat.weight)
      : stat.weight
    const allocatedMbps = round((weight / 100) * capacity, 1)
    const over = Math.max(0, stat.throughputMbps - allocatedMbps)
    const dropsMbps = round(over, 1)
    return {
      ...stat,
      weight,
      allocatedMbps,
      dropsMbps,
      dropsPps:
        stat.throughputMbps > 0 && over > 0
          ? Math.round(
              stat.dropsPps * (over / Math.max(stat.throughputMbps, 0.0001)),
            )
          : 0,
      utilisationPct:
        allocatedMbps > 0
          ? round((stat.throughputMbps / allocatedMbps) * 100, 1)
          : 0,
    }
  })

  const dropsDelta = Object.fromEntries(
    CLASS_ORDER.map((cls) => {
      const b = before.find((stat) => stat.class === cls)?.dropsMbps ?? 0
      const a = after.find((stat) => stat.class === cls)?.dropsMbps ?? 0
      return [cls, round(a - b, 1)]
    }),
  ) as Record<TrafficClass, number>

  const totalDropsDelta = round(
    after.reduce((sum, stat) => sum + stat.dropsMbps, 0) -
      before.reduce((sum, stat) => sum + stat.dropsMbps, 0),
    1,
  )

  return { before, after, dropsDelta, totalDropsDelta, valid }
}

// ---------------------------------------------------------------------------
// Policy templates
// ---------------------------------------------------------------------------

/** Ready-made weight policies the page can apply as what-if candidates. */
export const QOS_POLICIES: {
  id: string
  label: string
  description: string
  weights: Record<TrafficClass, number>
}[] = [
  {
    id: 'default',
    label: 'Balanced',
    description: 'Even weighting with a modest priority lane.',
    weights: {
      realtime: 30,
      interactive: 25,
      transactional: 20,
      bulk: 15,
      'best-effort': 10,
    },
  },
  {
    id: 'voice-first',
    label: 'Voice-first',
    description: 'Maximum guarantee for VoIP and video.',
    weights: {
      realtime: 50,
      interactive: 25,
      transactional: 15,
      bulk: 5,
      'best-effort': 5,
    },
  },
  {
    id: 'batch',
    label: 'Batch-friendly',
    description: 'Headroom for backups and file replication.',
    weights: {
      realtime: 20,
      interactive: 20,
      transactional: 15,
      bulk: 35,
      'best-effort': 10,
    },
  },
  {
    id: 'equal',
    label: 'Equal share',
    description: 'Flat 20% per class — baseline for comparison.',
    weights: {
      realtime: 20,
      interactive: 20,
      transactional: 20,
      bulk: 20,
      'best-effort': 20,
    },
  },
]

/** Human-readable utilisation helper for cards. */
export function formatUtilisation(stat: ClassStat): string {
  return formatPct(stat.utilisationPct, 0)
}

/** Default policy weights (the configured baseline). */
export function defaultWeights(): Record<TrafficClass, number> {
  return CLASS_ORDER.reduce(
    (acc, cls) => ({ ...acc, [cls]: CLASS_META[cls].weight }),
    {} as Record<TrafficClass, number>,
  )
}

/** Packets-per-Mbit helper re-exported for the page's drop estimate note. */
export function packetsPerMb(application: ApplicationKind): number {
  return applicationMeta(application).packetsPerMb
}
