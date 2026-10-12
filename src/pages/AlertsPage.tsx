import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BellOff,
  BellRing,
  CheckCheck,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Waves,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AlertInstance, AlertRule } from '@/lib/alerts'
import {
  describeCondition,
  describeDuration,
  firingAlerts,
  metricMeta,
  pendingAlerts,
} from '@/lib/alerts'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { RuleEditorDialog } from '@/components/alerts/RuleEditorDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAlertsStore } from '@/store/useAlertsStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import { deviceSites } from '@/lib/devices'
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import { formatDateTime, round } from '@/lib/format'
import { elapsedMs, formatAge } from '@/lib/time'

export function AlertsPage() {
  const rules = useAlertsStore((state) => state.rules)
  const states = useAlertsStore((state) => state.states)
  const history = useAlertsStore((state) => state.history)
  const enabled = useAlertsStore((state) => state.enabled)
  const setEnabled = useAlertsStore((state) => state.setEnabled)
  const addRule = useAlertsStore((state) => state.addRule)
  const updateRule = useAlertsStore((state) => state.updateRule)
  const deleteRule = useAlertsStore((state) => state.deleteRule)
  const resetRules = useAlertsStore((state) => state.resetRules)
  const clearHistory = useAlertsStore((state) => state.clearHistory)

  const devices = useNetworkStore((state) => state.devices)
  const now = useNetworkStore((state) => state.lastTick)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AlertRule | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AlertRule | null>(null)

  const sites = useMemo(() => deviceSites(devices), [devices])
  const ruleById = useMemo(
    () => new Map(rules.map((rule) => [rule.id, rule])),
    [rules],
  )
  const firing = useMemo(() => firingAlerts(states), [states])
  const pending = useMemo(() => pendingAlerts(states), [states])
  const active = useMemo(() => [...firing, ...pending], [firing, pending])

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (rule: AlertRule) => {
    setEditing(rule)
    setDialogOpen(true)
  }

  const submitRule = (draft: Omit<AlertRule, 'id'>) => {
    if (editing) {
      updateRule(editing.id, draft)
      toast.success('Rule updated')
    } else {
      addRule(draft)
      toast.success('Rule created')
    }
  }

  const renderAlert = (instance: AlertInstance) => {
    const rule = ruleById.get(instance.ruleId)
    const meta = rule ? metricMeta(rule.metric) : null
    const firingNow = instance.status === 'firing'
    return (
      <Card key={instance.id}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={
                firingNow
                  ? 'mt-1 size-2.5 shrink-0 rounded-full bg-destructive'
                  : 'mt-1 size-2.5 shrink-0 rounded-full bg-warning'
              }
              aria-hidden
            />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{instance.ruleName}</p>
                <Badge variant={firingNow ? 'destructive' : 'warning'}>
                  {firingNow ? 'Firing' : 'Pending'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                <Link
                  to={`/devices/${instance.deviceId}`}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {instance.deviceName}
                </Link>{' '}
                {meta
                  ? `${meta.label.toLowerCase()} at ${round(instance.value, 1)}${meta.unit}`
                  : null}
                {rule ? ` (${describeCondition(rule)})` : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Active for {formatAge(elapsedMs(instance.startedAt, now))} -
                started {formatDateTime(instance.startedAt)}
              </p>
            </div>
          </div>
          <SeverityBadge severity={instance.severity} />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Alerts"
        description="Custom threshold rules evaluated every tick against simulated telemetry."
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Toggle alert evaluation"
              />
              {enabled ? 'Enabled' : 'Disabled'}
            </label>
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" /> New rule
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Firing"
          value={String(firing.length)}
          icon={BellRing}
          accent="text-destructive"
        />
        <StatCard
          label="Pending"
          value={String(pending.length)}
          icon={Waves}
          accent="text-warning"
        />
        <StatCard
          label="Rules"
          value={String(rules.length)}
          icon={CheckCheck}
        />
        <StatCard
          label="Resolved"
          value={String(history.length)}
          icon={BellOff}
          accent="text-success"
        />
      </div>

      {!enabled ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Alert evaluation is disabled. Turn it on to resume rule checks.
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
          <TabsTrigger value="rules">Rules ({rules.length})</TabsTrigger>
          <TabsTrigger value="history">
            History
            {history.length > 0 ? (
              <span className="ml-2 rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                {history.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-3">
          {active.length === 0 ? (
            <EmptyState
              icon={BellOff}
              title="No active alerts"
              description="Every device is within the thresholds defined by your rules."
            />
          ) : (
            active.map(renderAlert)
          )}
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetRules()
                toast.success('Restored default rules')
              }}
            >
              <RotateCcw className="size-4" /> Reset to defaults
            </Button>
          </div>
          {rules.length === 0 ? (
            <EmptyState
              icon={BellRing}
              title="No rules yet"
              description="Create your first rule to start generating alerts."
              action={
                <Button size="sm" onClick={openNew}>
                  <Plus className="size-4" /> New rule
                </Button>
              }
            />
          ) : (
            rules.map((rule) => (
              <Card key={rule.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{rule.name}</p>
                      <SeverityBadge severity={rule.severity} />
                      <Badge variant="outline">{describeCondition(rule)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {describeDuration(rule.forMs)}
                      {rule.scope
                        ? ` - scope: ${describeScope(rule)}`
                        : ' - all devices'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(rule)}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(rule)}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          {history.length > 0 ? (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  clearHistory()
                  toast.success('Cleared alert history')
                }}
              >
                Clear history
              </Button>
            </div>
          ) : null}
          {history.length === 0 ? (
            <EmptyState
              icon={CheckCheck}
              title="No resolved alerts"
              description="Alerts that return to normal will be recorded here."
            />
          ) : (
            history.map((instance, index) => (
              <Card key={`${instance.id}-${instance.resolvedAt}-${index}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {instance.ruleName}
                    <Badge variant="success">Resolved</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm text-muted-foreground">
                  <p>
                    <Link
                      to={`/devices/${instance.deviceId}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {instance.deviceName}
                    </Link>
                  </p>
                  <p>
                    Fired{' '}
                    {instance.firedAt ? formatDateTime(instance.firedAt) : '-'}{' '}
                    - resolved{' '}
                    {instance.resolvedAt
                      ? formatDateTime(instance.resolvedAt)
                      : '-'}
                  </p>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <RuleEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editing}
        sites={sites}
        onSubmit={submitRule}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete alert rule"
        description={
          pendingDelete
            ? `Remove "${pendingDelete.name}" and stop evaluating it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) {
            deleteRule(pendingDelete.id)
            toast.success('Rule deleted')
          }
        }}
      />
    </div>
  )
}

function describeScope(rule: AlertRule): string {
  const parts: string[] = []
  if (rule.scope?.site) parts.push(rule.scope.site)
  if (rule.scope?.type) parts.push(DEVICE_TYPE_LABELS[rule.scope.type])
  if (rule.scope?.tag) parts.push(`#${rule.scope.tag}`)
  return parts.join(' ')
}
