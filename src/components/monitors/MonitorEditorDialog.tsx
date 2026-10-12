import { useState } from 'react'
import type { Device } from '@/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DEFAULT_MONITOR,
  MONITOR_INTERVAL_OPTIONS,
  type Monitor,
  type MonitorTargetKind,
  type NewMonitorInput,
} from '@/lib/monitors'

const ANY_DEVICE = '__fleet__'

const TARGET_LABELS: Record<MonitorTargetKind, string> = {
  fleet: 'Entire fleet',
  device: 'Single device',
  site: 'Site',
}

const INTERVAL_LABELS: Record<number, string> = {
  5_000: 'Every 5 seconds',
  10_000: 'Every 10 seconds',
  30_000: 'Every 30 seconds',
  60_000: 'Every minute',
}

interface FormState {
  name: string
  target: MonitorTargetKind
  targetId: string
  intervalMs: number
  latencyThresholdMs: string
  lossThresholdPct: string
}

function initialForm(monitor?: Monitor | null): FormState {
  if (monitor) {
    return {
      name: monitor.name,
      target: monitor.target,
      targetId: monitor.targetId ?? ANY_DEVICE,
      intervalMs: monitor.intervalMs,
      latencyThresholdMs: String(monitor.latencyThresholdMs),
      lossThresholdPct: String(monitor.lossThresholdPct),
    }
  }
  return {
    name: '',
    target: DEFAULT_MONITOR.target,
    targetId: ANY_DEVICE,
    intervalMs: DEFAULT_MONITOR.intervalMs,
    latencyThresholdMs: String(DEFAULT_MONITOR.latencyThresholdMs),
    lossThresholdPct: String(DEFAULT_MONITOR.lossThresholdPct),
  }
}

interface MonitorFormProps {
  monitor?: Monitor | null
  devices: Device[]
  sites: string[]
  onSubmit: (draft: NewMonitorInput) => void
  onCancel: () => void
}

function MonitorForm({
  monitor,
  devices,
  sites,
  onSubmit,
  onCancel,
}: MonitorFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(monitor))
  const [error, setError] = useState<string | null>(null)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const onTargetChange = (target: MonitorTargetKind) => {
    setForm((current) => ({
      ...current,
      target,
      targetId: target === 'fleet' ? ANY_DEVICE : current.targetId,
    }))
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Name the synthetic monitor.')
      return
    }
    const latencyThresholdMs = Number(form.latencyThresholdMs)
    const lossThresholdPct = Number(form.lossThresholdPct)
    if (
      !Number.isFinite(latencyThresholdMs) ||
      !Number.isFinite(lossThresholdPct)
    ) {
      setError('Thresholds must be numbers.')
      return
    }
    onSubmit({
      name: form.name.trim(),
      target: form.target,
      targetId: form.target === 'fleet' ? null : form.targetId,
      intervalMs: form.intervalMs,
      latencyThresholdMs,
      lossThresholdPct,
    })
  }

  const showTargetId = form.target !== 'fleet'
  const selectedId = form.targetId === ANY_DEVICE ? '' : form.targetId

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {monitor ? 'Edit synthetic monitor' : 'New synthetic monitor'}
        </DialogTitle>
        <DialogDescription>
          Probes the fleet on an interval and derives an operational posture
          from simulated latency, packet loss and availability.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="monitor-name">Name</Label>
        <Input
          id="monitor-name"
          value={form.name}
          onChange={(event) => {
            update('name', event.target.value)
            setError(null)
          }}
          placeholder="Checkout API"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="monitor-target">Target</Label>
          <Select
            value={form.target}
            onValueChange={(value) =>
              onTargetChange(value as MonitorTargetKind)
            }
          >
            <SelectTrigger id="monitor-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TARGET_LABELS) as MonitorTargetKind[]).map(
                (key) => (
                  <SelectItem key={key} value={key}>
                    {TARGET_LABELS[key]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="monitor-interval">Check interval</Label>
          <Select
            value={String(form.intervalMs)}
            onValueChange={(value) => update('intervalMs', Number(value))}
          >
            <SelectTrigger id="monitor-interval">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONITOR_INTERVAL_OPTIONS.map((ms) => (
                <SelectItem key={ms} value={String(ms)}>
                  {INTERVAL_LABELS[ms]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {showTargetId ? (
        <div className="space-y-1.5">
          <Label htmlFor="monitor-target-id">
            {form.target === 'device' ? 'Device' : 'Site'}
          </Label>
          {form.target === 'device' ? (
            <Select
              value={selectedId}
              onValueChange={(value) => update('targetId', value)}
            >
              <SelectTrigger id="monitor-target-id">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.id} value={device.id}>
                    {device.name} · {device.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={selectedId}
              onValueChange={(value) => update('targetId', value)}
            >
              <SelectTrigger id="monitor-target-id">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site} value={site}>
                    {site}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="monitor-latency">Latency threshold (ms)</Label>
          <Input
            id="monitor-latency"
            type="number"
            value={form.latencyThresholdMs}
            onChange={(event) =>
              update('latencyThresholdMs', event.target.value)
            }
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Above this, the monitor degrades.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="monitor-loss">Loss threshold (%)</Label>
          <Input
            id="monitor-loss"
            type="number"
            value={form.lossThresholdPct}
            onChange={(event) => update('lossThresholdPct', event.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            At or above this, the monitor is down.
          </p>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {monitor ? 'Save changes' : 'Create monitor'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface MonitorEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  monitor?: Monitor | null
  devices: Device[]
  sites: string[]
  onSubmit: (draft: NewMonitorInput) => void
}

export function MonitorEditorDialog({
  open,
  onOpenChange,
  monitor,
  devices,
  sites,
  onSubmit,
}: MonitorEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <MonitorForm
            monitor={monitor}
            devices={devices}
            sites={sites}
            onSubmit={(draft) => {
              onSubmit(draft)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
