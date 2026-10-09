import { useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
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
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { formatClock, formatMbps, round } from '@/lib/format'

const WINDOWS = [
  { value: '30', label: 'Last 30 samples' },
  { value: '60', label: 'Last 60 samples' },
  { value: '120', label: 'Last 120 samples' },
  { value: 'all', label: 'All retained samples' },
] as const

const GRID = 'hsl(217 33% 19%)'
const AXIS = 'hsl(215 20% 65%)'

export function PerformancePage() {
  const devices = useNetworkStore((state) => state.devices)
  const history = useNetworkStore((state) => state.history)
  const [deviceId, setDeviceId] = useState<string>('fleet')
  const [window, setWindow] = useState<string>('60')

  const series = useMemo(() => {
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

  const windowed = useMemo(() => {
    if (window === 'all') return series
    const count = Number(window)
    return series.slice(Math.max(0, series.length - count))
  }, [series, window])

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
              <Summary
                label="Avg CPU"
                value={`${round(summary.cpu, 1)}%`}
              />
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
                        valueFormatter={(value) =>
                          formatMbps(Number(value))
                        }
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
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}
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
