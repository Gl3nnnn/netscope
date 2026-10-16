import { useMemo } from 'react'
import { Route, Shuffle, TriangleAlert, Waypoints } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildFlows } from '@/lib/flow'
import { formatPct } from '@/lib/format'
import { runSdwan, type SdwanResult, type Tunnel } from '@/lib/sdwan'
import { useNetworkStore } from '@/store/useNetworkStore'

const tunnelStatusVariant = (tunnel: Tunnel) =>
  tunnel.brownout
    ? 'warning'
    : tunnel.status === 'degraded'
      ? 'secondary'
      : 'default'

const qualityTone = (quality: number) =>
  quality >= 80
    ? 'text-success'
    : quality >= 55
      ? 'text-warning'
      : 'text-destructive'

export function SdwanPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const result = useMemo(() => {
    if (devices.length === 0) return null
    const flows = buildFlows(devices, seed)
    return runSdwan({ devices, flows, seed })
  }, [devices, seed])

  if (devices.length === 0 || !result) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="SD-WAN Steering"
          description="Application-aware path selection and failover."
        />
        <EmptyState
          icon={Shuffle}
          title="No overlay to steer"
          description="Seed the fleet to build tunnels and steering decisions."
        />
      </div>
    )
  }

  const { summary, tunnels, events } = result
  const failovers = result.decisions.filter((decision) => decision.failedOver)
  const byClass = classBreakdown(result)

  return (
    <div className="space-y-5">
      <PageHeader
        title="SD-WAN Steering"
        description="One overlay tunnel per underlay circuit, scored for path quality and watched for brownouts (loss, jitter and latency breaches). Every classified flow is steered onto the healthiest path that matches its traffic class — failing over the moment the preferred underlay degrades."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Overlay tunnels"
          value={`${summary.tunnels}`}
          icon={Waypoints}
          accent="text-primary"
          hint={`${summary.sites} sites`}
        />
        <StatCard
          label="Brownouts"
          value={`${summary.brownouts}`}
          icon={TriangleAlert}
          accent={summary.brownouts > 0 ? 'text-warning' : 'text-success'}
          hint="circuits breaching thresholds"
        />
        <StatCard
          label="Steered"
          value={formatPct(summary.steeredPct, 1)}
          icon={Route}
          accent="text-success"
          hint={`${summary.steered}/${summary.flows} flows on a path`}
        />
        <StatCard
          label="Failovers"
          value={`${summary.failedOver}`}
          icon={Shuffle}
          accent={summary.failedOver > 0 ? 'text-destructive' : 'text-success'}
          hint={`${summary.sitesWithFailover} sites affected`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Underlay tunnels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tunnels.map((tunnel) => (
              <div key={tunnel.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {tunnel.site}
                    </span>
                    <Badge variant="secondary">{tunnel.kind}</Badge>
                    <Badge variant={tunnelStatusVariant(tunnel)}>
                      {tunnel.brownout ? 'brownout' : tunnel.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {tunnel.carrier} · {tunnel.role}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums text-muted-foreground">
                    <span>{tunnel.bandwidthMbps} Mbps</span>
                    <span>{tunnel.latencyMs} ms</span>
                    <span>{tunnel.jitterMs} ms jitter</span>
                    <span>{tunnel.lossPct}% loss</span>
                    <span className={qualityTone(tunnel.quality)}>
                      Q{tunnel.quality}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Steering events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All paths healthy — no brownout events.
              </p>
            ) : (
              events.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="warning">{event.reason}</Badge>
                    <span className="truncate">{event.site}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {event.kind} · {event.carrier}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Steering by traffic class</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {byClass.map((row) => (
            <div key={row.class} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{row.class}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.flows} flows · {row.topPath} preferred
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                  <span className="text-success">
                    {formatPct(row.steeredPct, 0)} steered
                  </span>
                  <span
                    className={
                      row.failedOver > 0
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    }
                  >
                    {row.failedOver} failed over
                  </span>
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-success"
                  style={{ width: `${row.steeredPct}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active failovers</CardTitle>
        </CardHeader>
        <CardContent>
          {failovers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No flow has left its preferred path — every underlay is healthy.
            </p>
          ) : (
            <div className="space-y-2">
              {failovers.slice(0, 12).map((decision) => (
                <div
                  key={decision.flowId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="warning">{decision.class}</Badge>
                    <span className="truncate">{decision.application}</span>
                    <span className="text-xs text-muted-foreground">
                      {decision.site}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span>→ {decision.pathKind ?? 'no path'}</span>
                    <Badge variant="destructive">{decision.reason}</Badge>
                  </div>
                </div>
              ))}
              {failovers.length > 12 && (
                <p className="text-xs text-muted-foreground">
                  …and {failovers.length - 12} more failovers.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface ClassRow {
  class: string
  flows: number
  steeredPct: number
  failedOver: number
  topPath: string
}

function classBreakdown(result: SdwanResult): ClassRow[] {
  const rows = new Map<
    string,
    {
      flows: number
      steered: number
      failedOver: number
      paths: Map<string, number>
    }
  >()

  for (const decision of result.decisions) {
    const row = rows.get(decision.class) ?? {
      flows: 0,
      steered: 0,
      failedOver: 0,
      paths: new Map(),
    }
    row.flows += 1
    if (decision.pathId !== null) row.steered += 1
    if (decision.failedOver) row.failedOver += 1
    if (decision.pathKind) {
      row.paths.set(
        decision.pathKind,
        (row.paths.get(decision.pathKind) ?? 0) + 1,
      )
    }
    rows.set(decision.class, row)
  }

  return [...rows.entries()]
    .map(([trafficClass, row]) => ({
      class: trafficClass,
      flows: row.flows,
      steeredPct: row.flows === 0 ? 0 : (row.steered / row.flows) * 100,
      failedOver: row.failedOver,
      topPath:
        [...row.paths.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
    }))
    .sort((a, b) => b.flows - a.flows)
}
