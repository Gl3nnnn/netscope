import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCheck,
  CircleCheck,
  ShieldAlert,
  ShieldCheck,
  Waypoints,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Incident, Severity } from '@/types'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { SeverityBadge } from '@/components/common/Badges'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNetworkStore } from '@/store/useNetworkStore'
import { buildGraph, correlateRootCause } from '@/lib/dependency'
import { SEVERITY_LABELS } from '@/lib/health'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { elapsedMs, formatAge } from '@/lib/time'

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

const STATUS_VARIANT = {
  open: 'destructive',
  acknowledged: 'info',
  resolved: 'success',
} as const

export function IncidentsPage() {
  const incidents = useNetworkStore((state) => state.incidents)
  const devices = useNetworkStore((state) => state.devices)
  const now = useNetworkStore((state) => state.lastTick)
  const acknowledgeIncident = useNetworkStore(
    (state) => state.acknowledgeIncident,
  )
  const resolveIncident = useNetworkStore((state) => state.resolveIncident)
  const clearResolvedIncidents = useNetworkStore(
    (state) => state.clearResolvedIncidents,
  )

  const [severity, setSeverity] = useState<Severity | 'all'>('all')

  const deviceName = useMemo(
    () => new Map(devices.map((device) => [device.id, device.name])),
    [devices],
  )

  const impacted = useMemo(
    () => devices.filter((device) => device.status !== 'online'),
    [devices],
  )

  const rootCauses = useMemo(() => {
    if (impacted.length === 0) return []
    return correlateRootCause({
      devices,
      graph: buildGraph(devices),
      affected: impacted.map((device) => device.id),
      limit: 3,
    })
  }, [devices, impacted])

  const filter = (list: Incident[]) =>
    list
      .filter(
        (incident) => severity === 'all' || incident.severity === severity,
      )
      .sort((a, b) => b.createdAt - a.createdAt)

  const active = useMemo(
    () =>
      filter(incidents.filter((incident) => incident.status !== 'resolved')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidents, severity],
  )

  const resolved = useMemo(
    () =>
      filter(incidents.filter((incident) => incident.status === 'resolved')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incidents, severity],
  )

  const severityFilter = (
    <div className="w-44">
      <Select
        value={severity}
        onValueChange={(value) => setSeverity(value as Severity | 'all')}
      >
        <SelectTrigger aria-label="Filter by severity">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All severities</SelectItem>
          {SEVERITIES.map((item) => (
            <SelectItem key={item} value={item}>
              {SEVERITY_LABELS[item]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )

  const renderIncident = (incident: Incident) => (
    <Card key={incident.id}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{incident.title}</p>
              <Badge
                variant={STATUS_VARIANT[incident.status]}
                className="capitalize"
              >
                {incident.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {incident.description}
            </p>
          </div>
          <SeverityBadge severity={incident.severity} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Affected:</span>
          {incident.deviceIds.map((id) => (
            <Badge key={id} variant="outline">
              {deviceName.get(id) ?? 'Deleted device'}
            </Badge>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
          <div className="space-y-0.5">
            <p>Opened {formatDateTime(incident.createdAt)}</p>
            {incident.status !== 'resolved' ? (
              <p>Open for {formatAge(elapsedMs(incident.createdAt, now))}</p>
            ) : null}
            <p>Updated {formatRelativeTime(incident.updatedAt)}</p>
            {incident.acknowledgedAt ? (
              <p>Acknowledged {formatRelativeTime(incident.acknowledgedAt)}</p>
            ) : null}
            {incident.resolvedAt ? (
              <p>
                Resolved after{' '}
                {formatAge(elapsedMs(incident.createdAt, incident.resolvedAt))}
              </p>
            ) : null}
          </div>

          {incident.status !== 'resolved' ? (
            <div className="flex gap-2">
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
              <Button
                size="sm"
                onClick={() => {
                  resolveIncident(incident.id)
                  toast.success('Incident resolved')
                }}
              >
                <CircleCheck className="size-4" /> Resolve
              </Button>
            </div>
          ) : (
            <Badge variant="success" className="gap-1">
              <ShieldCheck className="size-3" /> Resolved
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Incidents"
        description="Simulated incidents with acknowledgement and resolution workflow."
        actions={severityFilter}
      />

      {rootCauses.length > 0 ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Waypoints className="size-4 text-amber-500" />
              Probable root cause
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Ranked by how much of the {impacted.length} impacted device
              {impacted.length === 1 ? '' : 's'} sit inside each node&apos;s
              downstream blast radius.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {rootCauses.map((cause, index) => (
              <div
                key={cause.deviceId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-semibold text-amber-500">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {deviceName.get(cause.deviceId) ?? cause.deviceId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cause.evidence[0]}
                    </p>
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to={`/devices/${cause.deviceId}`}>Inspect</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">
            Active
            {active.length > 0 ? (
              <span className="ml-2 rounded-full bg-destructive/20 px-1.5 text-xs text-destructive">
                {active.length}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved
            {resolved.length > 0 ? (
              <span className="ml-2 rounded-full bg-success/20 px-1.5 text-xs text-success">
                {resolved.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3">
          {active.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No active incidents"
              description="The simulated fleet is operating within thresholds."
            />
          ) : (
            active.map(renderIncident)
          )}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-3">
          {resolved.length > 0 ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearResolvedIncidents()
                  toast.success('Cleared resolved incidents')
                }}
              >
                Clear resolved
              </Button>
            </div>
          ) : null}
          {resolved.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No resolved incidents"
              description="Resolved and auto-recovered incidents will appear here."
            />
          ) : (
            resolved.map(renderIncident)
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
