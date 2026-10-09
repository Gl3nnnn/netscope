import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Cpu,
  Gauge,
  MemoryStick,
  Server,
  Signal,
  Timer,
  Wifi,
  Wrench,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { HealthLevel } from '@/types'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { ErrorState } from '@/components/common/ErrorState'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge, SeverityBadge } from '@/components/common/Badges'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartCard } from '@/components/charts/ChartCard'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import {
  computeHealthScore,
  healthLevel,
  HEALTH_LABELS,
  DEVICE_TYPE_LABELS,
} from '@/lib/health'
import { utilizationPct } from '@/lib/capacity'
import { percentile } from '@/lib/percentile'
import {
  formatClock,
  formatDateTime,
  formatDuration,
  formatMbps,
  formatRelativeTime,
  round,
} from '@/lib/format'
import { cn } from '@/lib/utils'

const GRID = 'hsl(217 33% 19%)'
const AXIS = 'hsl(215 20% 65%)'

const HEALTH_ACCENT: Record<HealthLevel, string> = {
  healthy: 'text-success',
  degraded: 'text-warning',
  critical: 'text-destructive',
}

export function DeviceDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const device = useNetworkStore((state) =>
    state.devices.find((item) => item.id === id),
  )
  const history = useNetworkStore((state) => state.history[id] ?? [])
  const incidents = useNetworkStore((state) => state.incidents)
  const events = useNetworkStore((state) => state.events)
  const toggleMaintenance = useNetworkStore((state) => state.toggleMaintenance)
  const thresholds = useSettingsStore((state) => state.thresholds)

  const deviceIncidents = useMemo(
    () =>
      incidents
        .filter((incident) => incident.deviceIds.includes(id))
        .sort((a, b) => b.createdAt - a.createdAt),
    [incidents, id],
  )

  const deviceEvents = useMemo(
    () =>
      events
        .filter((event) => event.deviceId === id)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 12),
    [events, id],
  )

  const p95Latency = useMemo(
    () =>
      history.length === 0
        ? undefined
        : percentile(
            history.map((sample) => sample.latencyMs),
            95,
          ),
    [history],
  )

  if (!device) {
    return (
      <div className="space-y-5">
        <PageHeader title="Device not found" />
        <ErrorState
          title="This device does not exist"
          description="It may have been deleted, or the link is incorrect. Return to the inventory to pick a device."
          action={
            <Button asChild variant="outline">
              <Link to="/devices">
                <ArrowLeft className="size-4" /> Back to inventory
              </Link>
            </Button>
          }
        />
      </div>
    )
  }

  const score = round(computeHealthScore(device, thresholds), 0)
  const level = healthLevel(score)

  return (
    <div className="space-y-5">
      <PageHeader
        title={device.name}
        description={`${DEVICE_TYPE_LABELS[device.type]} at ${device.site} - simulated DEMO telemetry.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/devices">
              <ArrowLeft className="size-4" /> Back
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-muted/60 text-primary">
              <Server className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{device.name}</span>
                <StatusBadge status={device.status} />
                {device.flapping ? (
                  <Badge variant="warning">Flapping</Badge>
                ) : null}
                {device.inMaintenance ? (
                  <Badge variant="warning">In maintenance</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {DEVICE_TYPE_LABELS[device.type]} - {device.site}
              </p>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Field label="IP" value={device.ip} mono />
            <Field label="MAC" value={device.mac} mono />
            <Field label="Uptime" value={formatDuration(device.uptimeSec)} />
            <Field
              label="Last seen"
              value={formatRelativeTime(device.lastSeen)}
            />
            <Field
              label="Utilisation"
              value={`${round(
                utilizationPct(device.throughputMbps, device.capacityMbps),
                1,
              )}%`}
            />
          </dl>
          <Button
            variant={device.inMaintenance ? 'outline' : 'secondary'}
            size="sm"
            onClick={() => toggleMaintenance(device.id)}
          >
            <Wrench className="size-4" />
            {device.inMaintenance ? 'Exit maintenance' : 'Enter maintenance'}
          </Button>
          {device.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {device.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-7">
        <StatCard
          label="Health Score"
          value={`${score}/100`}
          icon={Gauge}
          accent={HEALTH_ACCENT[level]}
          hint={HEALTH_LABELS[level]}
        />
        <StatCard
          label="Latency"
          value={`${round(device.latencyMs, 1)} ms`}
          icon={Activity}
          hint={`Threshold ${thresholds.latencyMs} ms`}
        />
        <StatCard
          label="P95 Latency"
          value={p95Latency === undefined ? '—' : `${round(p95Latency, 1)} ms`}
          icon={Timer}
          hint={
            p95Latency === undefined
              ? 'Awaiting history'
              : `${history.length} samples`
          }
        />
        <StatCard
          label="Packet Loss"
          value={`${round(device.packetLossPct, 2)}%`}
          icon={Signal}
          hint={`Threshold ${thresholds.packetLossPct}%`}
        />
        <StatCard
          label="Availability"
          value={`${round(device.availabilityPct, 3)}%`}
          icon={Wifi}
          accent="text-info"
          hint={`Threshold ${thresholds.availabilityPct}%`}
        />
        <StatCard
          label="CPU"
          value={`${round(device.cpuPct, 0)}%`}
          icon={Cpu}
          hint="Simulated"
        />
        <StatCard
          label="Throughput"
          value={formatMbps(device.throughputMbps)}
          icon={MemoryStick}
          hint={`Memory ${round(device.memoryPct, 0)}%`}
        />
      </div>

      {history.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No history yet"
          description="Telemetry samples will appear here once the simulation records a few ticks for this device."
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Latency"
              description="Simulated round-trip time for this device"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={history}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="deviceLatencyFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                      <stop
                        offset="100%"
                        stopColor="#38bdf8"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(value) => formatClock(Number(value))}
                    tick={{ fontSize: 11, fill: AXIS }}
                    minTickGap={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: AXIS }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(value) => formatClock(Number(value))}
                        valueFormatter={(value) =>
                          `${round(Number(value), 1)} ms`
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="latencyMs"
                    name="Latency"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    fill="url(#deviceLatencyFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Packet loss"
              description="Simulated percentage of dropped packets"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={history}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(value) => formatClock(Number(value))}
                    tick={{ fontSize: 11, fill: AXIS }}
                    minTickGap={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: AXIS }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(value) => formatClock(Number(value))}
                        valueFormatter={(value) =>
                          `${round(Number(value), 2)}%`
                        }
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="packetLossPct"
                    name="Packet loss"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="CPU utilisation"
              description="Simulated processor pressure"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={history}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(value) => formatClock(Number(value))}
                    tick={{ fontSize: 11, fill: AXIS }}
                    minTickGap={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: AXIS }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(value) => formatClock(Number(value))}
                        valueFormatter={(value) =>
                          `${round(Number(value), 1)}%`
                        }
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="cpuPct"
                    name="CPU"
                    stroke="#f472b6"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Memory utilisation"
              description="Simulated memory pressure"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={history}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(value) => formatClock(Number(value))}
                    tick={{ fontSize: 11, fill: AXIS }}
                    minTickGap={40}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: AXIS }}
                    axisLine={false}
                    tickLine={false}
                    width={44}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        labelFormatter={(value) => formatClock(Number(value))}
                        valueFormatter={(value) =>
                          `${round(Number(value), 1)}%`
                        }
                      />
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="memoryPct"
                    name="Memory"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Incidents</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/incidents">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {deviceIncidents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No incidents recorded for this device.
              </p>
            ) : (
              deviceIncidents.slice(0, 6).map((incident) => (
                <div
                  key={incident.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-border/60 p-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium">
                      {incident.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {incident.status} -{' '}
                      {formatRelativeTime(incident.createdAt)}
                    </p>
                  </div>
                  <SeverityBadge
                    severity={incident.severity}
                    className="shrink-0"
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent activity</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/timeline">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {deviceEvents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No events recorded for this device.
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-border/70 pl-5">
                {deviceEvents.map((event) => (
                  <li key={event.id} className="relative">
                    <span className="absolute -left-[27px] top-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-card">
                      <AlertTriangle
                        className={cn(
                          'size-3',
                          event.severity
                            ? 'text-warning'
                            : 'text-muted-foreground',
                        )}
                      />
                    </span>
                    <p className="text-sm">{event.message}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <time dateTime={new Date(event.timestamp).toISOString()}>
                        {formatDateTime(event.timestamp)}
                      </time>
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? 'font-mono text-xs' : 'text-sm'}>{value}</dd>
    </div>
  )
}
