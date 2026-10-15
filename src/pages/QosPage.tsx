import { useMemo } from 'react'
import {
  AlertTriangle,
  Layers,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMbps, formatPct } from '@/lib/format'
import { buildFlows } from '@/lib/flow'
import {
  CLASS_META,
  CLASS_ORDER,
  QOS_POLICIES,
  defaultWeights,
  formatUtilisation,
  qosSummary,
  whatIfReshape,
} from '@/lib/qos'
import { useNetworkStore } from '@/store/useNetworkStore'

export function QosPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const flows = useMemo(() => buildFlows(devices, seed), [devices, seed])
  // Capacity defaults to total demand (a fully-loaded link), which is the
  // harshest realistic view of the default weighting policy.
  const summary = useMemo(() => qosSummary(flows), [flows])

  // Evaluate every policy template as a what-if candidate (clone-only).
  const candidates = useMemo(
    () =>
      QOS_POLICIES.map((policy) => ({
        policy,
        result: whatIfReshape(flows, policy.weights),
      })),
    [flows],
  )

  const best = useMemo(() => {
    const valid = candidates.filter((c) => c.result.valid)
    if (valid.length === 0) return null
    return valid.reduce((a, b) =>
      b.result.totalDropsDelta < a.result.totalDropsDelta ? b : a,
    )
  }, [candidates])

  if (flows.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Quality of Service"
          description="Traffic classification, DSCP marking and queue health."
        />
        <EmptyState
          icon={Layers}
          title="No traffic to classify"
          description="Seed the fleet to generate flows for QoS analysis."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quality of Service"
        description="Simulated class-based marking (DSCP/EF, AF41, AF21, CS1), weighted-fair allocation, drops and a clone-only what-if reshaper."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Policy score"
          value={`${summary.score}`}
          icon={summary.grade === 'clean' ? ShieldCheck : AlertTriangle}
          accent={
            summary.grade === 'clean'
              ? 'text-success'
              : summary.grade === 'stressed'
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${formatMbps(summary.throughputMbps)} classified`}
        />
        <StatCard
          label="Tail drops"
          value={`${summary.dropsPps.toLocaleString()}`}
          icon={Timer}
          accent={summary.dropsMbps > 0 ? 'text-destructive' : 'text-success'}
          hint={`${formatPct(summary.dropsMbps, 1)} of throughput`}
        />
        <StatCard
          label="Starved classes"
          value={`${summary.starved.length}/${CLASS_ORDER.length}`}
          icon={AlertTriangle}
          accent={summary.starved.length > 0 ? 'text-warning' : 'text-success'}
          hint={
            summary.starved.length > 0
              ? summary.starved.map((cls) => CLASS_META[cls].label).join(', ')
              : 'all within allocation'
          }
        />
        <StatCard
          label="Priority inversion"
          value={summary.inversion ? 'Detected' : 'None'}
          icon={Scale}
          accent={summary.inversion ? 'text-destructive' : 'text-success'}
          hint={
            summary.inversion
              ? (summary.inversionDetail ?? '')
              : 'scheduling is sane'
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4 text-primary" />
            Traffic classes &amp; DSCP markings
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Default weighted-fair policy: {defaultWeights().realtime}% realtime
            / {defaultWeights().interactive}% interactive /{' '}
            {defaultWeights().transactional}% transactional /{' '}
            {defaultWeights().bulk}% bulk / {defaultWeights()['best-effort']}%
            best-effort.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Class
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  DSCP
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Flows
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Mbps
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Share
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Util vs alloc
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Drops (Mbps)
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.byClass.map((stat) => (
                <tr key={stat.class} className="border-t border-border/50">
                  <td className="p-2">
                    <span className="flex items-center gap-2">
                      <span
                        className={`size-2 rounded-full ${CLASS_META[stat.class].colour}`}
                        aria-hidden
                      />
                      <span className="font-medium">{stat.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {stat.queue}
                      </span>
                    </span>
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {stat.dscpName} ({stat.dscp})
                    </Badge>
                  </td>
                  <td className="p-2 text-right tabular-nums">{stat.flows}</td>
                  <td className="p-2 text-right tabular-nums">
                    {stat.throughputMbps}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatPct(stat.sharePct, 1)}
                    <span className="ml-2 inline-block h-1.5 w-16 overflow-hidden rounded-full bg-muted align-middle">
                      <span
                        className={`block h-full ${CLASS_META[stat.class].colour}`}
                        style={{ width: `${stat.sharePct}%` }}
                      />
                    </span>
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    <span
                      className={
                        stat.utilisationPct > 100
                          ? 'text-destructive'
                          : stat.utilisationPct > 90
                            ? 'text-warning'
                            : 'text-success'
                      }
                    >
                      {formatUtilisation(stat)}
                    </span>
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {stat.dropsMbps > 0 ? (
                      <span className="text-destructive">{stat.dropsMbps}</span>
                    ) : (
                      <span className="text-muted-foreground">·</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-primary" />
            What-if reshaping
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Clone-only policy simulation — candidates never touch live state.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {candidates.map(({ policy, result }) => {
            const isBest = best !== null && best.policy.id === policy.id
            return (
              <div
                key={policy.id}
                className="rounded-lg border border-border/60 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium">{policy.label}</span>
                    {isBest ? (
                      <Badge variant="success">Best available</Badge>
                    ) : null}
                    {!result.valid ? (
                      <Badge variant="destructive">Invalid weights</Badge>
                    ) : null}
                  </span>
                  <span
                    className={`text-xs tabular-nums ${
                      result.totalDropsDelta < 0
                        ? 'text-success'
                        : result.totalDropsDelta > 0
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {result.totalDropsDelta === 0
                      ? 'no change vs baseline'
                      : `${result.totalDropsDelta > 0 ? '+' : ''}${result.totalDropsDelta} Mbps drops`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {policy.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {CLASS_ORDER.map((cls) => (
                    <span
                      key={cls}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                      title={CLASS_META[cls].label}
                    >
                      {CLASS_META[cls].label.slice(0, 4).toLowerCase()}{' '}
                      {result.after.find((s) => s.class === cls)?.weight}%
                    </span>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {result.after.map((stat) => (
                    <div
                      key={stat.class}
                      className="rounded bg-muted/50 px-2 py-1 text-[11px]"
                    >
                      <p className="truncate text-muted-foreground">
                        {stat.label}
                      </p>
                      <p className="tabular-nums">
                        {stat.dropsMbps > 0 ? (
                          <span className="text-destructive">
                            {stat.dropsMbps} Mbps drop
                          </span>
                        ) : (
                          <span className="text-success">0 drop</span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="size-4 text-warning" />
            Observations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {summary.dropsMbps === 0 && !summary.inversion ? (
            <p className="text-sm text-muted-foreground">
              Every class sits within its allocation — no tail drops or
              inversion detected on this workload.
            </p>
          ) : (
            <>
              {summary.starved.length > 0 ? (
                <div className="flex items-start gap-2 text-sm">
                  <SeverityBadge severity="high" />
                  <span>
                    {summary.starved
                      .map((cls) => CLASS_META[cls].label)
                      .join(', ')}{' '}
                    exceed their reserved bandwidth.
                  </span>
                </div>
              ) : null}
              {summary.inversion ? (
                <div className="flex items-start gap-2 text-sm">
                  <SeverityBadge severity="critical" />
                  <span>{summary.inversionDetail}</span>
                </div>
              ) : null}
              {summary.dropsMbps > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Tail-drop estimate: {summary.dropsPps.toLocaleString()}{' '}
                  packets/sec across all classes.
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
