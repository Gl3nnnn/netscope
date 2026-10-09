import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, Gauge } from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { ChartCard } from '@/components/charts/ChartCard'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { useNetworkStore } from '@/store/useNetworkStore'
import { aggregateHistory } from '@/lib/aggregate'
import { flagAnomalies, type FlaggedPoint } from '@/lib/anomaly'
import {
  SATURATION_THRESHOLD_PCT,
  avgUtilization,
  fleetUtilization,
  maxUtilization,
  utilizationPct,
} from '@/lib/capacity'
import { formatClock, formatMbps, round } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Device } from '@/types'

const WINDOWS = [
  { value: '30', label: 'Last 30 samples' },
  { value: '60', label: 'Last 60 samples' },
  { value: '120', label: 'Last 120 samples' },
  { value: 'all', label: 'All retained samples' },
] as const

const ANOMALY_KEYS = [
  'latencyMs',
  'packetLossPct',
  'cpuPct',
  'memoryPct',
  'throughputMbps',
] as const
type AnomalyKey = (typeof ANOMALY_KEYS)[number]

const GRID = 'hsl(217 33% 19%)'
const AXIS = 'hsl(215 20% 65%)'
const ANOMALY_COLOR = '#f87171'

type SeriesPoint = {
  t: number
  latencyMs: number
  packetLossPct: number
  availabilityPct: number
  throughputMbps: number
  cpuPct: number
  memoryPct: number
}

export function PerformancePage() {
  const devices = useNetworkStore((state) => state.devices)
  const history = useNetworkStore((state) => state.history)
  const [deviceId, setDeviceId] = useState<string>('fleet')
  const [window, setWindow] = useState<string>('60')

  const series = useMemo<SeriesPoint[]>(() => {
    if (deviceId === 'fleet') return aggregateHistory(devices, history)
    const samples = history[deviceId] ?? []
    return samples.map((sample) => ({
      t: sample.t,
      latencyMs: sample.latencyMs,
      packetLossPct: sample.packetLossPct,
      availabilityPct: sample.availabilityPct,
      throughputMbps: sample.throughputMbps,
      cpuPct: sample.cpuPct,
      memoryPct: sample.memoryPct,
    }))
  }, [deviceId, devices, history])

  const windowed = useMemo<SeriesPoint[]>(() => {
    if (window === 'all') return series
    const count = Number(window)
    return series.slice(Math.max(0, series.length - count))
  }, [series, window])

  const flagged = useMemo(() => {
    const map: Record<AnomalyKey, FlaggedPoint[]> = {
      latencyMs: [],
      packetLossPct: [],
      cpuPct: [],
      memoryPct: [],
      throughputMbps: [],
    }
    for (const key of ANOMALY_KEYS) {
      map[key] = flagAnomalies(
        windowed.map((point) => ({ t: point.t, value: point[key] })),
        { windowSize: 12, threshold: 3 },
      )
    }
    return map
  }, [windowed])

  const recentAnomalies = useMemo(() => {
    if (windowed.length === 0) return 0
    const cutoff =
      windowed.length > 12 ? windowed[windowed.length - 12].t : windowed[0].t
    return ANOMALY_KEYS.reduce(
      (total, key) =>
        total + flagged[key].filter((point) => point.t >= cutoff).length,
      0,
    )
  }, [flagged, windowed])

  const capacity = useMemo(() => {
    const bySite = new Map<string, Device[]>()
    for (const device of devices) {
      const list = bySite.get(device.site) ?? []
      list.push(device)
      bySite.set(device.site, list)
    }
    const rows = [...bySite.entries()]
      .map(([site, siteDevices]) => ({
        site,
        avg: avgUtilization(siteDevices),
        max: maxUtilization(siteDevices),
        count: siteDevices.length,
      }))
      .sort((a, b) => b.max - a.max)
    const totalCapacity = devices.reduce(
      (sum, device) => sum + device.capacityMbps,
      0,
    )
    const totalThroughput = devices.reduce(
      (sum, device) => sum + device.throughputMbps,
      0,
    )
    return {
      rows,
      fleet: fleetUtilization(devices),
      headroomMbps: totalCapacity - totalThroughput,
      atRisk: devices.filter(
        (device) =>
          utilizationPct(device.throughputMbps, device.capacityMbps) >=
          SATURATION_THRESHOLD_PCT,
      ),
    }
  }, [devices])

  const summary = useMemo(() => {
    if (windowed.length === 0) return null
    const avg = (
      key:
        | 'latencyMs'
        | 'packetLossPct'
        | 'availabilityPct'
        | 'throughputMbps'
        | 'cpuPct'
        | 'memoryPct',
    ) => windowed.reduce((sum, point) => sum + point[key], 0) / windowed.length
    const max = (key: 'latencyMs' | 'cpuPct' | 'throughputMbps') =>
      Math.max(...windowed.map((point) => point[key]))
    const minAvail = Math.min(...windowed.map((point) => point.availabilityPct))
    return {
      latency: avg('latencyMs'),
      loss: avg('packetLossPct'),
      availability: avg('availabilityPct'),
      maxLatency: max('latencyMs'),
      minAvailability: minAvail,
      cpu: avg('cpuPct'),
      maxCpu: max('cpuPct'),
      memory: avg('memoryPct'),
      throughput: avg('throughputMbps'),
      peakThroughput: max('throughputMbps'),
    }
  }, [windowed])

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Performance"
          description="Historical simulated latency, packet loss and availability."
        />
        <EmptyState
          icon={Activity}
          title="No historical data yet"
          description="Add devices or load the demo fleet to populate performance charts."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Performance"
        description="Historical simulated latency, packet loss and availability. DEMO data only."
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="perf-device" className="text-xs">
              Device
            </Label>
            <Select value={deviceId} onValueChange={setDeviceId}>
              <SelectTrigger id="perf-device">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="fleet">Fleet average</SelectItem>
                {devices.map((device) => (
                  <SelectItem key={device.id} value={device.id}>
                    {device.name} - {device.ip}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-1.5 sm:w-56">
            <Label htmlFor="perf-window" className="text-xs">
              Window
            </Label>
            <Select value={window} onValueChange={setWindow}>
              <SelectTrigger id="perf-window">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {recentAnomalies > 0 ? (
            <Badge variant="warning" className="shrink-0">
              <AlertTriangle className="size-3" />
              {recentAnomalies} anomalies in the last 12 samples
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {windowed.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No samples for this selection"
          description="The simulation has not produced history for this device yet. Wait a few refresh cycles or choose the fleet average."
          action={
            <Button variant="outline" onClick={() => setDeviceId('fleet')}>
              View fleet average
            </Button>
          }
        />
      ) : (
        <>
          {summary ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Summary
                label="Avg latency"
                value={`${round(summary.latency, 1)} ms`}
              />
              <Summary
                label="Peak latency"
                value={`${round(summary.maxLatency, 1)} ms`}
              />
              <Summary
                label="Avg packet loss"
                value={`${round(summary.loss, 2)}%`}
              />
              <Summary
                label="Min availability"
                value={`${round(summary.minAvailability, 3)}%`}
              />
              <Summary label="Avg CPU" value={`${round(summary.cpu, 1)}%`} />
              <Summary
                label="Peak CPU"
                value={`${round(summary.maxCpu, 1)}%`}
              />
              <Summary
                label="Avg memory"
                value={`${round(summary.memory, 1)}%`}
              />
              <Summary
                label="Avg throughput"
                value={formatMbps(summary.throughput)}
              />
            </div>
          ) : null}

          <ChartCard
            title="Latency"
            description="Milliseconds over retained history"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={windowed}
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
                        `${round(Number(value), 1)} ms`
                      }
                    />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="latencyMs"
                  name="Latency"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                {flagged.latencyMs.map((point) => (
                  <ReferenceDot
                    key={point.t}
                    x={point.t}
                    y={point.value}
                    r={4}
                    fill={ANOMALY_COLOR}
                    stroke="none"
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Packet loss"
              description="Percentage of simulated dropped packets"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={windowed}
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
                  {flagged.packetLossPct.map((point) => (
                    <ReferenceDot
                      key={point.t}
                      x={point.t}
                      y={point.value}
                      r={4}
                      fill={ANOMALY_COLOR}
                      stroke="none"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Availability"
              description="Percentage of simulated uptime"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={windowed}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="availFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
                      <stop
                        offset="100%"
                        stopColor="#34d399"
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
                    domain={[90, 100]}
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
                          `${round(Number(value), 3)}%`
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="availabilityPct"
                    name="Availability"
                    stroke="#34d399"
                    strokeWidth={2}
                    fill="url(#availFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="CPU utilisation"
              description="Simulated processor pressure"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={windowed}
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
                  {flagged.cpuPct.map((point) => (
                    <ReferenceDot
                      key={point.t}
                      x={point.t}
                      y={point.value}
                      r={4}
                      fill={ANOMALY_COLOR}
                      stroke="none"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Memory utilisation"
              description="Simulated memory pressure"
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={windowed}
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
                  {flagged.memoryPct.map((point) => (
                    <ReferenceDot
                      key={point.t}
                      x={point.t}
                      y={point.value}
                      r={4}
                      fill={ANOMALY_COLOR}
                      stroke="none"
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Throughput"
              description="Simulated aggregate traffic"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={windowed}
                  margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="throughputFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.5} />
                      <stop
                        offset="100%"
                        stopColor="#2dd4bf"
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
                        valueFormatter={(value) => formatMbps(Number(value))}
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="throughputMbps"
                    name="Throughput"
                    stroke="#2dd4bf"
                    strokeWidth={2}
                    fill="url(#throughputFill)"
                    isAnimationActive={false}
                  />
                  {flagged.throughputMbps.map((point) => (
                    <ReferenceDot
                      key={point.t}
                      x={point.t}
                      y={point.value}
                      r={4}
                      fill={ANOMALY_COLOR}
                      stroke="none"
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="size-4" /> Capacity &amp; headroom
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <CapacityStat
              label="Fleet utilisation"
              value={`${round(capacity.fleet, 1)}%`}
            />
            <CapacityStat
              label="Unused headroom"
              value={formatMbps(capacity.headroomMbps)}
            />
            <CapacityStat
              label="Saturated devices"
              value={`${capacity.atRisk.length}`}
              accent={
                capacity.atRisk.length > 0 ? 'text-destructive' : 'text-success'
              }
            />
            <CapacityStat
              label="Sites covered"
              value={`${capacity.rows.length}`}
            />
          </div>
          <div className="space-y-2">
            {capacity.rows.map((row) => {
              const color =
                row.max >= SATURATION_THRESHOLD_PCT
                  ? '#ef4444'
                  : row.max >= 50
                    ? '#fbbf24'
                    : '#38bdf8'
              return (
                <div key={row.site} className="flex items-center gap-3">
                  <span className="w-40 truncate text-xs text-muted-foreground">
                    {row.site}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${row.avg}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="flex w-28 shrink-0 justify-end font-mono text-[11px] tabular-nums text-muted-foreground">
                    {round(row.avg, 0)}% avg / {round(row.max, 0)}% max
                  </span>
                </div>
              )
            })}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Saturation risk (at or above {SATURATION_THRESHOLD_PCT}% util)
            </p>
            {capacity.atRisk.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No devices are currently at saturation risk.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {capacity.atRisk.map((device) => (
                  <li
                    key={device.id}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">{device.name}</span>
                    <span className="font-mono text-xs text-destructive">
                      {round(
                        utilizationPct(
                          device.throughputMbps,
                          device.capacityMbps,
                        ),
                        1,
                      )}
                      %
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

function CapacityStat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: string
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={cn('mt-1 text-xl font-semibold tabular-nums', accent)}>
          {value}
        </p>
      </CardContent>
    </Card>
  )
}
