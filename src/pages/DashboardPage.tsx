import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Gauge,
  Server,
  Signal,
  Timer,
  Wifi,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartCard } from '@/components/charts/ChartCard'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import {
  aggregateHistory,
  averageAvailability,
  averageLatency,
  averagePacketLoss,
  healthDistribution,
  overallHealth,
  statusCounts,
} from '@/lib/aggregate'
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import {
  formatClock,
  formatDuration,
  formatRelativeTime,
  round,
} from '@/lib/format'
import { percentile } from '@/lib/percentile'
import type { Severity } from '@/types'

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const HEALTH_COLORS = {
  healthy: '#34d399',
  degraded: '#fbbf24',
  critical: '#f43f5e',
} as const

export function DashboardPage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const history = useNetworkStore((state) => state.history)
  const resetDemo = useNetworkStore((state) => state.resetDemo)
  const thresholds = useSettingsStore((state) => state.thresholds)

  const series = useMemo(
    () => aggregateHistory(devices, history),
    [devices, history],
  )

  const stats = useMemo(() => {
    const counts = statusCounts(devices)
    const onlinePct = devices.length
      ? (counts.online / devices.length) * 100
      : 0
    return {
      counts,
      onlinePct,
      latency: averageLatency(devices),
      loss: averagePacketLoss(devices),
      availability: averageAvailability(devices),
      p95: percentile(
        devices.map((device) => device.latencyMs),
        95,
      ),
      health: overallHealth(devices, thresholds),
      healthDist: healthDistribution(devices, thresholds),
    }
  }, [devices, thresholds])

  const statusData = useMemo(
    () => [
      {
        name: 'Online',
        value: stats.counts.online,
        color: HEALTH_COLORS.healthy,
      },
      {
        name: 'Degraded',
        value: stats.counts.degraded,
        color: HEALTH_COLORS.degraded,
      },
      {
        name: 'Offline',
        value: stats.counts.offline,
        color: HEALTH_COLORS.critical,
      },
    ],
    [stats.counts],
  )

  const healthData = useMemo(
    () => [
      {
        name: 'Healthy',
        value: stats.healthDist.healthy,
        color: HEALTH_COLORS.healthy,
      },
      {
        name: 'Degraded',
        value: stats.healthDist.degraded,
        color: HEALTH_COLORS.degraded,
      },
      {
        name: 'Critical',
        value: stats.healthDist.critical,
        color: HEALTH_COLORS.critical,
      },
    ],
    [stats.healthDist],
  )

  const recentIncidents = useMemo(
    () =>
      incidents
        .filter((incident) => incident.status !== 'resolved')
        .sort((a, b) => {
          const bySeverity =
            SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
          return bySeverity !== 0 ? bySeverity : b.createdAt - a.createdAt
        })
        .slice(0, 5),
    [incidents],
  )

  const criticalDevices = useMemo(
    () =>
      devices
        .filter((device) => device.status !== 'online')
        .sort((a, b) => a.availabilityPct - b.availabilityPct)
        .slice(0, 5),
    [devices],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Fleet health, simulated metrics and recent activity."
        />
        <EmptyState
          icon={Server}
          title="No devices in the inventory"
          description="Load the demo topology or add a device to begin monitoring. All data is simulated."
          action={<Button onClick={resetDemo}>Load demo data</Button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Fleet health, simulated metrics and recent activity. DEMO data only."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-7">
        <StatCard
          label="Devices"
          value={String(devices.length)}
          icon={Server}
          hint={`${stats.counts.online} online`}
        />
        <StatCard
          label="Availability"
          value={`${round(stats.onlinePct, 1)}%`}
          icon={Wifi}
          accent="text-success"
          hint={`${stats.counts.offline} offline`}
        />
        <StatCard
          label="Avg Latency"
          value={`${round(stats.latency, 1)} ms`}
          icon={Activity}
          hint={`Threshold ${thresholds.latencyMs} ms`}
        />
        <StatCard
          label="P95 Latency"
          value={`${round(stats.p95 ?? 0, 1)} ms`}
          icon={Timer}
          hint={`of ${devices.length} devices`}
        />
        <StatCard
          label="Packet Loss"
          value={`${round(stats.loss, 2)}%`}
          icon={Signal}
          hint={`Threshold ${thresholds.packetLossPct}%`}
        />
        <StatCard
          label="Uptime"
          value={`${round(stats.availability, 3)}%`}
          icon={Gauge}
          accent="text-info"
          hint="Average, simulated"
        />
        <StatCard
          label="Health Score"
          value={`${round(stats.health, 0)}/100`}
          icon={AlertTriangle}
          accent={stats.health >= 85 ? 'text-success' : 'text-warning'}
          hint={`${stats.healthDist.critical} critical`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Latency (fleet average)"
          description="Simulated round-trip time in milliseconds"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={series}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <defs>
                <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(217 33% 19%)"
                vertical={false}
              />
              <XAxis
                dataKey="t"
                tickFormatter={(value) => formatClock(Number(value))}
                tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }}
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={(value) => formatClock(Number(value))}
                    valueFormatter={(value) => `${round(Number(value), 1)} ms`}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="latencyMs"
                name="Latency"
                stroke="#38bdf8"
                strokeWidth={2}
                fill="url(#latencyFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Packet loss (fleet average)"
          description="Simulated percentage of dropped packets"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={series}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(217 33% 19%)"
                vertical={false}
              />
              <XAxis
                dataKey="t"
                tickFormatter={(value) => formatClock(Number(value))}
                tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }}
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }}
                axisLine={false}
                tickLine={false}
                width={40}
              />
              <Tooltip
                content={
                  <ChartTooltip
                    labelFormatter={(value) => formatClock(Number(value))}
                    valueFormatter={(value) => `${round(Number(value), 2)}%`}
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

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Devices by status"
          description="Current simulated state"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={statusData}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(217 33% 19%)"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'hsl(215 20% 65%)' }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip
                cursor={{ fill: 'hsl(217 33% 19% / 0.4)' }}
                content={<ChartTooltip />}
              />
              <Bar dataKey="value" name="Devices" radius={[4, 4, 0, 0]}>
                {statusData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Health distribution"
          description="Devices grouped by health score"
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                content={
                  <ChartTooltip valueFormatter={(v) => `${v} devices`} />
                }
              />
              <Pie
                data={healthData}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                isAnimationActive={false}
              >
                {healthData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent incidents</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link to="/incidents">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentIncidents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No active incidents. The fleet is nominal.
              </p>
            ) : (
              recentIncidents.map((incident) => (
                <Link
                  key={incident.id}
                  to="/incidents"
                  className="flex items-start justify-between gap-2 rounded-md border border-border/60 p-2.5 transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium">
                      {incident.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {incident.deviceIds.length} device(s) -{' '}
                      {formatRelativeTime(incident.createdAt)}
                    </p>
                  </div>
                  <SeverityBadge
                    severity={incident.severity}
                    className="shrink-0"
                  />
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Devices needing attention</CardTitle>
        </CardHeader>
        <CardContent>
          {criticalDevices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              All simulated devices are online and healthy.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {criticalDevices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {device.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {DEVICE_TYPE_LABELS[device.type]} - {device.site}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-mono">{round(device.latencyMs, 1)} ms</p>
                    <p className="text-muted-foreground">
                      up {formatDuration(device.uptimeSec)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
