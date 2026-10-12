import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Activity, BellRing, LogOut, Network, ShieldAlert } from 'lucide-react'
import type { Device, Incident } from '@/types'
import type { AlertInstance } from '@/lib/alerts'
import { firingAlerts } from '@/lib/alerts'
import { nextRotation } from '@/lib/rotator'
import {
  aggregateHistory,
  averageAvailability,
  averageLatency,
  averagePacketLoss,
  statusCounts,
} from '@/lib/aggregate'
import { utilizationPct } from '@/lib/capacity'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useAlertsStore } from '@/store/useAlertsStore'
import { SeverityBadge, StatusDot } from '@/components/common/Badges'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import {
  formatClock,
  formatMbps,
  formatMs,
  formatPct,
  round,
} from '@/lib/format'
import { cn } from '@/lib/utils'

const PANEL_MS = 15_000
const PANEL_COUNT = 4

export function WallboardPage() {
  const navigate = useNavigate()
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const history = useNetworkStore((state) => state.history)
  const alertStates = useAlertsStore((state) => state.states)

  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = window.setInterval(
      () => setIndex((current) => nextRotation(current, PANEL_COUNT)),
      PANEL_MS,
    )
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key.toLowerCase() === 'w') {
        navigate('/')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  const firing = useMemo(() => firingAlerts(alertStates), [alertStates])
  const openIncidents = useMemo(
    () => incidents.filter((incident) => incident.status !== 'resolved'),
    [incidents],
  )
  const series = useMemo(
    () => aggregateHistory(devices, history).slice(-40),
    [devices, history],
  )
  const counts = useMemo(() => statusCounts(devices), [devices])
  const topUtil = useMemo(
    () =>
      [...devices]
        .sort(
          (a, b) =>
            utilizationPct(b.throughputMbps, b.capacityMbps) -
            utilizationPct(a.throughputMbps, a.capacityMbps),
        )
        .slice(0, 6),
    [devices],
  )

  const panels = [
    <FleetOverview
      key="fleet"
      devices={devices}
      counts={counts}
      incidents={openIncidents.length}
      alerts={firing.length}
    />,
    <ThroughputPanel key="throughput" series={series} />,
    <TopUtilPanel key="util" devices={topUtil} />,
    <WorkPanel key="work" incidents={openIncidents} alerts={firing} />,
  ]

  const labels = [
    'Fleet overview',
    'Throughput trend',
    'Top utilisation',
    'Incidents & alerts',
  ]

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b border-border/70 px-5 py-3">
        <div className="flex items-center gap-2">
          <Network className="size-5 text-primary" />
          <span className="text-sm font-semibold uppercase tracking-wide">
            NetScope NOC
          </span>
        </div>
        <span className="hidden text-sm text-muted-foreground md:inline">
          {labels[index]}
        </span>
        <div className="ml-auto flex items-center gap-4">
          <span className="flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs font-medium">
            <span className="size-2 rounded-full bg-success" /> Live
          </span>
          <Clock />
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <LogOut className="size-3.5" /> Exit
          </Link>
        </div>
      </header>

      <div className="flex items-center gap-2 px-5 py-2">
        {labels.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Show ${label}`}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors',
              i === index
                ? 'bg-primary'
                : 'bg-muted hover:bg-muted-foreground/40',
            )}
          />
        ))}
      </div>

      <main
        key={index}
        className="flex-1 animate-fade-in overflow-hidden px-5 pb-5"
      >
        {panels[index]}
      </main>

      <div className="px-5 pb-3">
        <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            key={index}
            className="h-full animate-rotate-progress bg-primary"
            style={{ animationDuration: `${PANEL_MS}ms` }}
          />
        </div>
      </div>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <span className="hidden font-mono text-sm text-muted-foreground sm:inline">
      {formatClock(now)}
    </span>
  )
}

function BigStat({
  label,
  value,
  hint,
  tone = 'text-foreground',
}: {
  label: string
  value: string
  hint?: string
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/40 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-2 text-4xl font-semibold tabular-nums', tone)}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function FleetOverview({
  devices,
  counts,
  incidents,
  alerts,
}: {
  devices: Device[]
  counts: Record<string, number>
  incidents: number
  alerts: number
}) {
  const availability = averageAvailability(devices)
  const latency = averageLatency(devices)
  const loss = averagePacketLoss(devices)
  return (
    <div className="grid h-full grid-cols-2 gap-4 lg:grid-cols-3">
      <BigStat
        label="Availability"
        value={formatPct(availability, 2)}
        hint={`${devices.length} devices monitored`}
        tone={availability >= 99 ? 'text-success' : 'text-warning'}
      />
      <BigStat label="Avg latency" value={formatMs(latency)} />
      <BigStat
        label="Packet loss"
        value={formatPct(loss, 2)}
        tone={loss > 2 ? 'text-warning' : 'text-foreground'}
      />
      <BigStat
        label="Devices online"
        value={`${counts.online}/${devices.length}`}
        hint={`${counts.degraded} degraded · ${counts.offline} offline`}
        tone={counts.offline > 0 ? 'text-destructive' : 'text-success'}
      />
      <BigStat
        label="Open incidents"
        value={String(incidents)}
        tone={incidents > 0 ? 'text-warning' : 'text-success'}
      />
      <BigStat
        label="Firing alerts"
        value={String(alerts)}
        tone={alerts > 0 ? 'text-destructive' : 'text-success'}
      />
    </div>
  )
}

function ThroughputPanel({
  series,
}: {
  series: ReturnType<typeof aggregateHistory>
}) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="size-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Fleet throughput
        </h2>
      </div>
      <div className="min-h-0 flex-1">
        {series.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Waiting for telemetry...
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series}>
              <defs>
                <linearGradient id="wbThr" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0.5}
                  />
                  <stop
                    offset="100%"
                    stopColor="hsl(var(--primary))"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="t"
                tickFormatter={(value) => formatClock(value)}
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
                    valueFormatter={(value) => formatMbps(Number(value))}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="throughputMbps"
                name="Throughput"
                stroke="hsl(var(--primary))"
                fill="url(#wbThr)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function TopUtilPanel({ devices }: { devices: Device[] }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border/70 bg-card/40 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="size-4 text-warning" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Top utilisation
        </h2>
      </div>
      <div className="space-y-3">
        {devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No devices.</p>
        ) : (
          devices.map((device) => {
            const util = utilizationPct(
              device.throughputMbps,
              device.capacityMbps,
            )
            return (
              <div key={device.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusDot status={device.status} />
                    <span className="truncate font-medium">{device.name}</span>
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {round(util, 1)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      util >= 80
                        ? 'bg-destructive'
                        : util >= 60
                          ? 'bg-warning'
                          : 'bg-success',
                    )}
                    style={{ width: `${Math.min(100, util)}%` }}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function WorkPanel({
  incidents,
  alerts,
}: {
  incidents: Incident[]
  alerts: AlertInstance[]
}) {
  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-card/40 p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Open incidents
          </h2>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open incidents.</p>
          ) : (
            incidents.slice(0, 6).map((incident) => (
              <div
                key={incident.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm">
                  {incident.title}
                </span>
                <SeverityBadge severity={incident.severity} />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col rounded-xl border border-border/70 bg-card/40 p-5">
        <div className="mb-3 flex items-center gap-2">
          <BellRing className="size-4 text-destructive" />
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Firing alerts
          </h2>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts firing.</p>
          ) : (
            alerts.slice(0, 6).map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/40 px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm">
                  {alert.ruleName} · {alert.deviceName}
                </span>
                <SeverityBadge severity={alert.severity} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
