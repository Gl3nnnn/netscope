import { useMemo, useState } from 'react'
import { CheckCheck, CircleCheck, ShieldAlert, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import type { Incident, Severity } from '@/types'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { SeverityBadge } from '@/components/common/Badges'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
