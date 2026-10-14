import { useEffect, useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  Network,
  Radio,
  Route as RouteIcon,
  Router,
  ShieldCheck,
  Waypoints,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct } from '@/lib/format'
import {
  BGP_STATE_LABELS,
  OSPF_STATE_LABELS,
  PROTOCOL_LABELS,
  buildAutonomousSystems,
  buildBgpSessions,
  buildOspfAdjacencies,
  buildRoutingTables,
  convergenceTimeline,
  detectRoutingIssues,
  isRoutingCapable,
  routingSummary,
} from '@/lib/routing'
import { useNetworkStore } from '@/store/useNetworkStore'

const PROTOCOL_TONE: Record<string, string> = {
  connected: 'bg-emerald-500/15 text-emerald-600',
  static: 'bg-zinc-500/15 text-zinc-600',
  ospf: 'bg-sky-500/15 text-sky-600',
  bgp: 'bg-violet-500/15 text-violet-600',
}

const BGP_TONE: Record<string, string> = {
  established: 'success',
  active: 'warning',
  idle: 'destructive',
}

const OSPF_TONE: Record<string, string> = {
  full: 'success',
  'two-way': 'warning',
  down: 'destructive',
}

export function RoutingPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const routers = useMemo(
    () => devices.filter((device) => isRoutingCapable(device.type)),
    [devices],
  )

  const systems = useMemo(() => buildAutonomousSystems(), [])
  const bgp = useMemo(() => buildBgpSessions(devices, seed), [devices, seed])
  const ospf = useMemo(() => buildOspfAdjacencies(devices), [devices])
  const tables = useMemo(
    () => buildRoutingTables(devices, ospf, bgp, seed),
    [devices, ospf, bgp, seed],
  )
  const issues = useMemo(
    () => detectRoutingIssues(bgp, ospf, tables, devices, seed),
    [bgp, ospf, tables, devices, seed],
  )
  const events = useMemo(
    () => convergenceTimeline(issues, seed),
    [issues, seed],
  )
  const summary = useMemo(
    () => routingSummary(tables, bgp, ospf, issues),
    [tables, bgp, ospf, issues],
  )

  // Surface each new critical routing issue as a timeline incident.
  const pushEvent = useNetworkStore((state) => state.pushEvent)
  const lastTick = useNetworkStore((state) => state.lastTick)
  useEffect(() => {
    const criticals = issues.filter((issue) => issue.severity === 'critical')
    if (criticals.length === 0) return
    // Only fire when the set of critical issue ids changes.
    const key = criticals.map((i) => i.id).join('|')
    pushEventOnce(key, () => {
      for (const issue of criticals.slice(0, 3)) {
        pushEvent({
          timestamp: lastTick,
          type: 'incident',
          severity: issue.severity,
          deviceId: issue.deviceId ?? undefined,
          message: issue.message,
        })
      }
    })
  }, [issues, lastTick, pushEvent])

  if (routers.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Routing Intelligence"
          description="Simulated BGP, OSPF and per-device routing tables."
        />
        <EmptyState
          icon={Router}
          title="No routers in the fleet"
          description="Routing intelligence needs at least one router. Seed the fleet to generate a control plane."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Routing Intelligence"
        description="A simulated control plane: autonomous systems, BGP peering, OSPF areas, derived routing tables, anomalies and convergence."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Control-plane health"
          value={formatPct(summary.health, 0)}
          icon={summary.grade === 'healthy' ? ShieldCheck : AlertTriangle}
          accent={
            summary.grade === 'healthy'
              ? 'text-success'
              : summary.grade === 'degraded'
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.routers} routers`}
        />
        <StatCard
          label="BGP established"
          value={`${summary.bgpByState.established}/${bgp.length}`}
          icon={Waypoints}
          accent={
            summary.bgpByState.idle > 0 ? 'text-destructive' : 'text-success'
          }
          hint={`${summary.bgpRouters} routers peering`}
        />
        <StatCard
          label="OSPF adjacencies"
          value={`${summary.ospfByState.full}/${ospf.length}`}
          icon={Network}
          accent={
            summary.ospfByState.down > 0 ? 'text-warning' : 'text-success'
          }
          hint="full state"
        />
        <StatCard
          label="Open issues"
          value={`${summary.issues}`}
          icon={AlertTriangle}
          accent={summary.issues > 0 ? 'text-warning' : 'text-success'}
          hint={`${summary.totalRoutes} routes installed`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Waypoints className="size-4 text-primary" />
              Autonomous systems
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {systems.map((system) => (
              <div
                key={system.asn}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant={system.local ? 'default' : 'secondary'}>
                    AS{system.asn}
                  </Badge>
                  <span className="truncate">{system.name}</span>
                </span>
                <span className="shrink-0 text-xs capitalize text-muted-foreground">
                  {system.role}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="size-4 text-primary" />
              BGP peering sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bgp.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No BGP sessions — no reachable edge routers.
              </p>
            ) : (
              bgp.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge
                      variant={BGP_TONE[session.state] as never}
                      className="shrink-0"
                    >
                      {BGP_STATE_LABELS[session.state]}
                    </Badge>
                    <span className="truncate">
                      {session.localDeviceName} → {session.remotePeer} (AS
                      {session.remoteAsn})
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {session.state === 'established'
                      ? `${session.prefixesReceived} prefixes`
                      : '—'}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="size-4 text-primary" />
              OSPF adjacencies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {ospf.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No OSPF adjacencies formed between routers.
              </p>
            ) : (
              ospf.slice(0, 10).map((adjacency) => (
                <div
                  key={adjacency.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge
                      variant={OSPF_TONE[adjacency.state] as never}
                      className="shrink-0"
                    >
                      {OSPF_STATE_LABELS[adjacency.state]}
                    </Badge>
                    <span className="truncate">
                      {adjacency.aName} ↔ {adjacency.bName}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      area {adjacency.area}
                    </Badge>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    cost {adjacency.cost}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" />
              Control-plane issues
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No routing issues detected.
              </p>
            ) : (
              issues.slice(0, 8).map((issue) => (
                <div
                  key={issue.id}
                  className="flex items-start justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <SeverityBadge severity={issue.severity} />
                    <span className="truncate">{issue.message}</span>
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {events.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              Convergence timeline
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Simulated reconvergence duration per control-plane failure.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.slice(0, 6).map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SeverityBadge severity={event.severity} />
                  <span className="truncate">{event.scope}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {event.seconds}s · {event.prefixesAffected} prefixes
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {tables.slice(0, 4).map((table) => (
          <Card key={table.deviceId}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <RouteIcon className="size-4 text-primary" />
                {table.deviceName}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                router-id {table.routerId}
                {table.ospfArea !== null ? ` · area ${table.ospfArea}` : ''}
                {table.localAsn !== null ? ` · AS${table.localAsn}` : ''}
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Prefix
                    </th>
                    <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Proto
                    </th>
                    <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Next hop
                    </th>
                    <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Metric
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {table.routes.slice(0, 6).map((route) => (
                    <tr key={`${table.deviceId}-${route.prefix}`}>
                      <td className="whitespace-nowrap p-2 font-mono text-xs">
                        {route.prefix}
                      </td>
                      <td className="p-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            PROTOCOL_TONE[route.protocol] ?? ''
                          }`}
                        >
                          {PROTOCOL_LABELS[route.protocol]}
                        </span>
                      </td>
                      <td className="max-w-[10rem] truncate p-2 text-xs text-muted-foreground">
                        {route.nextHopName}
                      </td>
                      <td className="p-2 text-right text-xs tabular-nums">
                        {route.metric}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Fire a side effect only when the computed key changes. Keeps the
 * pushEvent effect above from re-firing every tick for the same issues.
 */
const seenKeys = new Set<string>()
function pushEventOnce(key: string, run: () => void): void {
  if (seenKeys.has(key)) return
  seenKeys.add(key)
  run()
}
