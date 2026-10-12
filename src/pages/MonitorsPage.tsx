import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ExternalLink,
  Gauge,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Monitor } from '@/lib/monitors'
import { MONITOR_STATUS_LABELS, uptimePct } from '@/lib/monitors'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { MonitorEditorDialog } from '@/components/monitors/MonitorEditorDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { useMonitorsStore } from '@/store/useMonitorsStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import { deviceSites } from '@/lib/devices'
import { formatClock, formatPct, round } from '@/lib/format'
import { elapsedMs, formatAge } from '@/lib/time'

const STATUS_DOT: Record<string, string> = {
  up: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
}

const STATUS_BADGE: Record<string, 'success' | 'warning' | 'destructive'> = {
  up: 'success',
  degraded: 'warning',
  down: 'destructive',
}

export function MonitorsPage() {
  const monitors = useMonitorsStore((state) => state.monitors)
  const checks = useMonitorsStore((state) => state.checks)
  const addMonitor = useMonitorsStore((state) => state.addMonitor)
  const updateMonitor = useMonitorsStore((state) => state.updateMonitor)
  const deleteMonitor = useMonitorsStore((state) => state.deleteMonitor)
  const resetMonitors = useMonitorsStore((state) => state.resetMonitors)

  const devices = useNetworkStore((state) => state.devices)
  const now = useNetworkStore((state) => state.lastTick)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Monitor | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Monitor | null>(null)

  const sites = useMemo(() => deviceSites(devices), [devices])
  const deviceById = useMemo(
    () => new Map(devices.map((device) => [device.id, device])),
    [devices],
  )

  const lastResult = (monitor: Monitor) =>
    (checks[monitor.id] ?? []).at(-1) ?? null

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (monitor: Monitor) => {
    setEditing(monitor)
    setDialogOpen(true)
  }

  const handleSubmit = (draft: Parameters<typeof addMonitor>[0]) => {
    if (editing) {
      updateMonitor(editing.id, draft)
      toast.success('Monitor updated')
    } else {
      addMonitor(draft)
      toast.success('Monitor created')
    }
  }

  const describeTarget = (monitor: Monitor) => {
    if (monitor.target === 'fleet') return 'Entire fleet'
    if (monitor.target === 'device') {
      const device = deviceById.get(monitor.targetId ?? '')
      return device ? `${device.name}` : 'Unknown device'
    }
    return `Site ${monitor.targetId}`
  }

  const downCount = monitors.filter(
    (monitor) => lastResult(monitor)?.status === 'down',
  ).length
  const degradedCount = monitors.filter(
    (monitor) => lastResult(monitor)?.status === 'degraded',
  ).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Synthetic monitors"
        description="Probes run against the simulated fleet and feed the public status page."
        actions={
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="sm">
              <Link to="/status">
                <ExternalLink className="size-4" /> Status page
              </Link>
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" /> New monitor
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Monitors"
          value={String(monitors.length)}
          icon={ShieldCheck}
        />
        <StatCard
          label="Operational"
          value={String(monitors.length - downCount - degradedCount)}
          icon={Gauge}
          accent="text-success"
        />
        <StatCard
          label="Degraded"
          value={String(degradedCount)}
          icon={Gauge}
          accent="text-warning"
        />
        <StatCard
          label="Outage"
          value={String(downCount)}
          icon={Gauge}
          accent="text-destructive"
        />
      </div>

      {monitors.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No monitors"
          description="Create a synthetic monitor to start probing the fleet."
          action={
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" /> New monitor
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetMonitors()
                toast.success('Restored default monitors')
              }}
            >
              <RotateCcw className="size-4" /> Reset to defaults
            </Button>
          </div>
          {monitors.map((monitor) => {
            const result = lastResult(monitor)
            const uptime = uptimePct(checks[monitor.id] ?? [])
            return (
              <Card key={monitor.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`size-2.5 rounded-full ${
                          result
                            ? STATUS_DOT[result.status]
                            : 'bg-muted-foreground/40'
                        }`}
                        aria-hidden
                      />
                      <p className="font-medium">{monitor.name}</p>
                      {result ? (
                        <Badge variant={STATUS_BADGE[result.status]}>
                          {MONITOR_STATUS_LABELS[result.status]}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Awaiting first check</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {describeTarget(monitor)} · probes every{' '}
                      {round(monitor.intervalMs / 1000, 0)}s · latency threshold{' '}
                      {monitor.latencyThresholdMs}ms · loss{' '}
                      {monitor.lossThresholdPct}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result ? (
                        <>
                          Last check {formatClock(result.at)} -{' '}
                          {round(result.latencyMs, 1)}ms,{' '}
                          {formatPct(result.lossPct, 2)} loss · uptime{' '}
                          {uptime === null ? '-' : formatPct(uptime, 1)} over{' '}
                          {formatAge(elapsedMs(result.at, now))}
                        </>
                      ) : (
                        'No checks recorded yet - the next tick runs a probe.'
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={monitor.enabled}
                        onCheckedChange={(value) =>
                          updateMonitor(monitor.id, { enabled: value })
                        }
                        aria-label={`Toggle ${monitor.name}`}
                      />
                      {monitor.enabled ? 'Enabled' : 'Paused'}
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(monitor)}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(monitor)}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <MonitorEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        monitor={editing}
        devices={devices}
        sites={sites}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete synthetic monitor"
        description={
          pendingDelete
            ? `Remove "${pendingDelete.name}" and stop probing it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) {
            deleteMonitor(pendingDelete.id)
            toast.success('Monitor deleted')
          }
        }}
      />
    </div>
  )
}
