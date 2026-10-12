import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { SearchCode, X } from 'lucide-react'
import type { Device } from '@/types'
import {
  applyQuery,
  parseQuery,
  queryMetricMeta,
  QUERY_EXAMPLES,
  QUERY_METRICS,
  metricFromDevice,
  type QueryMetric,
} from '@/lib/query'
import {
  buildMultiSeries,
  filterSamples,
  timeRangeById,
  TIME_RANGES,
  type TimeRangeOption,
} from '@/lib/range'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge, StatusDot } from '@/components/common/Badges'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNetworkStore } from '@/store/useNetworkStore'
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import { formatClock, formatMbps, round } from '@/lib/format'

const SERIES_COLORS = [
  '#38bdf8',
  '#34d399',
  '#fbbf24',
  '#fb923c',
  '#f43f5e',
  '#a78bfa',
  '#22d3ee',
  '#f472b6',
  '#4ade80',
  '#c084fc',
]

const MAX_SERIES = 8

export function ExplorerPage() {
  const devices = useNetworkStore((state) => state.devices)
  const history = useNetworkStore((state) => state.history)
  const now = useNetworkStore((state) => state.lastTick)

  const [query, setQuery] = useState('')
  const [metric, setMetric] = useState<QueryMetric>('latency')
  const [rangeId, setRangeId] = useState('15m')

  const range: TimeRangeOption = timeRangeById(rangeId)
  const parsed = useMemo(() => parseQuery(query), [query])
  const matched = useMemo(() => applyQuery(devices, query), [devices, query])
  const deviceName = useMemo(
    () => new Map(devices.map((device) => [device.id, device.name])),
    [devices],
  )

  const limited = useMemo(() => matched.slice(0, MAX_SERIES), [matched])

  const chartRows = useMemo(() => {
    const base = buildMultiSeries(limited, history, metric, now, range.ms)
    const keys = base.keys
    const rows = base.rows.map((row) => {
      const values = keys
        .map((key) => row[key])
        .filter((value): value is number => typeof value === 'number')
      const filled: Record<string, number | null> = { t: row['t'] as number }
      for (const key of keys) {
        filled[String(key)] = typeof row[key] === 'number' ? row[key] : null
      }
      filled.__avg =
        values.length > 0
          ? Number(
              (
                values.reduce((sum, value) => sum + value, 0) / values.length
              ).toFixed(2),
            )
          : null
      return filled
    })
    return { keys, rows }
  }, [limited, history, metric, now, range.ms])

  const sorted = useMemo(
    () =>
      [...matched].sort(
        (a, b) => metricFromDevice(b, metric) - metricFromDevice(a, metric),
      ),
    [matched, metric],
  )

  const meta = queryMetricMeta(metric)

  const formatValue = (value: number | string) => {
    const num = Number(value)
    if (meta.key === 'throughput') return formatMbps(num)
    return `${round(num, 1)}${meta.unit}`
  }

  const rowsForChart = chartRows.rows

  return (
    <div className="space-y-5">
      <PageHeader
        title="Metric explorer"
        description="Query the fleet with a small language, then overlay historical series."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchCode className="size-4 text-primary" />
            Query
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Combine free text, field filters and metric comparisons:
            <code className="ml-1 font-mono">site:DC-A</code>{' '}
            <code className="font-mono">type:router</code>{' '}
            <code className="font-mono">latency&gt;50</code>{' '}
            <code className="font-mono">util&gt;80</code>
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. site:DC-A type:router latency>50"
                aria-label="Metric explorer query"
                className="pr-8 font-mono"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear query"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <div className="w-44">
                <Select
                  value={metric}
                  onValueChange={(value) => setMetric(value as QueryMetric)}
                >
                  <SelectTrigger aria-label="Metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUERY_METRICS.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-44">
                <Select value={rangeId} onValueChange={setRangeId}>
                  <SelectTrigger aria-label="Time range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIME_RANGES.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {parsed.terms.length} term
              {parsed.terms.length === 1 ? '' : 's'} · {matched.length} of{' '}
              {devices.length} devices match
            </span>
            <span className="mx-1 hidden h-3 w-px bg-border sm:block" />
            {QUERY_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuery(example)}
                className="rounded-full border border-border/70 bg-muted/30 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {meta.label} over the {range.label.toLowerCase()}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {limited.length > 0
              ? `Showing ${limited.length} device${limited.length === 1 ? '' : 's'} + fleet average`
              : 'No devices match this query'}
          </p>
        </CardHeader>
        <CardContent>
          {chartRows.rows.length === 0 ? (
            <EmptyState
              icon={SearchCode}
              title="Nothing to plot yet"
              description="Widen your query or wait for the simulation to collect history."
            />
          ) : (
            <>
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rowsForChart}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="hsl(var(--border))"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="t"
                      tickFormatter={(value) => formatClock(Number(value))}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      width={48}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      content={
                        <ChartTooltip
                          labelFormatter={(value) => formatClock(Number(value))}
                          valueFormatter={(value, key) =>
                            key === '__avg'
                              ? formatValue(value)
                              : `${deviceName.get(String(key)) ?? key}: ${formatValue(value)}`
                          }
                        />
                      }
                    />
                    {chartRows.keys.map((key, index) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={deviceName.get(key) ?? key}
                        stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                        strokeWidth={1.5}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="__avg"
                      name="Fleet average"
                      stroke="hsl(var(--foreground))"
                      strokeWidth={2}
                      strokeDasharray="6 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {chartRows.keys.map((key, index) => (
                  <span key={key} className="inline-flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{
                        backgroundColor:
                          SERIES_COLORS[index % SERIES_COLORS.length],
                      }}
                    />
                    {deviceName.get(key) ?? key}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded-full bg-foreground" />
                  Fleet average
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Matching devices ({matched.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {matched.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No devices match &ldquo;{query || '(empty query)'}&rdquo;.
            </p>
          ) : (
            <DeviceTable
              devices={sorted}
              metric={metric}
              now={now}
              history={history}
              rangeMs={range.ms}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DeviceTable({
  devices,
  metric,
  now,
  history,
  rangeMs,
}: {
  devices: Device[]
  metric: QueryMetric
  now: number
  history: ReturnType<typeof useNetworkStore.getState>['history']
  rangeMs: number
}) {
  const meta = queryMetricMeta(metric)
  const visible = devices.slice(0, 12)
  return (
    <ul className="divide-y divide-border/70">
      {visible.map((device) => {
        const samples = filterSamples(history[device.id] ?? [], now, rangeMs)
        const avg =
          samples.length > 0
            ? samples.reduce(
                (sum, sample) =>
                  sum +
                  (metric === 'utilisation'
                    ? (sample.throughputMbps / device.capacityMbps) * 100
                    : sample[metricName(metric)]),
                0,
              ) / samples.length
            : null
        const current = metricFromDevice(device, metric)
        return (
          <li key={device.id} className="flex items-center gap-3 py-2.5">
            <StatusDot status={device.status} />
            <div className="min-w-0 flex-1">
              <Link
                to={`/devices/${device.id}`}
                className="truncate font-medium underline-offset-4 hover:underline"
              >
                {device.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">
                {DEVICE_TYPE_LABELS[device.type]} · {device.site}
              </p>
            </div>
            <div className="hidden text-right sm:block">
              <p className="font-mono text-sm tabular-nums">
                {formatMetricValue(current, metric)}
              </p>
              <p className="text-xs text-muted-foreground">
                {avg !== null
                  ? `avg ${round(avg, 1)}${meta.unit}`
                  : 'no history'}
              </p>
            </div>
            <StatusBadge status={device.status} />
          </li>
        )
      })}
      {devices.length > visible.length ? (
        <li className="py-2 text-xs text-muted-foreground">
          + {devices.length - visible.length} more
        </li>
      ) : null}
    </ul>
  )
}

function metricName(metric: QueryMetric): keyof import('@/types').MetricSample {
  switch (metric) {
    case 'latency':
      return 'latencyMs'
    case 'loss':
      return 'packetLossPct'
    case 'availability':
      return 'availabilityPct'
    case 'throughput':
      return 'throughputMbps'
    case 'cpu':
      return 'cpuPct'
    case 'memory':
      return 'memoryPct'
    case 'utilisation':
      // Handled separately above.
      return 'throughputMbps'
  }
}

function formatMetricValue(value: number, metric: QueryMetric): string {
  const meta = queryMetricMeta(metric)
  if (metric === 'throughput') return formatMbps(value)
  return `${round(value, 1)}${meta.unit}`
}
