import { useMemo, useState } from 'react'
import {
  Boxes,
  Briefcase,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useServicesStore, type ServiceDraft } from '@/store/useServicesStore'
import { deviceSites } from '@/lib/devices'
import { round } from '@/lib/format'
import {
  SERVICE_IMPACT_LABELS,
  SERVICE_STATUS_LABELS,
  SERVICE_TIER_LABELS,
  SERVICE_TIER_WEIGHT,
  businessImpactSummary,
  resolveServiceDevices,
  serviceHealthAll,
  serviceUptimePct,
  type BusinessService,
  type ServiceStatus,
} from '@/lib/services'
import { ServiceDialog } from '@/components/services/ServiceDialog'

const STATUS_VARIANT: Record<
  ServiceStatus,
  'success' | 'warning' | 'destructive' | 'info'
> = {
  operational: 'success',
  degraded: 'warning',
  partial: 'warning',
  outage: 'destructive',
}

export function ServicesPage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const history = useNetworkStore((state) => state.history)
  const thresholds = useSettingsStore((state) => state.thresholds)

  const services = useServicesStore((state) => state.services)
  const addService = useServicesStore((state) => state.addService)
  const updateService = useServicesStore((state) => state.updateService)
  const deleteService = useServicesStore((state) => state.deleteService)

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BusinessService | null>(null)

  const sites = deviceSites(devices)

  const healths = useMemo(
    () => serviceHealthAll({ services, devices, incidents, thresholds }),
    [services, devices, incidents, thresholds],
  )
  const healthById = useMemo(
    () => new Map(healths.map((health) => [health.serviceId, health])),
    [healths],
  )

  const summary = useMemo(
    () => businessImpactSummary({ services, devices, incidents, thresholds }),
    [services, devices, incidents, thresholds],
  )

  const sorted = useMemo(
    () =>
      [...services].sort(
        (a, b) =>
          SERVICE_TIER_WEIGHT[b.tier] - SERVICE_TIER_WEIGHT[a.tier] ||
          a.name.localeCompare(b.name),
      ),
    [services],
  )

  const statusOf = (service: BusinessService) =>
    healthById.get(service.id)?.status ?? 'operational'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Business Services"
        description="Map infrastructure to the customer-visible services it delivers, and see the business impact of every incident."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New service
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Services"
          value={`${summary.totalServices}`}
          icon={Briefcase}
        />
        <StatCard
          label="At risk"
          value={`${summary.atRisk}`}
          icon={ShieldAlert}
          accent={summary.atRisk > 0 ? 'text-warning' : 'text-success'}
        />
        <StatCard
          label="Major outages"
          value={`${summary.outage}`}
          icon={Boxes}
          accent={summary.outage > 0 ? 'text-destructive' : 'text-success'}
        />
        <StatCard
          label="Business risk"
          value={`${summary.score}`}
          hint={summary.label}
          icon={ShieldAlert}
          accent={summary.score > 0 ? 'text-warning' : 'text-success'}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Business impact</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{summary.label}</p>
          {summary.worst.length === 0 ? (
            <p className="text-sm text-success">
              All mapped services are operational.
            </p>
          ) : (
            <div className="space-y-2">
              {summary.worst.map((entry) => (
                <div
                  key={entry.serviceId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[entry.status]}>
                      {SERVICE_STATUS_LABELS[entry.status]}
                    </Badge>
                    <span className="font-medium">{entry.serviceName}</span>
                    <span className="text-xs text-muted-foreground">
                      {SERVICE_TIER_LABELS[entry.tier]} ·{' '}
                      {SERVICE_IMPACT_LABELS[entry.impact]}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {entry.affectedDeviceIds.length} device(s) impacted
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {services.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No services defined"
          description="Create your first business service to connect devices to outcomes."
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New service
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((service) => {
            const health = healthById.get(service.id)
            const status = statusOf(service)
            const members = resolveServiceDevices(service, devices)
            const uptime = serviceUptimePct(service, devices, history)
            return (
              <Card key={service.id} className="flex flex-col">
                <CardHeader className="space-y-2 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{service.name}</CardTitle>
                    <Badge variant={STATUS_VARIANT[status]}>
                      {SERVICE_STATUS_LABELS[status]}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {SERVICE_TIER_LABELS[service.tier]}
                    </Badge>
                    <Badge variant="secondary">
                      {SERVICE_IMPACT_LABELS[service.impact]}
                    </Badge>
                    {service.owner ? (
                      <span className="text-xs text-muted-foreground">
                        Owner: {service.owner}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {service.description}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Health</span>
                      <span>{round(health?.healthPct ?? 100, 1)}%</span>
                    </div>
                    <Progress value={health?.healthPct ?? 100} />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-md bg-muted/30 py-1.5">
                      <p className="font-semibold">{members.length}</p>
                      <p className="text-muted-foreground">devices</p>
                    </div>
                    <div className="rounded-md bg-muted/30 py-1.5">
                      <p className="font-semibold">{round(uptime, 2)}%</p>
                      <p className="text-muted-foreground">uptime</p>
                    </div>
                    <div className="rounded-md bg-muted/30 py-1.5">
                      <p className="font-semibold">
                        {health?.openIncidentIds.length ?? 0}
                      </p>
                      <p className="text-muted-foreground">incidents</p>
                    </div>
                  </div>

                  {health && health.offlineCount + health.degradedCount > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {health.onlineCount} online · {health.degradedCount}{' '}
                      degraded · {health.offlineCount} offline
                    </p>
                  ) : null}

                  {service.siteNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {service.siteNames.map((site) => (
                        <span
                          key={site}
                          className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {site}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(service)}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        deleteService(service.id)
                        toast.success('Service deleted')
                      }}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                    {health && health.openIncidentIds.length > 0 ? (
                      <span className="ml-auto text-xs text-warning">
                        {health.openIncidentIds.length} open
                      </span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ServiceDialog
        open={creating}
        onOpenChange={setCreating}
        sites={sites}
        title="New business service"
        onSubmit={(draft: ServiceDraft) => {
          addService(draft)
          toast.success('Service created')
        }}
      />

      {editing ? (
        <ServiceDialog
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          sites={sites}
          title="Edit business service"
          initial={{
            name: editing.name,
            description: editing.description,
            tier: editing.tier,
            impact: editing.impact,
            deviceIds: editing.deviceIds,
            siteNames: editing.siteNames,
            owner: editing.owner,
          }}
          onSubmit={(draft: ServiceDraft) => {
            updateService(editing.id, draft)
            toast.success('Service updated')
          }}
        />
      ) : null}

      {summary.worst.some((entry) => entry.status === 'outage') ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <SeverityBadge severity="critical" />
          One or more critical services are experiencing a major outage.
        </div>
      ) : null}
    </div>
  )
}
