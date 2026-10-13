import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  GitPullRequest,
  Plus,
  RotateCcw,
  Trash2,
  Workflow,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChangeDialog } from '@/components/changes/ChangeDialog'
import { fleetDrift, resolveConfig } from '@/lib/configs'
import {
  CHANGE_RISK_LABELS,
  CHANGE_STATUS_LABELS,
  CHANGE_TYPE_LABELS,
  CHANGE_WINDOW_LABELS,
  assessRisk,
  changeSummary,
  changeWindowState,
  describeChange,
  findChangeConflicts,
  isTerminalChange,
  nextChangeStatuses,
  pendingApprovals,
  verifyChange,
  type ChangeRequest,
  type ChangeStatus,
} from '@/lib/changes'
import { formatDateTime } from '@/lib/format'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useServicesStore } from '@/store/useServicesStore'
import { useConfigsStore } from '@/store/useConfigsStore'
import { useChangeStore } from '@/store/useChangeStore'

const RISK_VARIANT = {
  low: 'outline',
  medium: 'warning',
  high: 'destructive',
} as const

const STATUS_VARIANT: Record<ChangeStatus, string> = {
  draft: 'outline',
  review: 'info',
  approved: 'info',
  scheduled: 'secondary',
  implementing: 'warning',
  verifying: 'warning',
  closed: 'success',
  rejected: 'destructive',
  cancelled: 'outline',
  'rolled-back': 'destructive',
}

const WINDOW_VARIANT = {
  upcoming: 'outline',
  active: 'info',
  elapsed: 'secondary',
} as const

function transitionVariant(to: ChangeStatus) {
  if (to === 'rejected' || to === 'rolled-back' || to === 'cancelled') {
    return 'outline' as const
  }
  if (to === 'approved' || to === 'closed') return 'default' as const
  return 'secondary' as const
}

export function ChangesPage() {
  const devices = useNetworkStore((state) => state.devices)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const pushEvent = useNetworkStore((state) => state.pushEvent)
  const services = useServicesStore((state) => state.services)
  const overrides = useConfigsStore((state) => state.overrides)
  const changes = useChangeStore((state) => state.changes)
  const addChange = useChangeStore((state) => state.addChange)
  const transition = useChangeStore((state) => state.transition)
  const deleteChange = useChangeStore((state) => state.deleteChange)
  const resetChanges = useChangeStore((state) => state.resetChanges)

  const [mounted] = useState(() => Date.now())
  const [dialogOpen, setDialogOpen] = useState(false)
  const now = lastTick || mounted

  const summary = useMemo(() => changeSummary(changes, now), [changes, now])
  const conflicts = useMemo(() => findChangeConflicts(changes), [changes])
  const drifts = useMemo(
    () => fleetDrift(devices, (device) => resolveConfig(overrides, device)),
    [devices, overrides],
  )
  const approvals = useMemo(
    () => pendingApprovals(changes, devices, services),
    [changes, devices, services],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Change Management"
          description="Plan, approve, schedule and verify changes with a CAB workflow."
        />
        <EmptyState
          icon={Workflow}
          title="No devices to change"
          description="Seed the fleet before raising change requests."
        />
      </div>
    )
  }

  const deviceName = (id: string) =>
    devices.find((device) => device.id === id)?.name ?? id
  const changeById = (id: string) => changes.find((change) => change.id === id)

  const applyTransition = (change: ChangeRequest, to: ChangeStatus) => {
    const result = transition(change.id, to, { now, actor: 'You' })
    if (!result || !result.ok) {
      toast.error(result?.reason ?? 'Transition not allowed')
      return
    }
    if (to === 'implementing') {
      pushEvent({
        timestamp: now,
        type: 'config',
        severity: 'low',
        message: `Change "${change.title}" entered implementation.`,
      })
    }
    toast.success(`${change.title} → ${CHANGE_STATUS_LABELS[to]}`)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Change Management"
        description="Raise, review, approve, schedule, implement and verify changes with a lightweight CAB workflow."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={resetChanges}>
              <RotateCcw className="size-4" /> Reset
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /> New change
            </Button>
          </>
        }
      />

      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <Workflow className="size-4 text-primary" />
          <span className="text-muted-foreground">
            {summary.total} change(s) · {summary.pendingApproval} awaiting
            approval · {summary.active} active · {summary.overdue} overdue ·{' '}
            {summary.conflicts} conflict(s)
          </span>
          {summary.pendingApproval > 0 ? (
            <Badge variant="info" className="ml-auto">
              CAB action required
            </Badge>
          ) : (
            <Badge variant="success" className="ml-auto gap-1">
              <CheckCircle2 className="size-3" /> CAB clear
            </Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open changes"
          value={`${changes.filter((change) => !isTerminalChange(change.status)).length}`}
          icon={GitPullRequest}
          hint={`${summary.total} total`}
        />
        <StatCard
          label="Pending approval"
          value={`${summary.pendingApproval}`}
          icon={ClipboardCheck}
          accent={summary.pendingApproval > 0 ? 'text-sky-500' : 'text-success'}
        />
        <StatCard
          label="Active now"
          value={`${summary.active}`}
          icon={CalendarClock}
          accent="text-amber-500"
        />
        <StatCard
          label="Overdue"
          value={`${summary.overdue}`}
          icon={AlertTriangle}
          accent={summary.overdue > 0 ? 'text-destructive' : 'text-success'}
        />
      </div>

      {conflicts.length > 0 ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" />
              Schedule conflicts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {conflicts.map((conflict) => (
              <p key={`${conflict.aId}:${conflict.bId}`}>
                <span className="font-medium">
                  {changeById(conflict.aId)?.title ?? conflict.aId}
                </span>{' '}
                clashes with{' '}
                <span className="font-medium">
                  {changeById(conflict.bId)?.title ?? conflict.bId}
                </span>{' '}
                — {conflict.reason}.
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {changes.length === 0 ? (
            <EmptyState
              icon={GitPullRequest}
              title="No change requests"
              description="Raise a change to start the CAB workflow."
            />
          ) : (
            changes.map((change) => {
              const risk = assessRisk({ change, devices, services })
              const window = changeWindowState(change, now)
              return (
                <Card key={change.id}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">
                        {change.title}
                      </CardTitle>
                      <Badge variant={STATUS_VARIANT[change.status] as never}>
                        {CHANGE_STATUS_LABELS[change.status]}
                      </Badge>
                      <Badge variant={RISK_VARIANT[risk.level]}>
                        {CHANGE_RISK_LABELS[risk.level]} risk
                      </Badge>
                      <Badge variant="outline">
                        {CHANGE_TYPE_LABELS[change.type]}
                      </Badge>
                      <Badge
                        variant={WINDOW_VARIANT[window]}
                        className="ml-auto"
                      >
                        {CHANGE_WINDOW_LABELS[window]}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {describeChange(change)} ·{' '}
                      {formatDateTime(change.plannedStart)} →{' '}
                      {formatDateTime(change.plannedEnd)} · by{' '}
                      {change.requestedBy}
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {change.description ? (
                      <p className="text-sm text-muted-foreground">
                        {change.description}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-1.5">
                      {change.deviceIds.slice(0, 6).map((id) => (
                        <Badge
                          key={id}
                          variant="secondary"
                          className="text-[10px]"
                        >
                          {deviceName(id)}
                        </Badge>
                      ))}
                      {change.deviceIds.length > 6 ? (
                        <Badge variant="secondary" className="text-[10px]">
                          +{change.deviceIds.length - 6} more
                        </Badge>
                      ) : null}
                    </div>

                    {change.status === 'verifying' ? (
                      <VerificationLine
                        verified={verifyChange(change, drifts)}
                      />
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      {nextChangeStatuses(change.status).map((to) => (
                        <Button
                          key={to}
                          size="sm"
                          variant={transitionVariant(to)}
                          onClick={() => applyTransition(change, to)}
                        >
                          {CHANGE_STATUS_LABELS[to]}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          deleteChange(change.id)
                          toast.success('Change deleted')
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardCheck className="size-4 text-primary" />
                CAB queue
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Changes awaiting approval, highest risk first.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing waiting for the CAB.
                </p>
              ) : (
                approvals.map(({ change, assessment }) => (
                  <div
                    key={change.id}
                    className="rounded-md border border-border/60 bg-card/60 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {change.title}
                      </span>
                      <Badge variant={RISK_VARIANT[assessment.level]}>
                        {CHANGE_RISK_LABELS[assessment.level]}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {assessment.reasons[0] ?? 'Low impact'}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => applyTransition(change, 'approved')}
                      >
                        <CheckCircle2 className="size-3.5" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => applyTransition(change, 'rejected')}
                      >
                        <XCircle className="size-3.5" /> Reject
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Verification</CardTitle>
              <p className="text-xs text-muted-foreground">
                Post-implementation config drift check for in-flight changes.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {changes.filter((change) => change.status === 'verifying')
                .length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No changes are awaiting verification.
                </p>
              ) : (
                changes
                  .filter((change) => change.status === 'verifying')
                  .map((change) => (
                    <div
                      key={change.id}
                      className="rounded-md border border-border/60 bg-card/60 px-3 py-2"
                    >
                      <p className="text-sm font-medium">{change.title}</p>
                      <VerificationLine
                        verified={verifyChange(change, drifts)}
                      />
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ChangeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        devices={devices}
        title="Raise change"
        onSubmit={(draft) => {
          addChange(draft, now)
          toast.success('Change request raised')
        }}
      />
    </div>
  )
}

function VerificationLine({
  verified,
}: {
  verified: { total: number; drifted: number; verified: boolean }
}) {
  return (
    <p className="flex items-center gap-2 text-xs">
      {verified.verified ? (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="size-3.5" />
          Verified — {verified.total} device(s) matching baseline
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-destructive">
          <AlertTriangle className="size-3.5" />
          {verified.drifted} of {verified.total} device(s) show drift
        </span>
      )}
    </p>
  )
}
