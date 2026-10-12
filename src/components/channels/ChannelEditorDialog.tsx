import { useState } from 'react'
import type { Severity } from '@/types'
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
import {
  CHANNEL_KIND_LABELS,
  CHANNEL_SEVERITIES,
  type ChannelKind,
  type NotificationChannel,
} from '@/lib/channels'
import { SEVERITY_LABELS } from '@/lib/health'

const KINDS = Object.keys(CHANNEL_KIND_LABELS) as ChannelKind[]

interface FormState {
  name: string
  kind: ChannelKind
  target: string
  minSeverity: Severity
  enabled: boolean
  escalate: boolean
}

function initialForm(channel?: NotificationChannel | null): FormState {
  if (channel) {
    return {
      name: channel.name,
      kind: channel.kind,
      target: channel.target,
      minSeverity: channel.minSeverity,
      enabled: channel.enabled,
      escalate: channel.escalate,
    }
  }
  return {
    name: '',
    kind: 'slack',
    target: '',
    minSeverity: 'high',
    enabled: true,
    escalate: false,
  }
}

interface ChannelFormProps {
  channel?: NotificationChannel | null
  onSubmit: (draft: Omit<NotificationChannel, 'id'>) => void
  onCancel: () => void
}

function ChannelForm({ channel, onSubmit, onCancel }: ChannelFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(channel))
  const [error, setError] = useState<string | null>(null)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Name the channel.')
      return
    }
    if (!form.target.trim()) {
      setError('Provide a destination.')
      return
    }
    onSubmit({
      name: form.name.trim(),
      kind: form.kind,
      target: form.target.trim(),
      minSeverity: form.minSeverity,
      enabled: form.enabled,
      escalate: form.escalate,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>
          {channel ? 'Edit notification channel' : 'New notification channel'}
        </DialogTitle>
        <DialogDescription>
          Channels receive firing alerts at or above their minimum severity.
          Escalation pages flagged channels once an alert stays critical.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="channel-name">Name</Label>
          <Input
            id="channel-name"
            value={form.name}
            onChange={(event) => {
              update('name', event.target.value)
              setError(null)
            }}
            placeholder="Platform on-call"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="channel-kind">Type</Label>
          <Select
            value={form.kind}
            onValueChange={(value) => update('kind', value as ChannelKind)}
          >
            <SelectTrigger id="channel-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {CHANNEL_KIND_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="channel-target">Destination</Label>
        <Input
          id="channel-target"
          value={form.target}
          onChange={(event) => {
            update('target', event.target.value)
            setError(null)
          }}
          placeholder="ops@netscope.demo or a webhook URL"
          className="font-mono"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="channel-severity">Minimum severity</Label>
          <Select
            value={form.minSeverity}
            onValueChange={(value) => update('minSeverity', value as Severity)}
          >
            <SelectTrigger id="channel-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_SEVERITIES.map((severity) => (
                <SelectItem key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col justify-center gap-3 pt-2">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Enabled</span>
            <Switch
              checked={form.enabled}
              onCheckedChange={(value) => update('enabled', value)}
              aria-label="Toggle channel enabled"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Page on final escalation</span>
            <Switch
              checked={form.escalate}
              onCheckedChange={(value) => update('escalate', value)}
              aria-label="Toggle escalation paging"
            />
          </label>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {channel ? 'Save changes' : 'Create channel'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface ChannelEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  channel?: NotificationChannel | null
  onSubmit: (draft: Omit<NotificationChannel, 'id'>) => void
}

export function ChannelEditorDialog({
  open,
  onOpenChange,
  channel,
  onSubmit,
}: ChannelEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <ChannelForm
            channel={channel}
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
