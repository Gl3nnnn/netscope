import { useState } from 'react'
import type { DeviceType, Severity } from '@/types'
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
  ACTION_LABELS,
  TRIGGER_LABELS,
  type Playbook,
  type PlaybookAction,
  type PlaybookActionKind,
  type PlaybookTrigger,
  type PlaybookTriggerKind,
} from '@/lib/playbooks'
import { DEVICE_TYPE_LABELS, SEVERITY_LABELS } from '@/lib/health'

const DEVICE_TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']
const TRIGGERS: PlaybookTriggerKind[] = ['offline', 'saturation', 'alert']
const ALL_ACTIONS: PlaybookActionKind[] = [
  'notify',
  'acknowledge',
  'remediate',
  'maintenance',
  'tag',
]

const COOLDOWNS: { value: number; label: string }[] = [
  { value: 0, label: 'No cooldown' },
  { value: 60_000, label: '1 minute' },
  { value: 120_000, label: '2 minutes' },
  { value: 300_000, label: '5 minutes' },
  { value: 900_000, label: '15 minutes' },
]

const ANY = '__any__'

interface FormState {
  name: string
  description: string
  enabled: boolean
  triggerKind: PlaybookTriggerKind
  minSeverity: Severity
  site: string
  type: DeviceType | typeof ANY
  actions: PlaybookActionKind[]
  tag: string
  note: string
  cooldownMs: number
}

function initialForm(playbook?: Playbook | null): FormState {
  if (playbook) {
    const kinds = playbook.actions.map((action) => action.kind)
    return {
      name: playbook.name,
      description: playbook.description,
      enabled: playbook.enabled,
      triggerKind: playbook.trigger.kind,
      minSeverity: playbook.trigger.minSeverity ?? 'high',
      site: playbook.trigger.site ?? ANY,
      type: playbook.trigger.type ?? ANY,
      actions: kinds,
      tag: playbook.actions.find((a) => a.kind === 'tag')?.value ?? '',
      note: playbook.actions.find((a) => a.kind === 'notify')?.value ?? '',
      cooldownMs: playbook.cooldownMs,
    }
  }
  return {
    name: '',
    description: '',
    enabled: true,
    triggerKind: 'offline',
    minSeverity: 'high',
    site: ANY,
    type: ANY,
    actions: ['notify'],
    tag: '',
    note: '',
    cooldownMs: 120_000,
  }
}

interface PlaybookFormProps {
  playbook?: Playbook | null
  sites: string[]
  onSubmit: (draft: Omit<Playbook, 'id'>) => void
  onCancel: () => void
}

function PlaybookForm({
  playbook,
  sites,
  onSubmit,
  onCancel,
}: PlaybookFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(playbook))
  const [error, setError] = useState<string | null>(null)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const toggleAction = (kind: PlaybookActionKind) =>
    setForm((current) => ({
      ...current,
      actions: current.actions.includes(kind)
        ? current.actions.filter((item) => item !== kind)
        : [...current.actions, kind],
    }))

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Give the playbook a name.')
      return
    }
    if (form.actions.length === 0) {
      setError('Select at least one action.')
      return
    }
    if (form.actions.includes('tag') && !form.tag.trim()) {
      setError('Enter a tag name for the tag action.')
      return
    }
    const trigger: PlaybookTrigger = { kind: form.triggerKind }
    if (form.triggerKind === 'alert') trigger.minSeverity = form.minSeverity
    if (form.site !== ANY) trigger.site = form.site
    if (form.type !== ANY) trigger.type = form.type

    const actions: PlaybookAction[] = form.actions.map((kind) => {
      if (kind === 'tag') return { kind, value: form.tag.trim() }
      if (kind === 'notify' && form.note.trim())
        return { kind, value: form.note.trim() }
      return { kind }
    })

    onSubmit({
      name: form.name.trim(),
      description: form.description.trim(),
      enabled: form.enabled,
      trigger,
      actions,
      cooldownMs: form.cooldownMs,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>{playbook ? 'Edit playbook' : 'New playbook'}</DialogTitle>
        <DialogDescription>
          Playbooks react to firing alerts or raw device conditions and run a
          small set of actions. Maintenance windows suppress them.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="pb-name">Name</Label>
        <Input
          id="pb-name"
          value={form.name}
          onChange={(event) => {
            update('name', event.target.value)
            setError(null)
          }}
          placeholder="Escalate router outages"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pb-desc">Description</Label>
        <Input
          id="pb-desc"
          value={form.description}
          onChange={(event) => update('description', event.target.value)}
          placeholder="What this playbook does"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="pb-trigger">Trigger</Label>
          <Select
            value={form.triggerKind}
            onValueChange={(value) =>
              update('triggerKind', value as PlaybookTriggerKind)
            }
          >
            <SelectTrigger id="pb-trigger">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGERS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {TRIGGER_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pb-severity">Min severity</Label>
          <Select
            value={form.minSeverity}
            onValueChange={(value) => update('minSeverity', value as Severity)}
            disabled={form.triggerKind !== 'alert'}
          >
            <SelectTrigger id="pb-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((severity) => (
                <SelectItem key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pb-cooldown">Cooldown</Label>
          <Select
            value={String(form.cooldownMs)}
            onValueChange={(value) => update('cooldownMs', Number(value))}
          >
            <SelectTrigger id="pb-cooldown">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COOLDOWNS.map((item) => (
                <SelectItem key={item.value} value={String(item.value)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pb-site">Site scope</Label>
          <Select
            value={form.site}
            onValueChange={(value) => update('site', value)}
          >
            <SelectTrigger id="pb-site">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any site</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site} value={site}>
                  {site}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pb-type">Type scope</Label>
          <Select
            value={form.type}
            onValueChange={(value) =>
              update('type', value as DeviceType | typeof ANY)
            }
          >
            <SelectTrigger id="pb-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any type</SelectItem>
              {DEVICE_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {DEVICE_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/20 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Actions
        </p>
        <div className="space-y-2">
          {ALL_ACTIONS.map((kind) => {
            const active = form.actions.includes(kind)
            return (
              <div
                key={kind}
                className="flex items-center justify-between gap-3"
              >
                <Label className="text-sm font-normal">
                  {ACTION_LABELS[kind]}
                </Label>
                <Switch
                  checked={active}
                  onCheckedChange={() => {
                    toggleAction(kind)
                    setError(null)
                  }}
                  aria-label={ACTION_LABELS[kind]}
                />
              </div>
            )
          })}
        </div>
        {form.actions.includes('tag') ? (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="pb-tag" className="text-xs">
              Tag name
            </Label>
            <Input
              id="pb-tag"
              value={form.tag}
              onChange={(event) => update('tag', event.target.value)}
              placeholder="auto-remediated"
            />
          </div>
        ) : null}
        {form.actions.includes('notify') ? (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="pb-note" className="text-xs">
              Note (optional)
            </Label>
            <Input
              id="pb-note"
              value={form.note}
              onChange={(event) => update('note', event.target.value)}
              placeholder="Investigate link saturation"
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
        <div>
          <Label className="text-sm">Enabled</Label>
          <p className="text-xs text-muted-foreground">
            Disabled playbooks are never planned.
          </p>
        </div>
        <Switch
          checked={form.enabled}
          onCheckedChange={(checked) => update('enabled', checked)}
          aria-label="Enabled"
        />
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {playbook ? 'Save changes' : 'Create playbook'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface PlaybookEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  playbook?: Playbook | null
  sites: string[]
  onSubmit: (draft: Omit<Playbook, 'id'>) => void
}

export function PlaybookEditorDialog({
  open,
  onOpenChange,
  playbook,
  sites,
  onSubmit,
}: PlaybookEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <PlaybookForm
            playbook={playbook}
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
