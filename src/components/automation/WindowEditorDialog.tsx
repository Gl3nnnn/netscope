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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { MaintenanceWindow } from '@/lib/playbooks'

const ANY = '__any__'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Epoch ms -> value for a `datetime-local` input (local time). */
function toLocalInput(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `datetime-local` value -> epoch ms (local time), or NaN if invalid. */
function fromLocalInput(value: string): number {
  const parsed = new Date(value)
  return parsed.getTime()
}

interface WindowFormProps {
  window?: MaintenanceWindow | null
  sites: string[]
  devices: Device[]
  now: number
  onSubmit: (draft: Omit<MaintenanceWindow, 'id'>) => void
  onCancel: () => void
}

function WindowForm({
  window,
  sites,
  devices,
  now,
  onSubmit,
  onCancel,
}: WindowFormProps) {
  const [name, setName] = useState(window?.name ?? 'Maintenance window')
  const [site, setSite] = useState(window?.site ?? ANY)
  const [deviceIds, setDeviceIds] = useState<string[]>(window?.deviceIds ?? [])
  const [startsAt, setStartsAt] = useState(
    toLocalInput(window?.startsAt ?? now),
  )
  const [endsAt, setEndsAt] = useState(
    toLocalInput(window?.endsAt ?? now + 60 * 60 * 1000),
  )
  const [suppressAlerts, setSuppressAlerts] = useState(
    window?.suppressAlerts ?? true,
  )
  const [error, setError] = useState<string | null>(null)

  const toggleDevice = (id: string) =>
    setDeviceIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('Give the window a name.')
      return
    }
    const start = fromLocalInput(startsAt)
    const end = fromLocalInput(endsAt)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setError('Enter valid start and end times.')
      return
    }
    if (end <= start) {
      setError('End time must be after the start time.')
      return
    }
    if (site === ANY && deviceIds.length === 0) {
      setError('Scope the window to a site or at least one device.')
      return
    }
    onSubmit({
      name: name.trim(),
      site: site === ANY ? null : site,
      deviceIds,
      startsAt: start,
      endsAt: end,
      suppressAlerts,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {window ? 'Edit maintenance window' : 'New maintenance window'}
        </DialogTitle>
        <DialogDescription>
          Devices inside an active window are flagged in-maintenance and
          suppressed from alerting and automation.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="win-name">Name</Label>
        <Input
          id="win-name"
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="win-site">Site scope</Label>
        <Select
          value={site}
          onValueChange={(value) => {
            setSite(value)
            setError(null)
          }}
        >
          <SelectTrigger id="win-site">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>No site (pick devices)</SelectItem>
            {sites.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          Devices ({deviceIds.length} selected)
        </Label>
        <div className="max-h-40 overflow-y-auto rounded-md border border-border/60 p-2">
          {devices.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              No devices available.
            </p>
          ) : (
            devices.map((device) => (
              <label
                key={device.id}
                className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40"
              >
                <span>
                  {device.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {device.site}
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={deviceIds.includes(device.id)}
                  onChange={() => toggleDevice(device.id)}
                />
              </label>
            ))
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="win-start">Starts</Label>
          <Input
            id="win-start"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => {
              setStartsAt(event.target.value)
              setError(null)
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="win-end">Ends</Label>
          <Input
            id="win-end"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => {
              setEndsAt(event.target.value)
              setError(null)
            }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div>
          <Label className="text-sm">Suppress alerts</Label>
          <p className="text-xs text-muted-foreground">
            Skip alerting and automation for scoped devices during the window.
          </p>
        </div>
        <Switch
          checked={suppressAlerts}
          onCheckedChange={setSuppressAlerts}
          aria-label="Suppress alerts"
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {window ? 'Save changes' : 'Create window'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface WindowEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  window?: MaintenanceWindow | null
  sites: string[]
  devices: Device[]
  now: number
  onSubmit: (draft: Omit<MaintenanceWindow, 'id'>) => void
}

export function WindowEditorDialog({
  open,
  onOpenChange,
  window,
  sites,
  devices,
  now,
  onSubmit,
}: WindowEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open ? (
          <WindowForm
            window={window}
            sites={sites}
            devices={devices}
            now={now}
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
