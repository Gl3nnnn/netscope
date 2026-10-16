/**
 * Network maturity scorecard (CMM-style).
 *
 * Rolls up the *existing* domain scores — fleet health, routing, WAN,
 * resilience, security, QoS, environment, compliance — into weighted maturity
 * levels (1 Initial … 5 Optimizing) with an overall index, gap analysis and a
 * prioritised improvement roadmap. Pure aggregation: no re-grading of domains,
 * so it stays honest about where the numbers come from.
 */

export type DomainId =
  | 'health'
  | 'routing'
  | 'wan'
  | 'resilience'
  | 'security'
  | 'qos'
  | 'environment'
  | 'compliance'

export type MaturityLevel = 1 | 2 | 3 | 4 | 5

export const LEVEL_LABELS: Record<MaturityLevel, string> = {
  1: 'Initial',
  2: 'Managed',
  3: 'Defined',
  4: 'Quantitatively Managed',
  5: 'Optimizing',
}

export interface DomainMeta {
  id: DomainId
  label: string
  /** Abbreviated label for radar axes. */
  short: string
  description: string
  /** Contribution to the index; sums to 100. */
  weight: number
}

export const DOMAINS: DomainMeta[] = [
  {
    id: 'health',
    label: 'Fleet Health',
    short: 'Fleet',
    description: 'Latency, loss, availability & saturation',
    weight: 15,
  },
  {
    id: 'routing',
    label: 'Routing',
    short: 'Routing',
    description: 'BGP/OSPF convergence & route hygiene',
    weight: 10,
  },
  {
    id: 'wan',
    label: 'WAN & Carriers',
    short: 'WAN',
    description: 'Circuit redundancy, SLAs & cost efficiency',
    weight: 12,
  },
  {
    id: 'resilience',
    label: 'Resilience',
    short: 'Resilience',
    description: 'SPOF exposure & failover readiness',
    weight: 15,
  },
  {
    id: 'security',
    label: 'Security',
    short: 'Security',
    description: 'Open detections & ATT&CK containment',
    weight: 15,
  },
  {
    id: 'qos',
    label: 'Quality of Service',
    short: 'QoS',
    description: 'Class protection & tail-drop control',
    weight: 10,
  },
  {
    id: 'environment',
    label: 'Environment',
    short: 'Environment',
    description: 'Power efficiency & load balance',
    weight: 8,
  },
  {
    id: 'compliance',
    label: 'Compliance',
    short: 'Compliance',
    description: 'Hardening rule adherence',
    weight: 15,
  },
]

export interface DomainScore {
  id: DomainId
  label: string
  description: string
  /** Raw domain score, 0–100 (as produced by the owning engine). */
  score: number
  level: MaturityLevel
  weight: number
}

export type Effort = 'low' | 'medium' | 'high'

export interface RoadmapItem {
  id: string
  domainId: DomainId
  domainLabel: string
  title: string
  action: string
  /** Domain points recoverable if closed (headroom). */
  impact: number
  effort: Effort
  /** impact ÷ effort factor, 1 decimal. */
  priority: number
}

export interface MaturityResult {
  /** Weighted index, 0–100. */
  index: number
  level: MaturityLevel
  levelLabel: string
  domains: DomainScore[]
  /** Three weakest domains, lowest score first. */
  gaps: DomainScore[]
  /** Gap-closing actions, highest priority first. */
  roadmap: RoadmapItem[]
}

/** Score → CMM level thresholds. */
export function maturityLevel(score: number): MaturityLevel {
  if (score >= 90) return 5
  if (score >= 75) return 4
  if (score >= 60) return 3
  if (score >= 40) return 2
  return 1
}

const EFFORT_FACTOR: Record<Effort, number> = {
  low: 1,
  medium: 1.75,
  high: 3,
}

const ROADMAP_TEMPLATES: Record<
  DomainId,
  { title: string; action: string; effort: Effort }
> = {
  health: {
    title: 'Stabilise fleet health',
    action:
      'Drain and remediate the worst latency/loss devices; investigate saturation.',
    effort: 'medium',
  },
  routing: {
    title: 'Converge the control plane',
    action:
      'Repair flapping sessions and blackhole routes flagged by the routing engine.',
    effort: 'medium',
  },
  wan: {
    title: 'Right-size the carrier estate',
    action:
      'Downsize idle bandwidth and add diverse backups at single-homed sites.',
    effort: 'medium',
  },
  resilience: {
    title: 'Remove single points of failure',
    action: 'Add standby paths for P1 services and rehearse failover windows.',
    effort: 'high',
  },
  security: {
    title: 'Close open detections',
    action: 'Triage open SOC events, patch critical CVEs and enforce 802.1X.',
    effort: 'medium',
  },
  qos: {
    title: 'Protect critical classes',
    action:
      'Reshape queues to stop realtime starvation and tail-drop on bulk links.',
    effort: 'low',
  },
  environment: {
    title: 'Balance facility load',
    action: 'Shift load into the 30–70% efficiency band to cut idle waste.',
    effort: 'low',
  },
  compliance: {
    title: 'Close compliance gaps',
    action: 'Remediate failing hardening rules or file time-boxed waivers.',
    effort: 'low',
  },
}

const clampScore = (value: number) =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Build the scorecard from raw domain scores (0–100 each).
 * Weighted index → overall CMM level, gap analysis, prioritised roadmap.
 */
export function computeMaturity(
  scores: Record<DomainId, number>,
): MaturityResult {
  const domains: DomainScore[] = DOMAINS.map((meta) => {
    const score = clampScore(scores[meta.id] ?? 0)
    return {
      id: meta.id,
      label: meta.label,
      description: meta.description,
      score: round1(score),
      level: maturityLevel(score),
      weight: meta.weight,
    }
  })

  const index = round1(
    domains.reduce(
      (sum, domain) => sum + (domain.score * domain.weight) / 100,
      0,
    ),
  )

  const gaps = [...domains]
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, 3)

  const roadmap: RoadmapItem[] = gaps
    .filter((domain) => domain.score < 100)
    .map((domain) => {
      const template = ROADMAP_TEMPLATES[domain.id]
      const impact = Math.round(100 - domain.score)
      const priority = round1(impact / EFFORT_FACTOR[template.effort])
      return {
        id: `road-${domain.id}`,
        domainId: domain.id,
        domainLabel: domain.label,
        title: template.title,
        action: template.action,
        impact,
        effort: template.effort,
        priority,
      }
    })
    .sort(
      (a, b) => b.priority - a.priority || a.domainId.localeCompare(b.domainId),
    )

  const level = maturityLevel(index)

  return {
    index,
    level,
    levelLabel: LEVEL_LABELS[level],
    domains,
    gaps,
    roadmap,
  }
}
