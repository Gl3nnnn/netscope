import { useMemo } from 'react'
import { Radar, Target, TriangleAlert, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { overallHealth } from '@/lib/aggregate'
import { evaluateCompliance } from '@/lib/compliance'
import { resolveConfig } from '@/lib/configs'
import { buildFlows } from '@/lib/flow'
import { environmentScore } from '@/lib/environment'
import { qosSummary } from '@/lib/qos'
import {
  computeMaturity,
  DOMAINS,
  LEVEL_LABELS,
  type Effort,
  type MaturityLevel,
} from '@/lib/maturity'
import { nacSummary, generateEndpoints } from '@/lib/nac'
import {
  buildBgpSessions,
  buildOspfAdjacencies,
  buildRoutingTables,
  detectRoutingIssues,
  routingSummary,
} from '@/lib/routing'
import { resilienceScore } from '@/lib/resilience'
import { securityScore } from '@/lib/security'
import { buildCircuits, wanFindings, wanSummary } from '@/lib/wan'
import { SITES } from '@/simulation/seed'
import { useComplianceStore } from '@/store/useComplianceStore'
import { useConfigsStore } from '@/store/useConfigsStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import { usePolicyStore } from '@/store/usePolicyStore'
import { useSecurityStore } from '@/store/useSecurityStore'
import { useServicesStore } from '@/store/useServicesStore'
import { useSettingsStore } from '@/store/useSettingsStore'

const LEVEL_VARIANT: Record<
  MaturityLevel,
  'destructive' | 'warning' | 'secondary' | 'default'
> = {
  1: 'destructive',
  2: 'warning',
  3: 'secondary',
  4: 'secondary',
  5: 'default',
}

const EFFORT_VARIANT: Record<Effort, 'destructive' | 'warning' | 'secondary'> =
  {
    low: 'secondary',
    medium: 'warning',
    high: 'destructive',
  }

const scoreTone = (score: number) =>
  score >= 75
    ? 'text-success'
    : score >= 40
      ? 'text-warning'
      : 'text-destructive'

const barTone = (score: number) =>
  score >= 75 ? 'bg-success' : score >= 40 ? 'bg-warning' : 'bg-destructive'

const RADAR_CENTER = 150
const RADAR_RADIUS = 110
const AXIS_COUNT = DOMAINS.length

const radarPoint = (index: number, fraction: number) => {
  const angle = ((-90 + index * (360 / AXIS_COUNT)) * Math.PI) / 180
  return {
    x: RADAR_CENTER + Math.cos(angle) * RADAR_RADIUS * fraction,
    y: RADAR_CENTER + Math.sin(angle) * RADAR_RADIUS * fraction,
  }
}

const ringPoints = (fraction: number) =>
  Array.from({ length: AXIS_COUNT }, (_, index) => {
    const point = radarPoint(index, fraction)
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
  }).join(' ')

export function MaturityPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)
  const incidents = useNetworkStore((state) => state.incidents)
  const thresholds = useSettingsStore((state) => state.thresholds)
  const services = useServicesStore((state) => state.services)
  const events = useSecurityStore((state) => state.events)
  const overrides = useConfigsStore((state) => state.overrides)
  const policyRules = usePolicyStore((state) => state.rules)
  const waivers = useComplianceStore((state) => state.waivers)

  const result = useMemo(() => {
    if (devices.length === 0) return null

    const bgp = buildBgpSessions(devices, seed)
    const ospf = buildOspfAdjacencies(devices)
    const tables = buildRoutingTables(devices, ospf, bgp, seed)
    const routingIssues = detectRoutingIssues(bgp, ospf, tables, devices, seed)
    const circuits = buildCircuits(devices, {}, seed)
    const flows = buildFlows(devices, seed)
    const compliance = evaluateCompliance({
      devices,
      configFor: (device) => resolveConfig(overrides, device).current,
      policyRules,
      waivers: new Set(waivers),
    })

    return computeMaturity({
      health: overallHealth(devices, thresholds),
      routing: routingSummary(tables, bgp, ospf, routingIssues).health,
      wan: wanSummary(circuits, wanFindings(devices, circuits)).score,
      resilience: resilienceScore({ devices, services, incidents, thresholds }),
      security: securityScore(events).score,
      qos: qosSummary(flows).score,
      environment: environmentScore(devices).score,
      compliance: compliance.score,
    })
  }, [
    devices,
    seed,
    thresholds,
    services,
    incidents,
    events,
    overrides,
    policyRules,
    waivers,
  ])

  const nac = useMemo(
    () =>
      devices.length === 0
        ? null
        : nacSummary(generateEndpoints(devices, SITES, seed)),
    [devices, seed],
  )

  if (devices.length === 0 || !result) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Maturity Scorecard"
          description="CMM-style rollup across eight operational domains."
        />
        <EmptyState
          icon={Target}
          title="Nothing to assess"
          description="Seed the fleet to build the maturity scorecard."
        />
      </div>
    )
  }

  const { index, level, levelLabel, domains, gaps, roadmap } = result
  const weakest = gaps[0]
  const radarScores = domains.map((domain) => domain.score / 100)
  const scorePolygon = radarScores
    .map((fraction, index_) => {
      const point = radarPoint(index_, fraction)
      return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Maturity Scorecard"
        description="Rolls fleet health, routing, WAN, resilience, security, QoS, environment and compliance scores into one weighted CMM index (1 Initial → 5 Optimizing), with gap analysis and a prioritised improvement roadmap."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Maturity index"
          value={`${index.toFixed(1)}`}
          icon={Radar}
          accent="text-primary"
          hint={`weighted across ${domains.length} domains`}
        />
        <StatCard
          label="CMM level"
          value={`${level} · ${levelLabel}`}
          icon={Target}
          accent={
            level >= 4
              ? 'text-success'
              : level >= 3
                ? 'text-warning'
                : 'text-destructive'
          }
          hint="1 Initial → 5 Optimizing"
        />
        <StatCard
          label="Weakest domain"
          value={weakest ? `${weakest.score.toFixed(0)}` : '—'}
          icon={TriangleAlert}
          accent="text-destructive"
          hint={weakest ? weakest.label : ''}
        />
        <StatCard
          label="Roadmap actions"
          value={`${roadmap.length}`}
          icon={Wrench}
          accent="text-accent"
          hint={
            roadmap.length > 0 ? 'gap-closing items ranked' : 'no gaps to close'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Domain radar</CardTitle>
          </CardHeader>
          <CardContent>
            <svg
              viewBox="0 0 300 300"
              role="img"
              aria-label="Maturity radar chart across eight domains"
              className="mx-auto h-72 w-full max-w-md"
            >
              {[0.25, 0.5, 0.75, 1].map((fraction) => (
                <polygon
                  key={fraction}
                  points={ringPoints(fraction)}
                  fill="none"
                  stroke="currentColor"
                  className="text-border"
                  strokeWidth={fraction === 1 ? 1.5 : 1}
                  strokeDasharray={fraction === 1 ? undefined : '3 3'}
                />
              ))}
              {DOMAINS.map((meta, index_) => {
                const edge = radarPoint(index_, 1)
                return (
                  <line
                    key={meta.id}
                    x1={RADAR_CENTER}
                    y1={RADAR_CENTER}
                    x2={edge.x}
                    y2={edge.y}
                    stroke="currentColor"
                    className="text-border"
                    strokeWidth={1}
                  />
                )
              })}
              <polygon
                points={scorePolygon}
                className="fill-primary/20 stroke-primary"
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {radarScores.map((fraction, index_) => {
                const point = radarPoint(index_, fraction)
                return (
                  <circle
                    key={DOMAINS[index_]!.id}
                    cx={point.x}
                    cy={point.y}
                    r={3}
                    className="fill-primary"
                  />
                )
              })}
              {DOMAINS.map((meta, index_) => {
                const labelPoint = radarPoint(index_, 1.22)
                return (
                  <text
                    key={meta.id}
                    x={labelPoint.x}
                    y={labelPoint.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-muted-foreground"
                    fontSize={11}
                  >
                    {meta.short}
                  </text>
                )
              })}
            </svg>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Level ladder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {([1, 2, 3, 4, 5] as const).map((ladderLevel) => {
              const current = ladderLevel === level
              return (
                <div
                  key={ladderLevel}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                    current ? 'border-primary bg-primary/5' : ''
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={LEVEL_VARIANT[ladderLevel]}>
                      {ladderLevel}
                    </Badge>
                    <span
                      className={`text-sm ${current ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                    >
                      {LEVEL_LABELS[ladderLevel]}
                    </span>
                  </div>
                  {current && (
                    <span className="text-xs font-medium text-primary">
                      current
                    </span>
                  )}
                </div>
              )
            })}
            {nac && (
              <p className="text-xs text-muted-foreground">
                NAC posture (informational): {nac.compliancePct.toFixed(0)}%
                compliant across {nac.endpoints} endpoints.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Domain scores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {domains.map((domain) => (
            <div key={domain.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{domain.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {domain.description}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    weight {domain.weight}
                  </span>
                  <Badge variant={LEVEL_VARIANT[domain.level]}>
                    L{domain.level} {LEVEL_LABELS[domain.level]}
                  </Badge>
                  <span
                    className={`w-10 text-right text-sm font-semibold tabular-nums ${scoreTone(domain.score)}`}
                  >
                    {domain.score.toFixed(0)}
                  </span>
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${barTone(domain.score)}`}
                  style={{ width: `${domain.score}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Improvement roadmap</CardTitle>
        </CardHeader>
        <CardContent>
          {roadmap.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every domain is at full score — nothing to improve.
            </p>
          ) : (
            <div className="space-y-3">
              {roadmap.map((item) => (
                <div key={item.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      <Badge variant="secondary">{item.domainLabel}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={EFFORT_VARIANT[item.effort]}>
                        {item.effort} effort
                      </Badge>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        +{item.impact} pts · priority {item.priority.toFixed(1)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.action}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
