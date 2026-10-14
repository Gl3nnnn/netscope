import { useEffect, useMemo } from 'react'
import {
  Crosshair,
  Globe2,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Target,
  Ban,
  EyeOff,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/format'
import {
  PHASE_LABELS,
  TECHNIQUES,
  attackHeatmap,
  evaluateSecurity,
  securityScore,
  securitySummary,
  topTargets,
  type Disposition,
  type SecurityEvent,
} from '@/lib/security'
import { buildFlows } from '@/lib/flow'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSecurityStore } from '@/store/useSecurityStore'
import { useSettingsStore } from '@/store/useSettingsStore'

const GRADE_ACCENT: Record<'secure' | 'at-risk' | 'critical', string> = {
  secure: 'text-success',
  'at-risk': 'text-warning',
  critical: 'text-destructive',
}

const GRADE_LABEL = {
  secure: 'Secure',
  'at-risk': 'At risk',
  critical: 'Critical',
} as const

function severityTint(severity: SecurityEvent['severity']): string {
  switch (severity) {
    case 'critical':
      return 'border-destructive/60 bg-destructive/15'
    case 'high':
      return 'border-warning/60 bg-warning/15'
    case 'medium':
      return 'border-warning/40 bg-warning/5'
    default:
      return 'border-border/60 bg-muted/40'
  }
}

function DispositionBadge({ disposition }: { disposition: Disposition }) {
  if (disposition === 'contained') {
    return <Badge variant="success">Contained</Badge>
  }
  if (disposition === 'false-positive') {
    return <Badge variant="secondary">False positive</Badge>
  }
  return <Badge variant="outline">Open</Badge>
}

export function SecurityPage() {
  const devices = useNetworkStore((state) => state.devices)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const seed = useNetworkStore((state) => state.seed)
  const incidentFrequency = useSettingsStore((state) => state.incidentFrequency)

  const events = useSecurityStore((state) => state.events)
  const setEvents = useSecurityStore((state) => state.setEvents)
  const setDisposition = useSecurityStore((state) => state.setDisposition)

  // Recompute detections whenever the fleet advances. Dispositions are
  // re-applied inside setEvents, so containment survives a re-evaluation.
  useEffect(() => {
    if (devices.length === 0) return
    const flows = buildFlows(devices, seed)
    const detected = evaluateSecurity({
      devices,
      flows,
      now: lastTick,
      seed,
      intensity: incidentFrequency,
      existing: events,
    })
    setEvents(detected)
    // `events` intentionally omitted: including it would re-run on every
    // containment click. Dispositions are read from the store inside setEvents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, lastTick, seed, incidentFrequency, setEvents])

  const summary = useMemo(() => securitySummary(events), [events])
  const score = useMemo(() => securityScore(events), [events])
  const targets = useMemo(() => topTargets(events, 6), [events])
  const heat = useMemo(() => attackHeatmap(events), [events])

  const openEvents = useMemo(
    () => events.filter((event) => event.disposition === 'open'),
    [events],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Security Operations"
          description="Simulated SOC detections mapped to MITRE ATT&CK."
        />
        <EmptyState
          icon={ShieldCheck}
          title="No fleet to protect"
          description="Seed the fleet to start generating security detections."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Security Operations"
        description="Deterministic SOC detections derived from your fleet, flows and geography, mapped to the MITRE ATT&CK framework."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Security score"
          value={`${summary.score}`}
          icon={summary.grade === 'secure' ? ShieldCheck : ShieldAlert}
          accent={GRADE_ACCENT[summary.grade]}
          hint={GRADE_LABEL[summary.grade]}
        />
        <StatCard
          label="Open detections"
          value={`${summary.open}`}
          icon={Radar}
          accent={summary.open > 0 ? 'text-warning' : 'text-success'}
          hint={`${summary.contained} contained`}
        />
        <StatCard
          label="Critical / high"
          value={`${score.openBySeverity.critical} / ${score.openBySeverity.high}`}
          icon={ShieldAlert}
          accent={
            score.openBySeverity.critical > 0
              ? 'text-destructive'
              : 'text-success'
          }
          hint="open by severity"
        />
        <StatCard
          label="Most-attacked technique"
          value={score.topTechnique ? score.topTechnique.mitre : '—'}
          icon={Target}
          hint={
            score.topTechnique ? score.topTechnique.label : 'no open findings'
          }
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Crosshair className="size-4 text-primary" />
            MITRE ATT&amp;CK heat map
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Open detections grouped by kill-chain phase and technique.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {heat.map((cell) => {
            const meta = TECHNIQUES[cell.technique]
            const empty = cell.count === 0
            return (
              <div
                key={cell.technique}
                title={`${PHASE_LABELS[cell.phase]} · ${meta.label} (${meta.mitre}) — ${cell.count} open`}
                className={`min-w-[8.5rem] rounded-lg border p-2.5 ${
                  empty
                    ? 'border-border/50 opacity-50'
                    : severityTint(cell.worstSeverity)
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tabular-nums">
                    {meta.mitre}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {cell.count}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {meta.label}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                  {PHASE_LABELS[cell.phase]}
                </p>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="size-4 text-primary" />
              Top targeted devices
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {targets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open detections right now.
              </p>
            ) : (
              targets.map((target) => (
                <div
                  key={target.deviceId}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SeverityBadge severity={target.worstSeverity} />
                    <span className="truncate">{target.deviceName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {target.site}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {target.count} open
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="size-4 text-primary" />
              Origin vs target
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Source → destination for the highest-confidence open detections.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {openEvents.slice(0, 6).map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate font-mono text-xs">
                  {event.srcIp} → {event.dstIp}
                  {event.dstPort > 0 ? `:${event.dstPort}` : ''}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {(event.confidence * 100).toFixed(0)}% · {event.count}
                </span>
              </div>
            ))}
            {openEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open detections to show.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="size-4 text-primary" />
            Threat feed
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {summary.total} detections · {summary.open} open ·{' '}
            {summary.falsePositives} marked false positive
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {events.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              No detections for the current fleet. Try seeding more devices or
              raising the incident frequency in Settings.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {events.slice(0, 40).map((event) => {
                const meta = TECHNIQUES[event.technique]
                return (
                  <div
                    key={event.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3"
                  >
                    <SeverityBadge severity={event.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {meta.label}
                        </span>
                        <Badge
                          variant="outline"
                          className="font-mono text-[10px]"
                        >
                          {meta.mitre}
                        </Badge>
                        <span className="truncate text-xs text-muted-foreground">
                          {event.deviceName} · {event.site}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {event.srcIp} → {event.dstIp}
                        {event.dstPort > 0 ? `:${event.dstPort}` : ''} ·{' '}
                        {event.count} events ·{' '}
                        {formatRelativeTime(event.lastSeen, lastTick)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <DispositionBadge disposition={event.disposition} />
                      {event.disposition === 'open' ? (
                        <>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              setDisposition(event.id, 'contained')
                            }
                          >
                            <Ban className="size-3.5" />
                            Contain
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setDisposition(event.id, 'false-positive')
                            }
                          >
                            <EyeOff className="size-3.5" />
                            False positive
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
