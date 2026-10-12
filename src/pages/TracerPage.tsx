import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowLeftRight,
  GitBranch,
  Route,
  ShieldCheck,
  Timer,
  Waypoints,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { StatusBadge } from '@/components/common/Badges'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  PATH_STATUS_HEX,
  PATH_STATUS_LABELS,
  buildAdjacency,
  trace,
  type HopMetric,
  type PathResult,
} from '@/lib/tracer'
import { STATUS_HEX } from '@/lib/health'
import { useNetworkStore } from '@/store/useNetworkStore'
import { formatMbps, formatPct, round } from '@/lib/format'
import { cn } from '@/lib/utils'

const HOP_SPACING = 150
const HOP_PADDING = 60
const HOP_Y = 60
const HOP_RADIUS = 18

function pathD(path: string[]): string {
  return path
    .map((_, index) => {
      const x = HOP_PADDING + index * HOP_SPACING
      return `${index === 0 ? 'M' : 'L'} ${x},${HOP_Y}`
    })
    .join(' ')
}

function HopStrip({
  result,
  criticalHopId,
}: {
  result: PathResult
  criticalHopId: string | null
}) {
  const width = HOP_PADDING * 2 + (result.hops.length - 1) * HOP_SPACING
  const d = pathD(result.path)
  const statusHex =
    PATH_STATUS_HEX[result.status as keyof typeof PATH_STATUS_HEX]

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${Math.max(width, 300)} 120`}
        className="h-32 w-full min-w-[320px]"
        role="img"
        aria-label={`Path with ${result.hops.length} hops`}
      >
        <path
          d={d}
          fill="none"
          stroke="currentColor"
          className="text-border"
          strokeWidth={2}
          strokeDasharray="4 4"
        />
        <path
          d={d}
          fill="none"
          stroke={statusHex}
          strokeWidth={2}
          opacity={0.4}
        />
        <circle r={4} fill={statusHex}>
          <animateMotion
            dur={`${Math.max(1.5, result.hops.length)}s`}
            repeatCount="indefinite"
            path={d}
          />
        </circle>
        {result.hops.map((hop, index) => {
          const x = HOP_PADDING + index * HOP_SPACING
          const critical = hop.deviceId === criticalHopId
          return (
            <g key={hop.deviceId}>
              {critical ? (
                <circle
                  cx={x}
                  cy={HOP_Y}
                  r={HOP_RADIUS + 6}
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth={1.5}
                  strokeDasharray="3 3"
                />
              ) : null}
              <circle
                cx={x}
                cy={HOP_Y}
                r={HOP_RADIUS}
                fill={STATUS_HEX[hop.status]}
                opacity={0.9}
              />
              <text
                x={x}
                y={HOP_Y + 4}
                textAnchor="middle"
                className="fill-slate-950 text-[10px] font-semibold"
              >
                {index + 1}
              </text>
              <text
                x={x}
                y={HOP_Y - HOP_RADIUS - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {round(hop.latencyMs, 1)}ms
              </text>
              <text
                x={x}
                y={HOP_Y + HOP_RADIUS + 16}
                textAnchor="middle"
                className="fill-current text-[10px]"
              >
                {hop.device.name.length > 14
                  ? `${hop.device.name.slice(0, 13)}…`
                  : hop.device.name}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function hopTone(hop: HopMetric): string {
  if (hop.status === 'offline') return 'text-destructive'
  if (hop.status === 'degraded' || hop.utilizationPct >= 80)
    return 'text-warning'
  return 'text-success'
}

export function TracerPage() {
  const devices = useNetworkStore((state) => state.devices)
  const [fromSel, setFromSel] = useState('')
  const [toSel, setToSel] = useState('')

  const ids = devices.map((device) => device.id)
  const fromId = ids.includes(fromSel) ? fromSel : (ids[0] ?? '')
  const toId = ids.includes(toSel)
    ? toSel
    : (ids.find((id) => id !== fromId) ?? fromId)

  const graph = useMemo(() => buildAdjacency(devices), [devices])
  const result = useMemo(
    () => (fromId && toId ? trace(devices, fromId, toId, graph) : null),
    [devices, graph, fromId, toId],
  )

  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device])),
    [devices],
  )

  if (devices.length < 2) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Path Tracer"
          description="Trace the hop-by-hop path between two devices."
        />
        <EmptyState
          icon={Route}
          title="Not enough devices"
          description="Add at least two devices to trace a path between them."
        />
      </div>
    )
  }

  const primary = result?.primary ?? null
  const detour = result?.healthyDetour ?? null
  const statusHex = primary
    ? PATH_STATUS_HEX[primary.status as keyof typeof PATH_STATUS_HEX]
    : '#94a3b8'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Path Tracer"
        description="Trace the hop-by-hop route between two devices and find its bottleneck."
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Source
            </label>
            <Select value={fromId} onValueChange={setFromSel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.id} value={device.id}>
                    {device.name} · {device.site}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label="Swap source and destination"
            onClick={() => {
              setFromSel(toId)
              setToSel(fromId)
            }}
          >
            <ArrowLeftRight className="size-4" />
          </Button>
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Destination
            </label>
            <Select value={toId} onValueChange={setToSel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.id} value={device.id}>
                    {device.name} · {device.site}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {!result || !result.found || !primary ? (
        <EmptyState
          icon={Route}
          title="No route found"
          description="These devices are not connected in the current topology."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="End-to-end latency"
              value={`${round(primary.totalLatencyMs, 1)}ms`}
              icon={Timer}
              hint={`${primary.path.length} hops`}
            />
            <StatCard
              label="Path loss"
              value={formatPct(primary.totalLossPct, 2)}
              icon={Activity}
              hint={`worst hop ${formatPct(primary.worstLossPct, 2)}`}
            />
            <StatCard
              label="Path status"
              value={PATH_STATUS_LABELS[primary.status]}
              icon={ShieldCheck}
              accent={
                primary.status === 'healthy'
                  ? 'text-success'
                  : primary.status === 'degraded'
                    ? 'text-warning'
                    : 'text-destructive'
              }
            />
            <StatCard
              label="Critical hop"
              value={
                primary.criticalHopId
                  ? (deviceById.get(primary.criticalHopId)?.name ?? '-')
                  : '-'
              }
              icon={Waypoints}
              accent="text-warning"
            />
          </div>

          {primary.status === 'broken' ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <GitBranch className="size-4 text-destructive" />
                <span className="text-muted-foreground">
                  Route is broken —{' '}
                  {detour
                    ? 'a healthy detour is available.'
                    : 'no detour avoids the failed hop.'}
                </span>
                {detour ? (
                  <Badge variant="success" className="ml-auto">
                    Detour: {detour.path.length} hops
                  </Badge>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Route className="size-4" style={{ color: statusHex }} />
                Primary path
              </CardTitle>
            </CardHeader>
            <CardContent>
              <HopStrip
                result={primary}
                criticalHopId={primary.criticalHopId}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Per-hop breakdown</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">#</th>
                      <th className="px-4 py-2 font-medium">Device</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Latency
                      </th>
                      <th className="px-4 py-2 text-right font-medium">Loss</th>
                      <th className="px-4 py-2 text-right font-medium">Util</th>
                      <th className="px-4 py-2 font-medium">Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {primary.hops.map((hop, index) => (
                      <tr
                        key={hop.deviceId}
                        className={cn(
                          'border-b border-border/40 last:border-0',
                          hop.deviceId === primary.criticalHopId &&
                            'bg-warning/5',
                        )}
                      >
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="px-4 py-2">
                          <Link
                            to={`/devices/${hop.deviceId}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {hop.device.name}
                          </Link>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {hop.device.site}
                          </span>
                          {hop.deviceId === primary.criticalHopId ? (
                            <Badge variant="warning" className="ml-2">
                              Bottleneck
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={hop.status} />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {round(hop.latencyMs, 1)}ms
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatPct(hop.packetLossPct, 2)}
                        </td>
                        <td
                          className={cn(
                            'px-4 py-2 text-right tabular-nums',
                            hopTone(hop),
                          )}
                        >
                          {formatPct(hop.utilizationPct, 0)}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{
                                  width: `${Math.min(100, hop.contribution)}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {formatPct(hop.contribution, 0)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {detour ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="size-4 text-success" />
                  Healthy detour
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Avoids the failed hop · {round(detour.totalLatencyMs, 1)}ms ·{' '}
                  {formatPct(detour.totalLossPct, 2)} loss
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {detour.hops.map((hop, index) => (
                    <span
                      key={hop.deviceId}
                      className="flex items-center gap-2"
                    >
                      {index > 0 ? (
                        <span className="text-muted-foreground">→</span>
                      ) : null}
                      <Badge variant="outline">
                        {hop.device.name} ·{' '}
                        {formatMbps(hop.device.throughputMbps)}
                      </Badge>
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  )
}
