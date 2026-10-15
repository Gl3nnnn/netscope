import { useMemo } from 'react'
import {
  Activity,
  CircleDollarSign,
  Gauge,
  Network,
  ShieldAlert,
  Waypoints,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct } from '@/lib/format'
import { siteSla } from '@/lib/sla'
import {
  CIRCUIT_KIND_LABELS,
  buildCircuits,
  carrierScorecards,
  wanFindings,
  wanSites,
  wanSummary,
} from '@/lib/wan'
import { useNetworkStore } from '@/store/useNetworkStore'

const ROLE_VARIANT = {
  primary: 'default',
  backup: 'secondary',
} as const

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'destructive'> = {
  up: 'success',
  degraded: 'warning',
  down: 'destructive',
}

const GRADE_ACCENT = {
  healthy: 'text-success',
  degraded: 'text-warning',
  critical: 'text-destructive',
} as const

function slaTone(measured: number, contracted: number): string {
  if (measured < contracted) return 'text-destructive'
  if (measured < contracted + 0.05) return 'text-warning'
  return 'text-success'
}

export function WanPage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const history = useNetworkStore((state) => state.history)
  const seed = useNetworkStore((state) => state.seed)

  const sites = useMemo(() => wanSites(devices), [devices])
  const siteUptimes = useMemo(() => {
    const map: Record<string, number> = {}
    for (const sla of siteSla(devices, incidents, history)) {
      map[sla.site] = sla.uptimePct
    }
    return map
  }, [devices, incidents, history])

  const circuits = useMemo(
    () => buildCircuits(devices, siteUptimes, seed),
    [devices, siteUptimes, seed],
  )
  const cards = useMemo(() => carrierScorecards(circuits), [circuits])
  const findings = useMemo(
    () => wanFindings(devices, circuits),
    [devices, circuits],
  )
  const summary = useMemo(
    () => wanSummary(circuits, findings),
    [circuits, findings],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="WAN & Carriers"
          description="Circuits, carrier scorecards and redundancy posture."
        />
        <EmptyState
          icon={Network}
          title="No fleet to connect"
          description="Seed the fleet to generate WAN circuits."
        />
      </div>
    )
  }

  const money = (value: number) =>
    value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${Math.round(value)}`

  return (
    <div className="space-y-5">
      <PageHeader
        title="WAN & Carriers"
        description="Simulated DIA, MPLS, broadband and LTE circuits with contracted-vs-measured availability, cost per Mbps, redundancy and a carrier scorecard."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Monthly spend"
          value={money(summary.monthlyCostUsd)}
          icon={CircleDollarSign}
          hint={`$${summary.costPerMbps}/Mbps blended`}
        />
        <StatCard
          label="Total capacity"
          value={`${summary.totalBandwidthMbps.toLocaleString()} Mbps`}
          icon={Activity}
          hint={`${summary.primaryBandwidthMbps.toLocaleString()} Mbps primary`}
        />
        <StatCard
          label="Redundancy"
          value={formatPct(summary.redundancyPct, 0)}
          icon={Waypoints}
          accent={
            summary.redundancyPct === 100
              ? 'text-success'
              : summary.redundancyPct >= 60
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.sitesWithBackup}/${summary.sites} sites backed up`}
        />
        <StatCard
          label="WAN health"
          value={`${summary.score}`}
          icon={summary.grade === 'healthy' ? ShieldAlert : Gauge}
          accent={GRADE_ACCENT[summary.grade]}
          hint={`${summary.breaches} SLA breaches · ${summary.downCircuits} down`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4 text-primary" />
            Circuits
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Measured availability blends the carrier's contract with the site's
            own uptime. Red means the contract was missed.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Site
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Type
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Carrier
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Role
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Bandwidth
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Monthly
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  SLA (contract / measured)
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Latency
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {circuits.map((circuit) => (
                <tr key={circuit.id} className="border-t border-border/50">
                  <td className="whitespace-nowrap p-2 font-medium">
                    {circuit.site}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {CIRCUIT_KIND_LABELS[circuit.kind]}
                  </td>
                  <td className="p-2 text-xs">{circuit.carrier}</td>
                  <td className="p-2">
                    <Badge variant={ROLE_VARIANT[circuit.role]}>
                      {circuit.role}
                    </Badge>
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {circuit.bandwidthMbps.toLocaleString()} Mbps
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {money(circuit.monthlyCostUsd)}
                  </td>
                  <td className="p-2 text-right text-xs tabular-nums">
                    <span className="text-muted-foreground">
                      {circuit.contractedUptimePct}%
                    </span>{' '}
                    <span
                      className={slaTone(
                        circuit.measuredUptimePct,
                        circuit.contractedUptimePct,
                      )}
                    >
                      {circuit.measuredUptimePct}%
                    </span>
                  </td>
                  <td className="p-2 text-right text-xs tabular-nums">
                    {circuit.latencyMs} ms · {circuit.jitterMs} ms jitter
                  </td>
                  <td className="p-2 text-right">
                    <Badge variant={STATUS_VARIANT[circuit.status]!}>
                      {circuit.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" />
              Carrier scorecard
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              55% reliability · 25% latency · 20% cost efficiency.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {cards.map((card) => (
              <div key={card.carrier} className="space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{card.carrier}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {card.circuits} circuits · {card.breaches} breached ·{' '}
                    {card.tickets} tickets · ${card.costPerMbps}/Mbps
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${
                        card.score >= 85
                          ? 'bg-success'
                          : card.score >= 60
                            ? 'bg-warning'
                            : 'bg-destructive'
                      }`}
                      style={{ width: `${card.score}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums">
                    {card.score}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {card.bandwidthMbps.toLocaleString()} Mbps ·{' '}
                  {card.avgLatencyMs} ms avg · {card.measuredUptimePct}%
                  measured
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-warning" />
              WAN findings
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {findings.length} across {sites.length} sites · sorted by severity
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every site meets its contracted SLA with diverse paths in place.
              </p>
            ) : (
              findings.slice(0, 12).map((finding) => (
                <div
                  key={finding.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="truncate">{finding.message}</span>
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {finding.kind}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
