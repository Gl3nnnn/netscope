/**
 * WAN / carrier engine.
 *
 * Simulated wide-area circuits (DIA, MPLS, broadband, LTE backup) per site
 * with carrier assignment, contracted vs measured availability, cost per
 * Mbps, redundancy posture and a carrier scorecard.
 *
 * Pure and dependency-free. The page feeds in per-site measured uptime from
 * `@/lib/sla` so WAN numbers correlate with the rest of the fleet.
 */
import type { Device, Severity } from '@/types'
import { clamp, clamp01, formatPct, round } from '@/lib/format'
import { hashSeed } from '@/simulation/random'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type CircuitKind = 'dia' | 'mpls' | 'broadband' | 'lte'

export type CircuitRole = 'primary' | 'backup'

export type CircuitStatus = 'up' | 'degraded' | 'down'

export interface Circuit {
  id: string
  site: string
  kind: CircuitKind
  carrier: string
  role: CircuitRole
  bandwidthMbps: number
  monthlyCostUsd: number
  /** Contracted availability (%). */
  contractedUptimePct: number
  /** Carrier-measured availability (%). */
  measuredUptimePct: number
  latencyMs: number
  jitterMs: number
  lossPct: number
  status: CircuitStatus
}

export interface CarrierScorecard {
  carrier: string
  circuits: number
  bandwidthMbps: number
  monthlyCostUsd: number
  costPerMbps: number
  avgLatencyMs: number
  /** Bandwidth-weighted measured availability. */
  measuredUptimePct: number
  breaches: number
  /** Open carrier tickets, seeded per circuit. */
  tickets: number
  /** 0-100 blend of reliability, latency and cost efficiency. */
  score: number
}

export type WanFindingKind =
  | 'sla-breach'
  | 'single-homed'
  | 'backup-degraded'
  | 'capacity'
  | 'cost-inefficient'

export interface WanFinding {
  id: string
  kind: WanFindingKind
  severity: Severity
  site: string
  circuitId: string | null
  message: string
}

export interface WanSummary {
  circuits: number
  sites: number
  sitesWithBackup: number
  /** Percentage of sites with a diverse backup path. */
  redundancyPct: number
  totalBandwidthMbps: number
  primaryBandwidthMbps: number
  monthlyCostUsd: number
  costPerMbps: number
  breaches: number
  downCircuits: number
  findings: number
  score: number
  grade: 'healthy' | 'degraded' | 'critical'
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const CIRCUIT_KIND_LABELS: Record<CircuitKind, string> = {
  dia: 'Dedicated Internet (DIA)',
  mpls: 'MPLS L3VPN',
  broadband: 'Business Broadband',
  lte: 'LTE / 5G Backup',
}

/** Contracted availability per circuit type (%). */
export const CIRCUIT_KIND_SLA: Record<CircuitKind, number> = {
  dia: 99.9,
  mpls: 99.95,
  broadband: 99.5,
  lte: 98.5,
}

/** Carriers in the simulated market. */
export const CARRIERS = [
  'Lumen',
  'Zayo',
  'Verizon Business',
  'Comcast Business',
] as const

/** Blended price per Mbps per circuit type. */
const COST_PER_MBPS: Record<CircuitKind, number> = {
  dia: 6.5,
  mpls: 9,
  broadband: 2.5,
  lte: 14,
}

const BASE_COST: Record<CircuitKind, number> = {
  dia: 400,
  mpls: 650,
  broadband: 120,
  lte: 90,
}

/** Baseline one-way latency per circuit type. */
const KIND_LATENCY: Record<CircuitKind, number> = {
  dia: 12,
  mpls: 16,
  broadband: 28,
  lte: 45,
}

const KIND_JITTER: Record<CircuitKind, number> = {
  dia: 2,
  mpls: 3,
  broadband: 8,
  lte: 15,
}

const KIND_LOSS: Record<CircuitKind, number> = {
  dia: 0.02,
  mpls: 0.04,
  broadband: 0.3,
  lte: 1.2,
}

/** Utilisation above which a site's primary link is called congested. */
export const CAPACITY_THRESHOLD = 0.85

// ---------------------------------------------------------------------------
// Availability maths
// ---------------------------------------------------------------------------

/**
 * Carrier-measured availability for one circuit: the contract nudged by a
 * deterministic jitter plus a small correlation with the site's own uptime
 * (a struggling site tends to have struggling circuits).
 */
export function measuredUptime(
  contractPct: number,
  siteUptimePct: number,
  key: string,
): number {
  const h = hashSeed(key)
  const jitter = ((h % 121) - 20) / 1000 // -0.020 .. +0.100 pp
  const siteNudge = (siteUptimePct - 99.75) * 0.15 // ~ ±0.05 pp
  return round(clamp(contractPct + jitter + siteNudge, 90, 100), 3)
}

/** Cost per Mbps for a circuit (monthly). */
export function costPerMbps(
  circuit: Pick<Circuit, 'monthlyCostUsd' | 'bandwidthMbps'>,
): number {
  if (circuit.bandwidthMbps <= 0) return 0
  return round(circuit.monthlyCostUsd / circuit.bandwidthMbps, 2)
}

/** Total demand at a site (sum of device throughput, with a 20% WAN factor). */
export function siteDemand(devices: Device[], site: string): number {
  const total = devices
    .filter((device) => device.site === site)
    .reduce((sum, device) => sum + device.throughputMbps, 0)
  return round(total * 1.2, 1)
}

/** Unique sorted sites in the fleet. */
export function wanSites(devices: Device[]): string[] {
  return [...new Set(devices.map((device) => device.site))].sort()
}

// ---------------------------------------------------------------------------
// Circuit generation
// ---------------------------------------------------------------------------

interface Plan {
  kind: CircuitKind
  bandwidthMbps: number
}

function planPrimary(site: string, h: number): Plan {
  const branch = /branch/i.test(site)
  const kind: CircuitKind = branch
    ? h % 2 === 0
      ? 'mpls'
      : 'dia'
    : h % 3 === 0
      ? 'mpls'
      : 'dia'
  const bandwidthMbps = branch
    ? 100 * (1 + (h % 4)) // 100..400
    : h % 3 === 0
      ? 5000
      : 2000
  return { kind, bandwidthMbps }
}

function planBackup(site: string, h: number): Plan {
  const branch = /branch/i.test(site)
  const kind: CircuitKind = branch && h % 3 === 0 ? 'lte' : 'broadband'
  const bandwidthMbps = branch ? 50 * (1 + (h % 3)) : 500
  return { kind, bandwidthMbps }
}

function buildCircuit(
  site: string,
  plan: Plan,
  role: CircuitRole,
  carrier: string,
  siteUptimePct: number,
  key: string,
): Circuit {
  const h = hashSeed(key)
  const kind = plan.kind
  const bandwidthMbps = plan.bandwidthMbps
  const contracted = CIRCUIT_KIND_SLA[kind]
  const status: CircuitStatus =
    role === 'primary'
      ? h % 13 === 0
        ? 'degraded'
        : 'up'
      : h % 29 === 0
        ? 'down'
        : h % 11 === 0
          ? 'degraded'
          : 'up'

  return {
    id: `ckt-${site.replace(/[^A-Za-z0-9]/g, '')}-${role}-${kind}`,
    site,
    kind,
    carrier,
    role,
    bandwidthMbps,
    monthlyCostUsd: Math.round(
      bandwidthMbps * COST_PER_MBPS[kind] + BASE_COST[kind],
    ),
    contractedUptimePct: contracted,
    measuredUptimePct: measuredUptime(contracted, siteUptimePct, `meas:${key}`),
    latencyMs: KIND_LATENCY[kind] + (h % 7),
    jitterMs: KIND_JITTER[kind] + (h % 3),
    lossPct: round(KIND_LOSS[kind] * (1 + (h % 5) / 10), 2),
    status,
  }
}

/**
 * Build every WAN circuit for the fleet.
 *
 * Each site gets a primary (DIA or MPLS) and, for most sites, a diverse
 * backup (broadband or LTE). Carrier choice is seeded per site and the
 * backup never rides the same carrier as the primary.
 */
export function buildCircuits(
  devices: Device[],
  siteUptimes: Record<string, number> = {},
  seed = 0,
): Circuit[] {
  const circuits: Circuit[] = []

  for (const site of wanSites(devices)) {
    const h = hashSeed(`wan:${site}:${seed}`)
    const siteUptime = siteUptimes[site] ?? 99.75

    const primary = planPrimary(site, h)
    const carrierIndex = h % CARRIERS.length
    const backupIndex = (carrierIndex + 1 + ((h >> 3) % 3)) % CARRIERS.length

    circuits.push(
      buildCircuit(
        site,
        primary,
        'primary',
        CARRIERS[carrierIndex]!,
        siteUptime,
        `${site}:${seed}`,
      ),
    )

    // 80% of sites have a diverse backup path.
    if (h % 5 !== 0) {
      circuits.push(
        buildCircuit(
          site,
          planBackup(site, h),
          'backup',
          CARRIERS[backupIndex]!,
          siteUptime,
          `${site}:backup:${seed}`,
        ),
      )
    }
  }

  return circuits
}

// ---------------------------------------------------------------------------
// Carrier scorecard
// ---------------------------------------------------------------------------

/** Simulated open tickets per circuit, seeded. */
function ticketsFor(circuit: Circuit): number {
  return hashSeed(`tickets:${circuit.id}`) % 4
}

export function carrierScorecards(circuits: Circuit[]): CarrierScorecard[] {
  const byCarrier = new Map<string, Circuit[]>()
  for (const circuit of circuits) {
    const list = byCarrier.get(circuit.carrier) ?? []
    list.push(circuit)
    byCarrier.set(circuit.carrier, list)
  }

  const cards: CarrierScorecard[] = []
  for (const [carrier, list] of byCarrier) {
    const bandwidth = list.reduce((sum, c) => sum + c.bandwidthMbps, 0)
    const monthly = list.reduce((sum, c) => sum + c.monthlyCostUsd, 0)
    const measured =
      bandwidth > 0
        ? list.reduce(
            (sum, c) => sum + c.measuredUptimePct * c.bandwidthMbps,
            0,
          ) / bandwidth
        : 0
    const avgLatency =
      list.reduce((sum, c) => sum + c.latencyMs, 0) / list.length
    const breaches = list.filter(
      (c) => c.measuredUptimePct < c.contractedUptimePct,
    ).length

    const reliability = clamp01((measured - 98.5) / 1.5)
    const latencyScore = clamp01(1 - (avgLatency - 10) / 40)
    const cpm = bandwidth > 0 ? monthly / bandwidth : 0
    const costScore = clamp01(1 - (cpm - 2) / 12)

    cards.push({
      carrier,
      circuits: list.length,
      bandwidthMbps: bandwidth,
      monthlyCostUsd: monthly,
      costPerMbps: round(cpm, 2),
      avgLatencyMs: round(avgLatency, 1),
      measuredUptimePct: round(measured, 3),
      breaches,
      tickets: list.reduce((sum, c) => sum + ticketsFor(c), 0),
      score: Math.round(
        (reliability * 0.55 + latencyScore * 0.25 + costScore * 0.2) * 100,
      ),
    })
  }

  return cards.sort(
    (a, b) => b.score - a.score || a.carrier.localeCompare(b.carrier),
  )
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function wanFindings(
  devices: Device[],
  circuits: Circuit[],
): WanFinding[] {
  const findings: WanFinding[] = []
  const sites = wanSites(devices)

  for (const site of sites) {
    const siteCircuits = circuits.filter((c) => c.site === site)
    const primary = siteCircuits.find((c) => c.role === 'primary')
    const backup = siteCircuits.find((c) => c.role === 'backup')

    if (siteCircuits.length <= 1) {
      findings.push({
        id: `wan-single-${site.replace(/[^A-Za-z0-9]/g, '')}`,
        kind: 'single-homed',
        severity: 'high',
        site,
        circuitId: primary?.id ?? null,
        message: `${site} is single-homed — no diverse WAN path if the primary fails.`,
      })
    }

    if (backup && backup.status !== 'up') {
      findings.push({
        id: `wan-backup-${site.replace(/[^A-Za-z0-9]/g, '')}`,
        kind: 'backup-degraded',
        severity: backup.status === 'down' ? 'high' : 'medium',
        site,
        circuitId: backup.id,
        message: `${site} backup (${CIRCUIT_KIND_LABELS[backup.kind]}) is ${backup.status}.`,
      })
    }

    if (primary) {
      const demand = siteDemand(devices, site)
      const util = demand / primary.bandwidthMbps
      if (util >= CAPACITY_THRESHOLD) {
        findings.push({
          id: `wan-capacity-${site.replace(/[^A-Za-z0-9]/g, '')}`,
          kind: 'capacity',
          severity: util >= 1 ? 'high' : 'medium',
          site,
          circuitId: primary.id,
          message: `${site} primary runs at ${formatPct(util * 100, 0)} of ${primary.bandwidthMbps} Mbps against ${demand} Mbps of demand.`,
        })
      }
      if (costPerMbps(primary) > 12) {
        findings.push({
          id: `wan-cost-${site.replace(/[^A-Za-z0-9]/g, '')}`,
          kind: 'cost-inefficient',
          severity: 'low',
          site,
          circuitId: primary.id,
          message: `${site} primary costs $${costPerMbps(primary)}/Mbps — well above market.`,
        })
      }
    }
  }

  for (const circuit of circuits) {
    if (circuit.measuredUptimePct >= circuit.contractedUptimePct) continue
    const gap = round(
      circuit.contractedUptimePct - circuit.measuredUptimePct,
      3,
    )
    findings.push({
      id: `wan-sla-${circuit.id}`,
      kind: 'sla-breach',
      severity: gap >= 0.1 ? 'high' : 'medium',
      site: circuit.site,
      circuitId: circuit.id,
      message: `${circuit.site} ${CIRCUIT_KIND_LABELS[circuit.kind]} (${circuit.carrier}) measured ${circuit.measuredUptimePct}% vs ${circuit.contractedUptimePct}% contracted (−${gap} pp).`,
    })
  }

  return findings.sort((a, b) => {
    const diff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (diff !== 0) return diff
    return a.id.localeCompare(b.id)
  })
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function wanSummary(
  circuits: Circuit[],
  findings: WanFinding[],
): WanSummary {
  const sites = new Set(circuits.map((c) => c.site))
  const sitesWithBackup = new Set(
    circuits.filter((c) => c.role === 'backup').map((c) => c.site),
  ).size
  const primary = circuits.filter((c) => c.role === 'primary')
  const totalBandwidth = circuits.reduce((sum, c) => sum + c.bandwidthMbps, 0)
  const monthly = circuits.reduce((sum, c) => sum + c.monthlyCostUsd, 0)
  const breaches = circuits.filter(
    (c) => c.measuredUptimePct < c.contractedUptimePct,
  ).length
  const down = circuits.filter((c) => c.status === 'down').length

  let score = 100
  score -= findings.filter((f) => f.severity === 'critical').length * 12
  score -= findings.filter((f) => f.severity === 'high').length * 7
  score -= findings.filter((f) => f.severity === 'medium').length * 3
  score -= findings.filter((f) => f.severity === 'low').length * 1
  score = clamp(score, 0, 100)

  return {
    circuits: circuits.length,
    sites: sites.size,
    sitesWithBackup,
    redundancyPct:
      sites.size > 0 ? Math.round((sitesWithBackup / sites.size) * 100) : 0,
    totalBandwidthMbps: totalBandwidth,
    primaryBandwidthMbps: primary.reduce((sum, c) => sum + c.bandwidthMbps, 0),
    monthlyCostUsd: monthly,
    costPerMbps: totalBandwidth > 0 ? round(monthly / totalBandwidth, 2) : 0,
    breaches,
    downCircuits: down,
    findings: findings.length,
    score,
    grade: score >= 85 ? 'healthy' : score >= 60 ? 'degraded' : 'critical',
  }
}

/** Card helper: formatted redundancy label. */
export function formatRedundancy(summary: WanSummary): string {
  return formatPct(summary.redundancyPct, 0)
}
