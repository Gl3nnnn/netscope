import { useState } from 'react'
import type { Device, DeviceInput, DeviceType } from '@/types'
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
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import { isValidIp, isValidMac } from '@/storage/persistence'

const TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]

interface FormState {
  name: string
  type: DeviceType
  site: string
  ip: string
  mac: string
  tags: string
}

function generateMac(): string {
  return Array.from({ length: 6 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  )
    .join(':')
    .toUpperCase()
}

function initialForm(device?: Device | null): FormState {
  if (device) {
    return {
      name: device.name,
      type: device.type,
      site: device.site,
      ip: device.ip,
      mac: device.mac,
      tags: device.tags.join(', '),
    }
  }
  return {
    name: '',
    type: 'server',
    site: '',
    ip: '',
    mac: generateMac(),
    tags: '',
  }
}

interface DeviceFormProps {
  device?: Device | null
  onSubmit: (input: DeviceInput) => void
  onCancel: () => void
}

/**
 * The form lives in its own component so that it remounts (and thus resets)
 * each time the dialog opens, avoiding state-syncing effects entirely.
 */
function DeviceForm({ device, onSubmit, onCancel }: DeviceFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(device))
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({})

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const validate = (): DeviceInput | null => {
    const next: Partial<Record<keyof FormState, string>> = {}
    if (!form.name.trim()) next.name = 'Name is required.'
    if (!form.site.trim()) next.site = 'Site is required.'
    if (!isValidIp(form.ip)) next.ip = 'Enter a valid IPv4 address.'
    if (form.mac.trim() && !isValidMac(form.mac)) {
      next.mac = 'Enter a valid MAC address (e.g. AA:BB:CC:DD:EE:FF).'
    }
    setErrors(next)
    if (Object.keys(next).length > 0) return null

    return {
      name: form.name.trim(),
      type: form.type,
      site: form.site.trim(),
      ip: form.ip.trim(),
      mac: form.mac.trim(),
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const input = validate()
    if (!input) return
    onSubmit(input)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>{device ? 'Edit device' : 'Add device'}</DialogTitle>
        <DialogDescription>
          Fields are validated before being saved to your inventory. Metrics for
          new devices are simulated automatically.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="device-name">Name</Label>
        <Input
          id="device-name"
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          aria-invalid={Boolean(errors.name)}
          placeholder="core-sw-01"
        />
        {errors.name ? (
          <p className="text-xs text-destructive">{errors.name}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="device-type">Type</Label>
          <Select
            value={form.type}
            onValueChange={(value) => update('type', value)}
          >
            <SelectTrigger id="device-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {DEVICE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="device-site">Site</Label>
          <Input
            id="device-site"
            value={form.site}
            onChange={(event) => update('site', event.target.value)}
            aria-invalid={Boolean(errors.site)}
            placeholder="Data Center A"
          />
          {errors.site ? (
            <p className="text-xs text-destructive">{errors.site}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="device-ip">IP address</Label>
          <Input
            id="device-ip"
            value={form.ip}
            onChange={(event) => update('ip', event.target.value)}
            aria-invalid={Boolean(errors.ip)}
            placeholder="10.0.0.10"
            className="font-mono"
          />
          {errors.ip ? (
            <p className="text-xs text-destructive">{errors.ip}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="device-mac">MAC address</Label>
          <Input
            id="device-mac"
            value={form.mac}
            onChange={(event) => update('mac', event.target.value)}
            aria-invalid={Boolean(errors.mac)}
            placeholder="AA:BB:CC:DD:EE:FF"
            className="font-mono"
          />
          {errors.mac ? (
            <p className="text-xs text-destructive">{errors.mac}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="device-tags">Tags</Label>
        <Input
          id="device-tags"
          value={form.tags}
          onChange={(event) => update('tags', event.target.value)}
          placeholder="core, production"
        />
        <p className="text-xs text-muted-foreground">
          Comma separated. Used for search and filtering.
        </p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{device ? 'Save changes' : 'Add device'}</Button>
      </DialogFooter>
    </form>
  )
}

interface DeviceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  device?: Device | null
  onSubmit: (input: DeviceInput) => void
}

export function DeviceFormDialog({
  open,
  onOpenChange,
  device,
  onSubmit,
}: DeviceFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <DeviceForm
            device={device}
            onSubmit={(input) => {
              onSubmit(input)
              onOpenChange(false)
            }}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
