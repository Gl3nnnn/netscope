import { hashSeed, mulberry32 } from '@/simulation/random'

export type JourneyKind = 'vpn' | 'mail' | 'checkout' | 'payments' | 'dns'
export type JourneyStatus = 'healthy' | 'degraded' | 'failing'

export interface JourneyStep {
  key: 'dns' | 'tcp' | 'tls' | 'http'
  label: string
  ms: number
}

export interface JourneyResult {
  id: string
  kind: JourneyKind
  site: string
  label: string
  steps: JourneyStep[]
  totalMs: number
  apdex: number
  availabilityPct: number
  status: JourneyStatus
  error: string | null
  history: number[]
}

export interface SiteExperience {
  site: string
  journeys: JourneyResult[]
  avgApdex: number
  avgLatencyMs: number
  status: JourneyStatus
}

export interface ExperienceSummary {
  total: number
  healthy: number
  degraded: number
  failing: number
  avgApdex: number
  avgLatencyMs: number
  availabilityPct: number
  score: number
}

/** Apdex satisfaction threshold in milliseconds. */
export const APDEX_T = 300
/** Number of simulated minutes kept per journey sparkline. */
export const HISTORY_POINTS = 30
/** Percent chance a synthetic check fails on a given minute. */
export const FAILURE_RATE = 5

const PHASES = [
  { key: 'dns', label: 'DNS', weight: 1 },
  { key: 'tcp', label: 'TCP', weight: 2 },
  { key: 'tls', label: 'TLS', weight: 3 },
  { key: 'http', label: 'HTTP', weight: 1 },
] as const

/** Base milliseconds per phase before site latency and jitter. */
export const JOURNEY_TEMPLATES: Record<
  JourneyKind,
  { label: string; bases: Record<JourneyStep['key'], number> }
> = {
  vpn: { label: 'VPN connect', bases: { dns: 6, tcp: 70, tls: 60, http: 24 } },
  mail: { label: 'Mail access', bases: { dns: 6, tcp: 30, tls: 35, http: 90 } },
  checkout: {
    label: 'Checkout flow',
    bases: { dns: 5, tcp: 40, tls: 45, http: 140 },
  },
  payments: {
    label: 'Payment auth',
    bases: { dns: 5, tcp: 45, tls: 90, http: 130 },
  },
  dns: { label: 'DNS lookup', bases: { dns: 70, tcp: 6, tls: 4, http: 10 } },
}

export const JOURNEY_KINDS = Object.keys(JOURNEY_TEMPLATES) as JourneyKind[]

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function journeyId(site: string, kind: JourneyKind): string {
  return `${slugify(site)}:${kind}`
}

/** Standard Apdex scoring: satisfied ≤ t, tolerating ≤ 4t, error beyond. */
export function apdexFor(ms: number, t: number = APDEX_T): number {
  if (ms <= t) return 1
  if (ms <= 4 * t) return 0.5
  return 0
}

export function statusFor(
  totalMs: number,
  failed: boolean,
  t: number = APDEX_T,
): JourneyStatus {
  if (failed) return 'failing'
  if (totalMs <= t) return 'healthy'
  if (totalMs <= 3 * t) return 'degraded'
  return 'failing'
}

function siteLatencyMs(site: string, seed: number): number {
  return (hashSeed(`${seed}|${site}|latency`) % 40) + 4
}

interface Sample {
  totalMs: number
  failed: boolean
}

function phaseTotals(
  site: string,
  kind: JourneyKind,
  seed: number,
  tick: number,
  failed: boolean,
  failIndex: number,
): number[] {
  const latency = siteLatencyMs(site, seed)
  const jitter = mulberry32(hashSeed(`${seed}|${site}|${kind}|${tick}`))
  const template = JOURNEY_TEMPLATES[kind]
  return PHASES.map((phase, i) => {
    const base = template.bases[phase.key]
    let ms = Math.round(
      base + base * jitter.next() * 0.4 + latency * phase.weight * 0.5,
    )
    if (failed && i === failIndex) ms *= 8
    return ms
  })
}

function sampleJourney(
  site: string,
  kind: JourneyKind,
  seed: number,
  tick: number,
): Sample {
  const tKey = `${seed}|${site}|${kind}|${tick}`
  const failed = hashSeed(`${tKey}|fail`) % 100 < FAILURE_RATE
  const failIndex = hashSeed(`${tKey}|step`) % PHASES.length
  const totals = phaseTotals(site, kind, seed, tick, failed, failIndex)
  return { totalMs: totals.reduce((sum, ms) => sum + ms, 0), failed }
}

/** Run one synthetic journey for a site at a simulated minute tick. */
export function runJourney(
  site: string,
  kind: JourneyKind,
  seed: number,
  tick: number,
): JourneyResult {
  const template = JOURNEY_TEMPLATES[kind]
  const tKey = `${seed}|${site}|${kind}|${tick}`
  const failed = hashSeed(`${tKey}|fail`) % 100 < FAILURE_RATE
  const failIndex = hashSeed(`${tKey}|step`) % PHASES.length
  const totals = phaseTotals(site, kind, seed, tick, failed, failIndex)

  const steps: JourneyStep[] = PHASES.map((phase, i) => ({
    key: phase.key,
    label: phase.label,
    ms: totals[i]!,
  }))

  const history: number[] = []
  let windowFailures = 0
  for (let i = HISTORY_POINTS - 1; i >= 0; i -= 1) {
    const sample = sampleJourney(site, kind, seed, tick - i)
    history.push(sample.totalMs)
    if (sample.failed) windowFailures += 1
  }

  const totalMs = steps.reduce((sum, step) => sum + step.ms, 0)
  const error = failed
    ? `${template.label} failed at ${PHASES[failIndex]!.label}`
    : null
  return {
    id: journeyId(site, kind),
    kind,
    site,
    label: template.label,
    steps,
    totalMs,
    apdex: apdexFor(totalMs),
    availabilityPct: ((HISTORY_POINTS - windowFailures) / HISTORY_POINTS) * 100,
    status: statusFor(totalMs, failed),
    error,
    history,
  }
}

/** Run every journey kind for every site at a simulated minute tick. */
export function runFleetJourneys(
  sites: readonly string[],
  seed: number,
  tick: number,
): JourneyResult[] {
  const results: JourneyResult[] = []
  for (const site of sites) {
    for (const kind of JOURNEY_KINDS) {
      results.push(runJourney(site, kind, seed, tick))
    }
  }
  return results
}

const STATUS_RANK: Record<JourneyStatus, number> = {
  healthy: 0,
  degraded: 1,
  failing: 2,
}

/** Roll journeys up per site: average Apdex, latency and worst status. */
export function siteExperience(
  sites: readonly string[],
  journeys: JourneyResult[],
): SiteExperience[] {
  return sites.map((site) => {
    const members = journeys.filter((journey) => journey.site === site)
    const avgApdex =
      members.length === 0
        ? 0
        : members.reduce((sum, journey) => sum + journey.apdex, 0) /
          members.length
    const avgLatencyMs =
      members.length === 0
        ? 0
        : members.reduce((sum, journey) => sum + journey.totalMs, 0) /
          members.length
    const status = members.reduce<JourneyStatus>(
      (worst, journey) =>
        STATUS_RANK[journey.status] > STATUS_RANK[worst]
          ? journey.status
          : worst,
      'healthy',
    )
    return { site, journeys: members, avgApdex, avgLatencyMs, status }
  })
}

/** Fleet-level experience summary: counts, averages and a 0–100 score. */
export function experienceSummary(
  journeys: JourneyResult[],
): ExperienceSummary {
  if (journeys.length === 0) {
    return {
      total: 0,
      healthy: 0,
      degraded: 0,
      failing: 0,
      avgApdex: 0,
      avgLatencyMs: 0,
      availabilityPct: 0,
      score: 0,
    }
  }
  let healthy = 0
  let degraded = 0
  let failing = 0
  let apdexSum = 0
  let latencySum = 0
  let availabilitySum = 0
  for (const journey of journeys) {
    if (journey.status === 'healthy') healthy += 1
    else if (journey.status === 'degraded') degraded += 1
    else failing += 1
    apdexSum += journey.apdex
    latencySum += journey.totalMs
    availabilitySum += journey.availabilityPct
  }
  const n = journeys.length
  const avgApdex = apdexSum / n
  const availabilityPct = availabilitySum / n
  const score = Math.round(
    Math.min(
      100,
      Math.max(0, 100 * (0.55 * avgApdex + 0.45 * (availabilityPct / 100))),
    ),
  )
  return {
    total: n,
    healthy,
    degraded,
    failing,
    avgApdex,
    avgLatencyMs: latencySum / n,
    availabilityPct,
    score,
  }
}
