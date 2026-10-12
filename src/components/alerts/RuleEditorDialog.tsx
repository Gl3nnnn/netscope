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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ALERT_METRICS,
  OP_SYMBOLS,
  metricMeta,
  type AlertMetric,
  type AlertOp,
  type AlertRule,
  type AlertScope,
} from '@/lib/alerts'
import { DEVICE_TYPE_LABELS, SEVERITY_LABELS } from '@/lib/health'

const DEVICE_TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]

const OPERATORS: AlertOp[] = ['gt', 'gte', 'lt', 'lte']
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

const DURATIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Immediately' },
  { value: 5_000, label: 'For 5 seconds' },
  { value: 10_000, label: 'For 10 seconds' },
  { value: 30_000, label: 'For 30 seconds' },
  { value: 60_000, label: 'For 1 minute' },
  { value: 300_000, label: 'For 5 minutes' },
]

const ANY = '__any__'

interface FormState {
  name: string
  metric: AlertMetric
  op: AlertOp
  threshold: string
  forMs: number
  severity: Severity
  site: string
  type: DeviceType | typeof ANY
  tag: string
}

function initialForm(rule?: AlertRule | null): FormState {
  if (rule) {
    return {
      name: rule.name,
      metric: rule.metric,
      op: rule.op,
      threshold: String(rule.threshold),
      forMs: rule.forMs,
      severity: rule.severity,
      site: rule.scope?.site ?? ANY,
      type: rule.scope?.type ?? ANY,
      tag: rule.scope?.tag ?? '',
    }
  }
  const meta = metricMeta('latencyMs')
  return {
    name: '',
    metric: meta.key,
    op: meta.op,
    threshold: String(meta.threshold),
    forMs: 10_000,
    severity: 'high',
    site: ANY,
    type: ANY,
    tag: '',
  }
}

interface RuleFormProps {
  rule?: AlertRule | null
  sites: string[]
  onSubmit: (draft: Omit<AlertRule, 'id'>) => void
  onCancel: () => void
}

function RuleForm({ rule, sites, onSubmit, onCancel }: RuleFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(rule))
  const [error, setError] = useState<string | null>(null)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  const onMetricChange = (metric: AlertMetric) => {
    const meta = metricMeta(metric)
    setForm((current) => ({
      ...current,
      metric,
      op: meta.op,
      threshold: String(meta.threshold),
    }))
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError('Give the rule a name.')
      return
    }
    const threshold = Number(form.threshold)
    if (!Number.isFinite(threshold)) {
      setError('Threshold must be a number.')
      return
    }
    const scope: AlertScope = {}
    if (form.site !== ANY) scope.site = form.site
    if (form.type !== ANY) scope.type = form.type
    if (form.tag.trim()) scope.tag = form.tag.trim()
    onSubmit({
      name: form.name.trim(),
      metric: form.metric,
      op: form.op,
      threshold,
      forMs: form.forMs,
      severity: form.severity,
      scope: Object.keys(scope).length > 0 ? scope : undefined,
    })
  }

  const meta = metricMeta(form.metric)

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>{rule ? 'Edit alert rule' : 'New alert rule'}</DialogTitle>
        <DialogDescription>
          Rules are evaluated against simulated telemetry every tick. An alert
          fires once the condition holds for the selected duration.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1.5">
        <Label htmlFor="rule-name">Name</Label>
        <Input
          id="rule-name"
          value={form.name}
          onChange={(event) => {
            update('name', event.target.value)
            setError(null)
          }}
          placeholder="High latency on edge routers"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="rule-metric">Metric</Label>
          <Select
            value={form.metric}
            onValueChange={(value) => onMetricChange(value as AlertMetric)}
          >
            <SelectTrigger id="rule-metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALERT_METRICS.map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule-op">Condition</Label>
          <Select
            value={form.op}
            onValueChange={(value) => update('op', value as AlertOp)}
          >
            <SelectTrigger id="rule-op">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => (
                <SelectItem key={op} value={op}>
                  {OP_SYMBOLS[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule-threshold">Threshold</Label>
          <Input
            id="rule-threshold"
            type="number"
            value={form.threshold}
            onChange={(event) => {
              update('threshold', event.target.value)
              setError(null)
            }}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Unit: {meta.unit}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rule-duration">Must hold</Label>
          <Select
            value={String(form.forMs)}
            onValueChange={(value) => update('forMs', Number(value))}
          >
            <SelectTrigger id="rule-duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((item) => (
                <SelectItem key={item.value} value={String(item.value)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rule-severity">Severity</Label>
          <Select
            value={form.severity}
            onValueChange={(value) => update('severity', value as Severity)}
          >
            <SelectTrigger id="rule-severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITIES.map((item) => (
                <SelectItem key={item} value={item}>
                  {SEVERITY_LABELS[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border border-border/60 bg-muted/20 p-3">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Scope (optional)
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="rule-site" className="text-xs">
              Site
            </Label>
            <Select
              value={form.site}
              onValueChange={(value) => update('site', value)}
            >
              <SelectTrigger id="rule-site">
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
            <Label htmlFor="rule-type" className="text-xs">
              Type
            </Label>
            <Select
              value={form.type}
              onValueChange={(value) =>
                update('type', value as DeviceType | typeof ANY)
              }
            >
              <SelectTrigger id="rule-type">
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
          <div className="space-y-1.5">
            <Label htmlFor="rule-tag" className="text-xs">
              Tag
            </Label>
            <Input
              id="rule-tag"
              value={form.tag}
              onChange={(event) => update('tag', event.target.value)}
              placeholder="production"
            />
          </div>
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{rule ? 'Save changes' : 'Create rule'}</Button>
      </DialogFooter>
    </form>
  )
}

interface RuleEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule?: AlertRule | null
  sites: string[]
  onSubmit: (draft: Omit<AlertRule, 'id'>) => void
}

export function RuleEditorDialog({
  open,
  onOpenChange,
  rule,
  sites,
  onSubmit,
}: RuleEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <RuleForm
            rule={rule}
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
