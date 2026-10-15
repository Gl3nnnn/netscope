import { useMemo } from 'react'
import { Activity, CircleAlert, Gauge, Globe, TimerReset } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { Sparkline } from '@/components/charts/Sparkline'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMs, formatPct } from '@/lib/format'
import {
  HISTORY_POINTS,
  experienceSummary,
  runFleetJourneys,
  siteExperience,
  type JourneyResult,
  type JourneyStatus,
} from '@/lib/experience'
import { SITES } from '@/simulation/seed'
import { useNetworkStore } from '@/store/useNetworkStore'

const PHASE_STYLES: Record<string, { label: string; bar: string }> = {
  dns: { label: 'DNS', bar: 'bg-info' },
  tcp: { label: 'TCP', bar: 'bg-primary' },
  tls: { label: 'TLS', bar: 'bg-warning' },
  http: { label: 'HTTP', bar: 'bg-success' },
}

const STATUS_META: Record<
  JourneyStatus,
  { label: string; variant: 'success' | 'warning' | 'destructive' }
> = {
  healthy: { label: 'Healthy', variant: 'success' },
  degraded: { label: 'Degraded', variant: 'warning' },
  failing: { label: 'Failing', variant: 'destructive' },
}

function siteHistory(members: JourneyResult[]): number[] {
  if (members.length === 0) return []
  return Array.from(
    { length: HISTORY_POINTS },
    (_, index) =>
      members.reduce((sum, journey) => sum + (journey.history[index] ?? 0), 0) /
      members.length,
  )
}

export function ExperiencePage() {
  const seed = useNetworkStore((state) => state.seed)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const minute = Math.floor(lastTick / 60_000)

  const journeys = useMemo(
    () => runFleetJourneys(SITES, seed, minute),
    [seed, minute],
  )
  const summary = useMemo(() => experienceSummary(journeys), [journeys])
  const sites = useMemo(() => siteExperience(SITES, journeys), [journeys])

  const worstSite = useMemo(() => {
    let worst = sites[0]
    for (const site of sites) {
      if (site.avgLatencyMs > (worst?.avgLatencyMs ?? 0)) worst = site
    }
    return worst
  }, [sites])

  const failing = useMemo(
    () => journeys.filter((journey) => journey.error !== null),
    [journeys],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Digital Experience"
        description="Simulated synthetic journeys from every site: VPN, mail, checkout, payments and DNS checks with per-phase waterfalls, Apdex scoring (T = 300 ms), availability over the last 30 minutes and failing-check detail."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Experience score"
          value={`${summary.score}`}
          icon={Gauge}
          accent={
            summary.score >= 85
              ? 'text-success'
              : summary.score >= 65
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.healthy} of ${summary.total} journeys healthy`}
        />
        <StatCard
          label="Avg Apdex"
          value={formatPct(summary.avgApdex, 2)}
          icon={Activity}
          accent={
            summary.avgApdex >= 0.94
              ? 'text-success'
              : summary.avgApdex >= 0.85
                ? 'text-warning'
                : 'text-destructive'
          }
          hint="satisfied ≤ 300 ms"
        />
        <StatCard
          label="Avg total"
          value={formatMs(summary.avgLatencyMs)}
          icon={TimerReset}
          accent="text-info"
          hint={
            worstSite
              ? `worst site: ${worstSite.site} (${formatMs(worstSite.avgLatencyMs)})`
              : '—'
          }
        />
        <StatCard
          label="Availability"
          value={formatPct(summary.availabilityPct, 2)}
          icon={Globe}
          accent={
            summary.availabilityPct >= 99.5
              ? 'text-success'
              : summary.availabilityPct >= 97
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.failing} journeys failing now`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-primary" />
            Site experience
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Per-site rollup across all journey kinds · 30-minute latency trend.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <div
              key={site.site}
              className="space-y-2 rounded-lg border border-border/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {site.site}
                </span>
                <Badge
                  variant={STATUS_META[site.status].variant}
                  className="text-[10px]"
                >
                  {STATUS_META[site.status].label}
                </Badge>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <div>
                    Apdex{' '}
                    <span className="tabular-nums text-foreground">
                      {formatPct(site.avgApdex, 2)}
                    </span>
                  </div>
                  <div>
                    Avg{' '}
                    <span className="tabular-nums text-foreground">
                      {formatMs(site.avgLatencyMs)}
                    </span>
                  </div>
                </div>
                <Sparkline
                  data={siteHistory(site.journeys)}
                  label={`${site.site} latency trend`}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {failing.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <CircleAlert className="size-4" />
              Failing checks ({failing.length})
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Failed on the current simulated minute · counted against
              availability.
            </p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {failing.slice(0, 8).map((journey) => (
              <div
                key={journey.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="font-medium">{journey.site}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">
                    {journey.label}
                  </Badge>
                  {journey.error}
                </span>
              </div>
            ))}
            {failing.length > 8 ? (
              <p className="text-[11px] text-muted-foreground">
                +{failing.length - 8} more
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-primary" />
            Journey detail
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {Object.entries(PHASE_STYLES).map(([key, phase]) => (
              <span key={key} className="flex items-center gap-1">
                <span
                  className={`inline-block size-2 rounded-full ${phase.bar}`}
                />
                {phase.label}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Journey
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Site
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Phase mix
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Total
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Apdex
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Avail.
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {journeys.map((journey) => (
                <tr key={journey.id} className="border-t border-border/50">
                  <td className="p-2">
                    <span className="block font-medium">{journey.label}</span>
                    {journey.error ? (
                      <span className="block text-[11px] text-destructive">
                        {journey.error}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {journey.site}
                  </td>
                  <td className="min-w-44 p-2">
                    <span className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                      {journey.steps.map((step) => (
                        <span
                          key={step.key}
                          className={PHASE_STYLES[step.key]?.bar}
                          style={{
                            width: `${Math.round((step.ms / journey.totalMs) * 100)}%`,
                          }}
                          title={`${step.label}: ${formatMs(step.ms)}`}
                        />
                      ))}
                    </span>
                    <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">
                      {journey.steps
                        .map((step) => `${step.label} ${formatMs(step.ms)}`)
                        .join(' · ')}
                    </span>
                  </td>
                  <td
                    className={`p-2 text-right text-xs tabular-nums ${
                      journey.status === 'failing'
                        ? 'text-destructive'
                        : journey.status === 'degraded'
                          ? 'text-warning'
                          : 'text-foreground'
                    }`}
                  >
                    {formatMs(journey.totalMs)}
                  </td>
                  <td className="p-2 text-right text-xs tabular-nums">
                    {journey.apdex.toFixed(2)}
                  </td>
                  <td className="p-2 text-right text-xs tabular-nums">
                    {formatPct(journey.availabilityPct, 1)}
                  </td>
                  <td className="p-2 text-right">
                    <Badge
                      variant={STATUS_META[journey.status].variant}
                      className="text-[10px]"
                    >
                      {STATUS_META[journey.status].label}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
