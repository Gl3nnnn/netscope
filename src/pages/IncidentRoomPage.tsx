import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  ArrowLeft,
  CheckCheck,
  CircleCheck,
  Clock,
  Download,
  History,
  MessageSquarePlus,
  Radio,
  Server,
  ShieldAlert,
  Trash2,
  Waypoints,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import type { TimelineEvent } from '@/types'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import {
  SeverityBadge,
  StatusBadge,
  StatusDot,
} from '@/components/common/Badges'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useIncidentNotesStore } from '@/store/useIncidentNotesStore'
import { useReplayStore } from '@/store/useReplayStore'
import { useServicesStore } from '@/store/useServicesStore'
import { buildIncidentRoom, type CausalEntry } from '@/lib/warroom'
import {
  SERVICE_IMPACT_LABELS,
  SERVICE_TIER_LABELS,
  incidentBusinessImpact,
} from '@/lib/services'
import { reportToJson, reportToMarkdown } from '@/lib/report'
import { downloadText, fileDateStamp } from '@/lib/download'
import { SEVERITY_LABELS } from '@/lib/health'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { formatAge } from '@/lib/time'
import { cn } from '@/lib/utils'

const STATUS_VARIANT = {
  open: 'destructive',
  acknowledged: 'info',
  resolved: 'success',
} as const

function causalIcon(entry: CausalEntry) {
  if (entry.kind === 'note') return MessageSquarePlus
  return EVENT_ICON[entry.type]
}

const EVENT_ICON: Record<TimelineEvent['type'], typeof Radio> = {
  status: Radio,
  incident: ShieldAlert,
  device: Server,
  config: Wrench,
}

const EVENT_ACCENT: Record<TimelineEvent['type'], string> = {
  status: 'text-sky-500 bg-sky-500/10',
  incident: 'text-destructive bg-destructive/10',
  device: 'text-amber-500 bg-amber-500/10',
  config: 'text-violet-500 bg-violet-500/10',
}

export function IncidentRoomPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const incidents = useNetworkStore((state) => state.incidents)
  const devices = useNetworkStore((state) => state.devices)
  const events = useNetworkStore((state) => state.events)
  const history = useNetworkStore((state) => state.history)
  const faults = useNetworkStore((state) => state.faults)
  const now = useNetworkStore((state) => state.lastTick)
  const acknowledgeIncident = useNetworkStore(
    (state) => state.acknowledgeIncident,
  )
  const resolveIncident = useNetworkStore((state) => state.resolveIncident)
  const runRemediation = useNetworkStore((state) => state.runRemediation)

  const notes = useIncidentNotesStore((state) => state.notes)
  const addNote = useIncidentNotesStore((state) => state.addNote)
  const deleteNote = useIncidentNotesStore((state) => state.deleteNote)
  const services = useServicesStore((state) => state.services)

  const [draft, setDraft] = useState('')

  const incident = useMemo(
    () => incidents.find((item) => item.id === id),
    [incidents, id],
  )

  const businessImpact = useMemo(
    () => (incident ? incidentBusinessImpact(incident, services, devices) : []),
    [incident, services, devices],
  )

  const room = useMemo(() => {
    if (!incident) return null
    return buildIncidentRoom({
      incident,
      devices,
      events,
      history,
      faults,
      notes,
      now,
    })
  }, [incident, devices, events, history, faults, notes, now])

  if (!incident || !room) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Incident not found"
        description="It may have been cleared. Head back to the incident list."
        action={
          <Button asChild variant="outline">
            <Link to="/incidents">Back to incidents</Link>
          </Button>
        }
      />
    )
  }

  const causeName =
    room.rootCauses.length > 0
      ? (devices.find((device) => device.id === room.rootCauses[0].deviceId)
          ?.name ?? room.rootCauses[0].deviceId)
      : null

  const exportReport = (format: 'md' | 'json') => {
    const stamp = fileDateStamp(now)
    if (format === 'json') {
      downloadText(
        `postmortem-${incident.id}-${stamp}.json`,
        reportToJson(room.report),
        'application/json',
      )
    } else {
      downloadText(
        `postmortem-${incident.id}-${stamp}.md`,
        reportToMarkdown(room.report),
        'text/markdown',
      )
    }
    toast.success('Postmortem exported')
  }

  const openReplay = () => {
    useReplayStore.getState().seekToTime(incident.createdAt)
    navigate('/replay')
  }

  const submitNote = (event: FormEvent) => {
    event.preventDefault()
    if (!draft.trim()) return
    addNote(incident.id, draft)
    setDraft('')
    toast.success('Update added to incident room')
  }

  const running = incident.status !== 'resolved'

  const actions = (
    <>
      <Button variant="ghost" size="sm" asChild>
        <Link to="/incidents">
          <ArrowLeft className="size-4" /> Incidents
        </Link>
      </Button>
      <Button variant="outline" size="sm" onClick={openReplay}>
        <History className="size-4" /> Time Machine
      </Button>
      {running && room.runbook.autoRemediable ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            runRemediation(incident.id)
            toast.success(`Runbook applied: ${room.runbook.title}`)
          }}
        >
          <Wrench className="size-4" /> Apply runbook
        </Button>
      ) : null}
      {incident.status === 'open' ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            acknowledgeIncident(incident.id)
            toast.success('Incident acknowledged')
          }}
        >
          <CheckCheck className="size-4" /> Acknowledge
        </Button>
      ) : null}
      {running ? (
        <Button
          size="sm"
          onClick={() => {
            resolveIncident(incident.id)
            toast.success('Incident resolved')
          }}
        >
          <CircleCheck className="size-4" /> Resolve
        </Button>
      ) : null}
    </>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title={incident.title}
        description={`Incident command center · opened ${formatDateTime(
          incident.createdAt,
        )}`}
        actions={actions}
      />

      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={incident.severity} />
        <Badge variant={STATUS_VARIANT[incident.status]} className="capitalize">
          {incident.status}
        </Badge>
        {causeName ? (
          <Badge variant="warning" className="gap-1">
            <Waypoints className="size-3" /> Probable cause: {causeName}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Severity"
          value={SEVERITY_LABELS[incident.severity]}
          icon={ShieldAlert}
          accent="text-destructive"
        />
        <StatCard
          label="Status"
          value={incident.status}
          icon={Activity}
          accent="text-primary"
        />
        <StatCard
          label={running ? 'Open for' : 'Duration'}
          value={formatAge(room.ageMs)}
          icon={Clock}
          accent="text-amber-500"
        />
        <StatCard
          label="Affected devices"
          value={`${room.impactedDevices.length}`}
          icon={Server}
          hint={`${room.causalChain.length} timeline entries`}
          accent="text-sky-500"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="size-4 text-primary" /> Causal timeline
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Events and operator updates merged into a single chronological
                narrative for this incident.
              </p>
            </CardHeader>
            <CardContent>
              {room.causalChain.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No events recorded yet. Updates you add will appear here.
                </p>
              ) : (
                <ol className="space-y-3">
                  {room.causalChain.map((entry) => {
                    const Icon = causalIcon(entry)
                    return (
                      <li key={entry.id} className="flex gap-3">
                        <span
                          className={cn(
                            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
                            EVENT_ACCENT[entry.type],
                          )}
                        >
                          <Icon className="size-3.5" />
                        </span>
                        <div className="min-w-0 flex-1 border-b border-border/50 pb-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(entry.at)}
                            </span>
                            {entry.kind === 'note' ? (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                {entry.author}
                              </Badge>
                            ) : null}
                            {entry.deviceId ? (
                              <Badge variant="outline" className="text-[10px]">
                                {devices.find((d) => d.id === entry.deviceId)
                                  ?.name ?? entry.deviceId}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-sm">{entry.message}</p>
                          {entry.kind === 'note' ? (
                            <button
                              type="button"
                              onClick={() => deleteNote(entry.id.slice(5))}
                              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-3" /> Delete
                            </button>
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Waypoints className="size-4 text-amber-500" /> Blast radius
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Dependent devices downstream of the probable root cause that are
                not yet directly affected.
              </p>
            </CardHeader>
            <CardContent>
              {room.blastRadius.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No downstream dependencies at risk.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {room.blastRadius.map((device) => (
                    <Link key={device.id} to={`/devices/${device.id}`}>
                      <Badge
                        variant="outline"
                        className="gap-1.5 hover:border-primary"
                      >
                        <StatusDot status={device.status} />
                        {device.name}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Impact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {room.impactedDevices.map((device) => (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2"
                >
                  <Link
                    to={`/devices/${device.id}`}
                    className="min-w-0 truncate text-sm font-medium hover:underline"
                  >
                    {device.name}
                  </Link>
                  <StatusBadge status={device.status} />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Business impact</CardTitle>
              <p className="text-xs text-muted-foreground">
                Customer-visible services touched by this incident.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {businessImpact.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No mapped business services are affected.
                </p>
              ) : (
                businessImpact.map((entry) => (
                  <div
                    key={entry.serviceId}
                    className="rounded-md border border-border/60 bg-card/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {entry.serviceName}
                      </span>
                      <Badge variant="warning">
                        {SERVICE_TIER_LABELS[entry.tier]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {SERVICE_IMPACT_LABELS[entry.impact]} ·{' '}
                      {entry.affectedDeviceIds.length} device(s)
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Key metrics</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <Metric
                label="Peak latency"
                value={`${room.report.metrics.peakLatencyMs} ms`}
              />
              <Metric
                label="Peak loss"
                value={`${room.report.metrics.peakPacketLossPct}%`}
              />
              <Metric
                label="Min availability"
                value={`${room.report.metrics.minAvailabilityPct}%`}
              />
              <Metric
                label="Samples"
                value={`${room.report.metrics.sampleCount}`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Runbook</CardTitle>
              <p className="text-xs text-muted-foreground">
                {room.runbook.title}
              </p>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
                {room.runbook.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquarePlus className="size-4" /> Comms log
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitNote} className="space-y-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Post a status update to the room…"
                  rows={3}
                  className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {
                      notes.filter((note) => note.incidentId === incident.id)
                        .length
                    }{' '}
                    update(s)
                  </span>
                  <Button type="submit" size="sm" disabled={!draft.trim()}>
                    Add update
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => exportReport('md')}
            >
              <Download className="size-4" /> Markdown
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => exportReport('json')}
            >
              <Download className="size-4" /> JSON
            </Button>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Opened {formatRelativeTime(incident.createdAt, now)} · updated{' '}
        {formatRelativeTime(incident.updatedAt, now)}
      </p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}
