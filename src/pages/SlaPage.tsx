import { useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { EmptyState } from '@/components/common/EmptyState'
import { SeverityBadge } from '@/components/common/Badges'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChartCard } from '@/components/charts/ChartCard'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { useNetworkStore } from '@/store/useNetworkStore'
import { computeSla, deviceUptimePct } from '@/lib/sla'
import {
  DEFAULT_SLO,
  budgetConsumedPct,
  budgetRemainingPct,
  burnRateWindows,
  errorBudgetMs,
  mergeHistory,
  type BurnState,
} from '@/lib/slo'
import { SEVERITY_HEX } from '@/lib/health'
import { formatDuration, round } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Severity } from '@/types'

const GRID = 'hsl(217 33% 19%)'
const AXIS = 'hsl(215 20% 65%)'
const SLA_TARGET = 99.9

function formatMt(ms: number | null): string {
  if (ms === null) return 'n/a'
  return formatDuration(ms / 1000)
}

function BurnBadge({ state }: { state: BurnState }) {
  const label =
    state === 'critical'
      ? 'Critical burn'
      : state === 'warning'
        ? 'Elevated burn'
        : 'Within budget'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        state === 'critical'
          ? 'border-destructive/50 bg-destructive/10 text-destructive'
          : state === 'warning'
            ? 'border-warning/50 bg-warning/10 text-warning'
            : 'border-success/50 bg-success/10 text-success',
      )}
    >
      {label}
    </span>
  )
}

function ErrorBudgetCard({
  consumed,
  remaining,
  burn,
}: {
  consumed: number
  remaining: number
  burn: { fast: number; slow: number; state: BurnState }
}) {
  const barWidth = Math.min(100, Math.max(0, consumed))
  const barColor =
    consumed >= 100
      ? 'bg-destructive'
      : consumed >= 75
        ? 'bg-warning'
        : 'bg-success'
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Error budget - {DEFAULT_SLO.objectivePct}% availability
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Remaining
            </p>
            <p
              className={cn(
                'text-3xl font-semibold tabular-nums',
                remaining <= 0
                  ? 'text-destructive'
                  : remaining < 25
                    ? 'text-warning'
                    : 'text-success',
              )}
            >
              {round(remaining, 1)}%
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>
              Budget {formatDuration(errorBudgetMs(DEFAULT_SLO) / 1000)} per{' '}
              {formatDuration(DEFAULT_SLO.windowMs / 1000)} window
            </p>
            <p>{round(consumed, 1)}% consumed</p>
          </div>
        </div>

        <div className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Fast burn (1h)</p>
            <p className="font-mono text-lg tabular-nums">
              {round(burn.fast, 2)}x
            </p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Slow burn (6h)</p>
            <p className="font-mono text-lg tabular-nums">
              {round(burn.slow, 2)}x
            </p>
          </div>
          <div className="rounded-md border border-border/60 p-3">
            <p className="text-xs text-muted-foreground">Status</p>
            <div className="pt-1">
              <BurnBadge state={burn.state} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function SlaPage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const history = useNetworkStore((state) => state.history)
  const lastTick = useNetworkStore((state) => state.lastTick)

  const sla = useMemo(
    () => computeSla(devices, incidents, history),
    [devices, incidents, history],
  )

  const fleetSamples = useMemo(() => mergeHistory(history), [history])
  const budgetConsumed = useMemo(
    () => budgetConsumedPct(fleetSamples, DEFAULT_SLO),
    [fleetSamples],
  )
  const budgetRemaining = budgetRemainingPct(fleetSamples, DEFAULT_SLO)
  const burn = useMemo(
    () => burnRateWindows(fleetSamples, DEFAULT_SLO, lastTick),
    [fleetSamples, lastTick],
  )

  const severityData = useMemo(
    () =>
      (['critical', 'high', 'medium', 'low'] as Severity[]).map((severity) => ({
        name: severity,
        value: sla.bySeverity[severity],
        color: SEVERITY_HEX[severity],
      })),
    [sla.bySeverity],
  )

  const uptimeDomain = useMemo<[number, number]>(() => {
    if (sla.sites.length === 0) return [98, 100]
    const min = Math.min(...sla.sites.map((site) => site.uptimePct))
    return [Math.max(0, Math.min(98, Math.floor(min * 10) / 10)), 100]
  }, [sla.sites])

  const belowTarget = useMemo(
    () =>
      devices
        .map((device) => ({
          device,
          uptimePct: deviceUptimePct(device, history[device.id]),
        }))
        .filter((entry) => entry.uptimePct < SLA_TARGET)
        .sort((a, b) => a.uptimePct - b.uptimePct),
    [devices, history],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="SLA & Uptime"
          description="Simulated service-level reporting for the DEMO fleet."
        />
        <EmptyState
          icon={Gauge}
          title="No devices to report on"
          description="Load the demo data or add devices to see SLA metrics."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="SLA & Uptime"
        description={`Service-level report against a ${SLA_TARGET}% target (simulated DEMO data).`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Fleet uptime"
          value={`${round(sla.uptimePct, 3)}%`}
          icon={Gauge}
          accent={sla.uptimePct >= SLA_TARGET ? 'text-success' : 'text-warning'}
          hint={`Target ${SLA_TARGET}%`}
        />
        <StatCard
          label="MTTA"
          value={formatMt(sla.mttaMs)}
          icon={Clock}
          hint="Mean time to acknowledge"
        />
        <StatCard
          label="MTTR"
          value={formatMt(sla.mttrMs)}
          icon={CheckCircle2}
          accent="text-info"
          hint="Mean time to resolve"
        />
        <StatCard
          label="Incidents"
          value={String(sla.totalIncidents)}
          icon={AlertTriangle}
          accent={sla.openIncidents > 0 ? 'text-warning' : 'text-success'}
          hint={`${sla.openIncidents} open - ${sla.resolvedIncidents} resolved`}
        />
      </div>

      <ErrorBudgetCard
        consumed={budgetConsumed}
        remaining={budgetRemaining}
        burn={burn}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Incidents by severity"
          description="All incidents recorded this session"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={severityData}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={GRID}
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: AXIS }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: AXIS }}
                axisLine={false}
                tickLine={false}
                width={30}
              />
              <Tooltip
                cursor={{ fill: 'hsl(217 33% 19% / 0.4)' }}
                content={<ChartTooltip />}
              />
              <Bar dataKey="value" name="Incidents" radius={[4, 4, 0, 0]}>
                {severityData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Uptime by site"
          description={`Mean availability vs ${SLA_TARGET}% target`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={sla.sites}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={GRID}
                vertical={false}
              />
              <XAxis
                dataKey="site"
                tick={{ fontSize: 11, fill: AXIS }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={uptimeDomain}
                tick={{ fontSize: 11, fill: AXIS }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                cursor={{ fill: 'hsl(217 33% 19% / 0.4)' }}
                content={
                  <ChartTooltip
                    valueFormatter={(value) => `${round(Number(value), 3)}%`}
                  />
                }
              />
              <ReferenceLine
                y={SLA_TARGET}
                stroke="#f43f5e"
                strokeDasharray="4 4"
              />
              <Bar
                dataKey="uptimePct"
                name="Uptime"
                fill="#34d399"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Site breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead className="text-right">Devices</TableHead>
                <TableHead className="text-right">Incidents</TableHead>
                <TableHead className="text-right">Uptime</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sla.sites.map((site) => (
                <TableRow key={site.site}>
                  <TableCell className="font-medium">{site.site}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {site.devices}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {site.incidents}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {round(site.uptimePct, 3)}%
                  </TableCell>
                  <TableCell className="text-right">
                    {site.uptimePct >= SLA_TARGET ? (
                      <span className="text-xs font-medium text-success">
                        Meeting SLA
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-warning">
                        Below target
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Devices below target</CardTitle>
        </CardHeader>
        <CardContent>
          {belowTarget.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Every simulated device is meeting the {SLA_TARGET}% uptime target.
            </p>
          ) : (
            <div className="space-y-2">
              {belowTarget.slice(0, 12).map(({ device, uptimePct }) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-2.5"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Activity className="size-4 shrink-0 text-warning" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {device.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {device.site}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {device.status === 'offline' ? (
                      <SeverityBadge severity="critical" />
                    ) : null}
                    <span className="font-mono text-sm tabular-nums">
                      {round(uptimePct, 3)}%
                    </span>
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
