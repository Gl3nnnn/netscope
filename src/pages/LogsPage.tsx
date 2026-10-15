import { useMemo, useState } from 'react'
import {
  ListTree,
  Pause,
  Play,
  Search,
  ScrollText,
  TriangleAlert,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatPct, formatRelativeTime } from '@/lib/format'
import {
  LOG_LEVELS,
  LOG_LEVEL_LABELS,
  LOG_WINDOW_MS,
  generateLogs,
  levelHistogram,
  isEmptyQuery,
  logSummary,
  parseLogQuery,
  queryLogs,
  topPatterns,
  topSources,
  type LogEntry,
  type LogLevel,
} from '@/lib/logs'
import { useNetworkStore } from '@/store/useNetworkStore'

const LEVEL_VARIANT: Record<
  LogLevel,
  'destructive' | 'warning' | 'info' | 'secondary' | 'outline'
> = {
  critical: 'destructive',
  error: 'destructive',
  warning: 'warning',
  notice: 'info',
  info: 'secondary',
  debug: 'outline',
}

/** Tail-bar colours, most severe first. */
const LEVEL_BAR: Record<LogLevel, string> = {
  critical: 'bg-destructive',
  error: 'bg-destructive/60',
  warning: 'bg-warning',
  notice: 'bg-info/70',
  info: 'bg-info/40',
  debug: 'bg-muted-foreground/40',
}

const RENDER_LIMIT = 150
const BUCKET_MS = 3 * 60_000

function toggleLevel(levels: LogLevel[], level: LogLevel): LogLevel[] {
  return levels.includes(level)
    ? levels.filter((item) => item !== level)
    : [...levels, level]
}

export function LogsPage() {
  const devices = useNetworkStore((state) => state.devices)
  const events = useNetworkStore((state) => state.events)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const seed = useNetworkStore((state) => state.seed)

  const [rawQuery, setRawQuery] = useState('')
  const [levels, setLevels] = useState<LogLevel[]>([])
  const [frozen, setFrozen] = useState<LogEntry[] | null>(null)

  // Quantise the tick so the tail only regenerates once a minute: live, but
  // readable while you scroll.
  const windowMinute = Math.floor(lastTick / 60_000)
  const now = windowMinute * 60_000

  const generated = useMemo(
    () => generateLogs({ devices, events, now, seed }),
    [devices, events, now, seed],
  )
  const logs = frozen ?? generated

  const query = useMemo(() => {
    const parsed = parseLogQuery(rawQuery)
    if (levels.length > 0) {
      parsed.levels = [...new Set([...parsed.levels, ...levels])]
    }
    return parsed
  }, [rawQuery, levels])

  const visible = useMemo(() => queryLogs(logs, query), [logs, query])
  const summary = useMemo(() => logSummary(visible), [visible])
  const patterns = useMemo(() => topPatterns(visible, 6), [visible])
  const sources = useMemo(() => topSources(visible, 6), [visible])
  const buckets = useMemo(
    () => levelHistogram(visible, now - LOG_WINDOW_MS, now, BUCKET_MS),
    [visible, now],
  )
  const peak = useMemo(
    () => buckets.reduce((max, bucket) => Math.max(max, bucket.total), 0),
    [buckets],
  )

  if (devices.length === 0 && events.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Logs"
          description="Syslog-style event stream with pattern clustering."
        />
        <EmptyState
          icon={ScrollText}
          title="No log sources"
          description="Seed the fleet to start emitting log lines."
        />
      </div>
    )
  }

  const rows = [...visible].reverse()
  const shown = rows.slice(0, RENDER_LIMIT)
  const paused = frozen !== null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Logs"
        description="Simulated syslog tail: timeline events plus per-device application lines, clustered into patterns and searchable with level:/site:/device:/facility: filters."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFrozen(paused ? null : generated)}
          >
            {paused ? (
              <>
                <Play className="size-3.5" /> Resume tail
              </>
            ) : (
              <>
                <Pause className="size-3.5" /> Pause tail
              </>
            )}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Lines in view"
          value={summary.total.toLocaleString()}
          icon={ListTree}
          hint={`${logs.length} in the 30 min tail`}
        />
        <StatCard
          label="Error ratio"
          value={formatPct(summary.errorRatio * 100, 1)}
          icon={TriangleAlert}
          accent={
            summary.errorRatio > 0.25
              ? 'text-destructive'
              : summary.errorRatio > 0.1
                ? 'text-warning'
                : 'text-success'
          }
          hint={`${summary.errorCount} errors · ${summary.warningCount} warnings`}
        />
        <StatCard
          label="Critical lines"
          value={summary.byLevel.critical.toLocaleString()}
          icon={ScrollText}
          accent={
            summary.byLevel.critical > 0 ? 'text-destructive' : 'text-success'
          }
          hint="map to high-severity incidents"
        />
        <StatCard
          label="Distinct patterns"
          value={patterns.length.toString()}
          icon={Search}
          hint={
            sources.length > 0 ? `busiest: ${sources[0]!.name}` : 'no sources'
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTree className="size-4 text-primary" />
            Volume by severity
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            3-minute buckets across the last 30 minutes · hover a column for
            counts.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-24 items-end gap-1.5">
            {buckets.map((bucket) => (
              <div
                key={bucket.t}
                className="flex h-full flex-1 cursor-default flex-col justify-end overflow-hidden rounded-sm bg-muted/60"
                title={`${bucket.total} lines`}
              >
                {[...LOG_LEVELS].reverse().map((level) =>
                  bucket.counts[level] > 0 ? (
                    <div
                      key={level}
                      className={LEVEL_BAR[level]}
                      style={{
                        height: `${peak > 0 ? (bucket.counts[level] / peak) * 100 : 0}%`,
                      }}
                      title={`${LOG_LEVEL_LABELS[level]}: ${bucket.counts[level]}`}
                    />
                  ) : null,
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {[...LOG_LEVELS].reverse().map((level) => (
              <span
                key={level}
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              >
                <span className={`size-2 rounded-full ${LEVEL_BAR[level]}`} />
                {LOG_LEVEL_LABELS[level]} · {summary.byLevel[level]}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={rawQuery}
                onChange={(event) => setRawQuery(event.target.value)}
                placeholder="level:error facility:bgp site:hq neighbor"
                className="pl-9 font-mono text-xs"
                aria-label="Search logs"
              />
            </div>
            {LOG_LEVELS.map((level) => {
              const active = levels.includes(level)
              return (
                <Button
                  key={level}
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  onClick={() =>
                    setLevels((current) => toggleLevel(current, level))
                  }
                >
                  {LOG_LEVEL_LABELS[level]}
                </Button>
              )
            })}
            {!isEmptyQuery(query) || levels.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRawQuery('')
                  setLevels([])
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ScrollText className="size-4 text-primary" />
              Stream
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {summary.total} matching · newest first
              {paused ? ' · frozen (paused)' : ''}
            </p>
          </CardHeader>
          <CardContent className="space-y-1">
            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No log lines match this query.
              </p>
            ) : (
              shown.map((entry) => (
                <div
                  key={entry.id}
                  className="grid grid-cols-[auto_auto_1fr] items-start gap-x-3 gap-y-0.5 border-b border-border/40 py-1.5 text-xs last:border-0"
                >
                  <span className="tabular-nums text-muted-foreground">
                    {formatRelativeTime(entry.t, lastTick)}
                  </span>
                  <Badge
                    variant={LEVEL_VARIANT[entry.severity]}
                    className="text-[10px]"
                  >
                    {entry.severity}
                  </Badge>
                  <span className="min-w-0">
                    <span className="text-muted-foreground">
                      {entry.deviceName}
                      <span className="opacity-60"> · {entry.site}</span>
                      <span className="ml-2 rounded bg-muted px-1 py-0.5 text-[10px]">
                        {entry.process}
                      </span>
                    </span>
                    <span className="block break-words font-mono text-[11px]">
                      {entry.message}
                    </span>
                  </span>
                </div>
              ))
            )}
            {rows.length > shown.length ? (
              <p className="pt-1 text-center text-[11px] text-muted-foreground">
                showing {shown.length} of {rows.length} matching lines
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListTree className="size-4 text-primary" />
                Top patterns
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Message templates after token normalisation.
              </p>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {patterns.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No patterns in the current selection.
                </p>
              ) : (
                patterns.map((pattern) => (
                  <div key={pattern.fingerprint} className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-mono text-[11px]">
                        {pattern.template}
                      </span>
                      <Badge
                        variant={LEVEL_VARIANT[pattern.severity]}
                        className="shrink-0 text-[10px]"
                      >
                        ×{pattern.count}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {LOG_LEVEL_LABELS[pattern.severity]} · last seen{' '}
                      {formatRelativeTime(pattern.lastSeen, lastTick)}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="size-4 text-primary" />
                Top sources
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sources.map((source) => {
                const share =
                  summary.total > 0 ? source.count / summary.total : 0
                return (
                  <div key={source.name} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium">
                        {source.name}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {source.count} ({formatPct(share * 100, 0)})
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.round(share * 100)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
