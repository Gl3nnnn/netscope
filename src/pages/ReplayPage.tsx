import { useEffect, useMemo } from 'react'
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  TrendingUp,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge, StatusBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { ChartCard } from '@/components/charts/ChartCard'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import { diffFrames, incidentsOpenedIn, seekIncidentTime } from '@/lib/replay'
import { formatClock, formatPct, formatMs, formatDelta } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useReplayStore } from '@/store/useReplayStore'

const PLAY_INTERVAL_MS = 900

function toneClass(value: number, invert = false): string {
  if (value === 0) return 'text-muted-foreground'
  const bad = invert ? value > 0 : value < 0
  return bad ? 'text-destructive' : 'text-success'
}

export function ReplayPage() {
  const frames = useReplayStore((state) => state.frames)
  const index = useReplayStore((state) => state.index)
  const playing = useReplayStore((state) => state.playing)
  const setIndex = useReplayStore((state) => state.setIndex)
  const step = useReplayStore((state) => state.step)
  const play = useReplayStore((state) => state.play)
  const pause = useReplayStore((state) => state.pause)
  const advance = useReplayStore((state) => state.advance)
  const seekToTime = useReplayStore((state) => state.seekToTime)
  const clear = useReplayStore((state) => state.clear)

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      advance()
    }, PLAY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [playing, advance])

  const chartData = useMemo(
    () =>
      frames.map((frame) => ({
        t: frame.t,
        health: frame.health,
        util: frame.fleetUtilPct,
        incidents: frame.openIncidents,
      })),
    [frames],
  )

  if (frames.length < 2) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Time Machine"
          description="Scrub back through recent fleet history and diff any two moments."
        />
        <EmptyState
          icon={History}
          title="Recording the fleet"
          description="Time Machine captures a frame every tick. Leave the simulation running for a few seconds, then come back to scrub and replay."
        />
      </div>
    )
  }

  const safeIndex = Math.max(0, Math.min(frames.length - 1, index))
  const current = frames[safeIndex]!
  const previous = safeIndex > 0 ? frames[safeIndex - 1]! : null
  const diff = previous ? diffFrames(previous, current) : null
  const openedNow = incidentsOpenedIn(current, previous)
  const isLive = safeIndex === frames.length - 1

  return (
    <div className="space-y-5">
      <PageHeader
        title="Time Machine"
        description="Scrub back through recent fleet history, replay an incident and diff any two moments."
        actions={
          <Button variant="outline" onClick={clear}>
            <RotateCcw className="size-4" />
            Clear recording
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Jump to start"
              onClick={() => setIndex(0)}
            >
              <SkipBack className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous frame"
              onClick={() => step(-1)}
              disabled={safeIndex === 0}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              size="icon"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => (playing ? pause() : play())}
            >
              {playing ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next frame"
              onClick={() => step(1)}
              disabled={isLive}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Jump to live"
              onClick={() => setIndex(frames.length - 1)}
            >
              <SkipForward className="size-4" />
            </Button>
            <div className="ml-2 flex items-center gap-2 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              <span className="font-mono tabular-nums">
                {formatClock(current.t)}
              </span>
              <span className="text-xs text-muted-foreground">
                frame {safeIndex + 1}/{frames.length}
              </span>
              {isLive ? (
                <Badge variant="success" className="ml-1">
                  live
                </Badge>
              ) : (
                <Badge variant="warning" className="ml-1">
                  replay
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {formatClock(frames[0]!.t)}
            </span>
            <Slider
              value={[safeIndex]}
              min={0}
              max={frames.length - 1}
              step={1}
              onValueChange={([value]) => setIndex(value ?? 0)}
              aria-label="Replay position"
            />
            <span className="text-xs text-muted-foreground">
              {formatClock(frames[frames.length - 1]!.t)}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard
          label="Fleet health"
          value={String(current.health)}
          icon={Activity}
          hint={diff ? formatDelta(diff.health, ' pts') : undefined}
          accent={
            current.health >= 80
              ? 'text-success'
              : current.health >= 55
                ? 'text-warning'
                : 'text-destructive'
          }
        />
        <StatCard
          label="Open incidents"
          value={String(current.openIncidents)}
          icon={TrendingUp}
          hint={diff ? formatDelta(diff.openIncidents, '', 0) : undefined}
          accent={current.openIncidents > 0 ? 'text-warning' : 'text-success'}
        />
        <StatCard
          label="Offline"
          value={String(current.offlineCount)}
          icon={Activity}
          hint={diff ? formatDelta(diff.offlineCount, '', 0) : undefined}
          accent={
            current.offlineCount > 0 ? 'text-destructive' : 'text-success'
          }
        />
        <StatCard
          label="Fleet util"
          value={formatPct(current.fleetUtilPct, 1)}
          icon={Activity}
          hint={diff ? formatDelta(diff.fleetUtilPct, ' pts') : undefined}
        />
        <StatCard
          label="Avg latency"
          value={formatMs(current.avgLatencyMs)}
          icon={Activity}
          hint={diff ? formatDelta(diff.avgLatencyMs, ' ms') : undefined}
        />
      </div>

      <ChartCard
        title="Fleet timeline"
        description="Health score and utilisation across the recorded window"
        height={260}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
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
              width={40}
              domain={[0, 100]}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={
                <ChartTooltip
                  labelFormatter={(value) => formatClock(Number(value))}
                />
              }
            />
            <ReferenceLine x={current.t} stroke="hsl(var(--primary))" />
            <Line
              type="monotone"
              dataKey="health"
              name="Health"
              stroke="hsl(var(--success))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="util"
              name="Utilisation"
              stroke="hsl(var(--warning))"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Change vs previous frame
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!diff ? (
              <p className="text-sm text-muted-foreground">
                This is the earliest recorded frame — step forward to compare.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Health</p>
                    <p className={cn('tabular-nums', toneClass(diff.health))}>
                      {formatDelta(diff.health, ' pts')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Utilisation</p>
                    <p
                      className={cn(
                        'tabular-nums',
                        toneClass(diff.fleetUtilPct, true),
                      )}
                    >
                      {formatDelta(diff.fleetUtilPct, ' pts')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Avg latency</p>
                    <p
                      className={cn(
                        'tabular-nums',
                        toneClass(diff.avgLatencyMs, true),
                      )}
                    >
                      {formatDelta(diff.avgLatencyMs, ' ms')}
                    </p>
                  </div>
                </div>

                {diff.statusChanges.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No status changes in this step.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {diff.statusChanges.map((change) => (
                      <div
                        key={change.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="font-medium">{change.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {change.site}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          <StatusBadge status={change.statusFrom} />
                          <span className="text-muted-foreground">→</span>
                          <StatusBadge status={change.statusTo} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Incident replay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {openedNow.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Opened at this frame
                </p>
                {openedNow.map((incident) => (
                  <div
                    key={incident.id}
                    className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm"
                  >
                    <SeverityBadge severity={incident.severity} />
                    <span className="truncate font-medium">
                      {incident.title}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Incidents in this frame ({current.incidents.length})
              </p>
              {current.incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No incidents recorded at this moment.
                </p>
              ) : (
                current.incidents.slice(0, 6).map((incident) => (
                  <button
                    key={incident.id}
                    type="button"
                    onClick={() => seekToTime(incident.createdAt)}
                    className="flex w-full items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
                  >
                    <SeverityBadge severity={incident.severity} />
                    <span className="truncate">{incident.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {formatClock(incident.createdAt)}
                    </span>
                  </button>
                ))
              )}
            </div>

            {current.incidents.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => seekIncidentTime(frames, current.incidents[0]!)}
              >
                <History className="size-4" />
                Jump to first incident
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {diff && diff.metricChanges.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Biggest metric movers</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Device</th>
                    <th className="px-4 py-2 font-medium">Site</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Latency
                    </th>
                    <th className="px-4 py-2 text-right font-medium">
                      Throughput
                    </th>
                    <th className="px-4 py-2 text-right font-medium">CPU</th>
                    <th className="px-4 py-2 text-right font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.metricChanges.slice(0, 6).map((change) => (
                    <tr
                      key={change.id}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-4 py-2 font-medium">{change.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {change.site}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2 text-right tabular-nums',
                          toneClass(change.latencyMs, true),
                        )}
                      >
                        {formatDelta(change.latencyMs, ' ms')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {formatDelta(change.throughputMbps, ' Mbps')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {formatDelta(change.cpuPct, '%')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {formatDelta(change.memoryPct, '%')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
