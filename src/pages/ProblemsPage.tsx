import { useMemo } from 'react'
import {
  BellRing,
  CheckCheck,
  GitMerge,
  Layers,
  Siren,
  TrendingDown,
  Unlink,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct, formatRelativeTime } from '@/lib/format'
import {
  SIGNAL_LABELS,
  correlate,
  correlationSummary,
  withAcknowledged,
  type AcknowledgedProblem,
} from '@/lib/correlation'
import { useAlertsStore } from '@/store/useAlertsStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useProblemStore } from '@/store/useProblemStore'
import { useServicesStore } from '@/store/useServicesStore'

const PROBLEM_LIMIT = 30
const SINGLE_LIMIT = 12

function confidenceTone(confidence: number): string {
  if (confidence >= 0.75) return 'bg-success'
  if (confidence >= 0.55) return 'bg-warning'
  return 'bg-muted-foreground'
}

function ProblemCard({
  problem,
  lastTick,
  onAcknowledge,
}: {
  problem: AcknowledgedProblem
  lastTick: number
  onAcknowledge: (problem: AcknowledgedProblem) => void
}) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <SeverityBadge severity={problem.severity} />
            <span className="text-sm font-semibold">{problem.title}</span>
            <Badge variant="outline" className="text-[10px]">
              {SIGNAL_LABELS[problem.kind]}
            </Badge>
            <Badge variant="secondary" className="text-[10px]">
              {problem.members.length} signals
            </Badge>
          </div>
          {problem.acknowledgedAt !== null ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-success">
              <CheckCheck className="size-3.5" />
              acknowledged{' '}
              {formatRelativeTime(problem.acknowledgedAt, lastTick)}
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 text-[11px]"
              onClick={() => onAcknowledge(problem)}
            >
              <CheckCheck className="size-3" /> Acknowledge
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {problem.signals.map((kind) => (
            <Badge key={kind} variant="outline" className="text-[10px]">
              {SIGNAL_LABELS[kind]}
            </Badge>
          ))}
          {problem.site ? (
            <Badge variant="outline" className="text-[10px]">
              site · {problem.site}
            </Badge>
          ) : null}
        </div>

        {problem.rootCause ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Root cause:</span>{' '}
            {problem.rootCause.deviceName}{' '}
            <span className="tabular-nums">
              ({(problem.rootCause.score * 100).toFixed(0)}% score)
            </span>
            {problem.rootCause.evidence[0] ? (
              <span className="block text-[11px]">
                {problem.rootCause.evidence.slice(0, 2).join(' · ')}
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="space-y-1">
          {problem.members.map((member) => (
            <div
              key={`${member.source}-${member.id}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
            >
              {member.source === 'alert' ? (
                <BellRing className="size-3.5 shrink-0 text-warning" />
              ) : (
                <Siren className="size-3.5 shrink-0 text-destructive" />
              )}
              <span className="font-medium">{member.label}</span>
              <span className="truncate text-muted-foreground">
                {member.deviceName}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                {formatRelativeTime(member.startedAt, lastTick)}
              </span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
            confidence
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full ${confidenceTone(problem.confidence)}`}
              style={{ width: `${Math.round(problem.confidence * 100)}%` }}
            />
          </span>
          <span className="w-8 shrink-0 text-right text-[11px] tabular-nums">
            {formatPct(problem.confidence * 100, 0)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProblemsPage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const states = useAlertsStore((state) => state.states)
  const services = useServicesStore((state) => state.services)
  const acks = useProblemStore((state) => state.acks)
  const acknowledge = useProblemStore((state) => state.acknowledge)

  const alerts = useMemo(() => Object.values(states), [states])
  const result = useMemo(
    () => correlate({ devices, alerts, incidents, services, now: lastTick }),
    [devices, alerts, incidents, services, lastTick],
  )
  const problems = useMemo(
    () => withAcknowledged(result.problems, acks),
    [result, acks],
  )
  const summary = useMemo(() => correlationSummary(result), [result])

  const maxSignalCount = useMemo(
    () => Math.max(1, ...Object.values(summary.signalCounts)),
    [summary],
  )

  if (summary.inputs === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Problems"
          description="AIOps correlation of alerts and incidents."
        />
        <EmptyState
          icon={Unlink}
          title="No active signals"
          description="Correlation runs on firing alerts and open incidents — enable alert rules or wait for an incident."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Problems"
        description="Firing alerts and open incidents grouped into problems via shared device, topology proximity (≤2 hops), shared site and shared business service inside a 5-minute window, with dependency-graph root-cause ranking."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Noise reduction"
          value={`${summary.reductionPct}%`}
          icon={TrendingDown}
          accent={
            summary.reductionPct >= 50
              ? 'text-success'
              : summary.reductionPct >= 25
                ? 'text-warning'
                : summary.singles === summary.inputs
                  ? 'text-destructive'
                  : 'text-info'
          }
          hint={`${summary.problems} problems from ${summary.inputs} signals`}
        />
        <StatCard
          label="Problems"
          value={`${summary.problems}`}
          icon={GitMerge}
          accent={summary.critical > 0 ? 'text-destructive' : 'text-success'}
          hint={`${summary.critical} critical`}
        />
        <StatCard
          label="Signals absorbed"
          value={`${summary.absorbedPct}%`}
          icon={Layers}
          hint={`${summary.grouped} grouped · ${summary.meanMembers} avg`}
        />
        <StatCard
          label="Uncorrelated singles"
          value={`${summary.singles}`}
          icon={Unlink}
          accent={summary.singles > 0 ? 'text-warning' : 'text-success'}
          hint="signals with no group"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {problems.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No correlations right now — {summary.singles} signals remain
                uncorrelated. The stream is quiet enough that everything is a
                single.
              </CardContent>
            </Card>
          ) : (
            problems
              .slice(0, PROBLEM_LIMIT)
              .map((problem) => (
                <ProblemCard
                  key={problem.id}
                  problem={problem}
                  lastTick={lastTick}
                  onAcknowledge={acknowledge}
                />
              ))
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-primary" />
                Signal mix
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Which rules bound each problem.
              </p>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {(
                Object.keys(SIGNAL_LABELS) as Array<keyof typeof SIGNAL_LABELS>
              ).map((kind) => {
                const count = summary.signalCounts[kind]
                return (
                  <div key={kind} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span>{SIGNAL_LABELS[kind]}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {count}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{
                          width: `${Math.round((count / maxSignalCount) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Unlink className="size-4 text-warning" />
                Uncorrelated singles
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {summary.singles} signals that matched nothing else.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {summary.singles === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Everything on the stream is part of a problem.
                </p>
              ) : (
                result.singles.slice(0, SINGLE_LIMIT).map((single) => (
                  <div
                    key={`${single.source}-${single.id}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <SeverityBadge severity={single.severity} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {single.label}
                        </span>
                        <span className="block truncate text-muted-foreground">
                          {single.deviceName}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatRelativeTime(single.startedAt, lastTick)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
