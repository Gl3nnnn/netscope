import { useMemo, useState } from 'react'
import {
  Activity,
  ArchiveRestore,
  DatabaseBackup,
  TimerReset,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  BACKUP_KIND_LABELS,
  BACKUP_STATUS_LABELS,
  runRecovery,
  type BackupStatus,
} from '@/lib/recovery'
import { formatPct } from '@/lib/format'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useRecoveryStore } from '@/store/useRecoveryStore'
import { useServicesStore } from '@/store/useServicesStore'

const JOB_LIMIT = 40

const STATUS_VARIANT: Record<
  BackupStatus,
  'destructive' | 'warning' | 'secondary' | 'default'
> = {
  ok: 'secondary',
  warning: 'warning',
  failed: 'destructive',
  stale: 'warning',
}

const STATUS_DOT: Record<BackupStatus, string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  failed: 'bg-destructive',
  stale: 'bg-warning',
}

export function RecoveryPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const services = useServicesStore((state) => state.services)
  const overrides = useRecoveryStore((state) => state.overrides)
  const drills = useRecoveryStore((state) => state.drills)
  const drill = useRecoveryStore((state) => state.drill)
  const [running, setRunning] = useState(false)

  const result = useMemo(
    () => runRecovery(devices, services, seed, lastTick, overrides),
    [devices, services, seed, lastTick, overrides],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="DR & Backup"
          description="RPO, RTO and restore tests."
        />
        <EmptyState
          icon={DatabaseBackup}
          title="No fleet to protect"
          description="Seed the fleet to generate backup jobs."
        />
      </div>
    )
  }

  const { summary, jobs, tests, findings } = result
  const healthPct = summary.jobs === 0 ? 100 : (summary.ok / summary.jobs) * 100
  const rtoPct =
    summary.restoreTests === 0
      ? 100
      : (summary.restorePassed / summary.restoreTests) * 100

  const onDrill = () => {
    setRunning(true)
    try {
      const record = drill(jobs, tests, Date.now())
      if (record) {
        toast.success(
          `DR drill complete: ${record.jobsPassed}/${record.jobsTested} restores within RTO.`,
        )
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="DR & Backup"
        description="Backup jobs with kind-derived RPO targets and tier-derived RTO targets. Each tick simulates the latest run (failures, staleness, RPO misses); restore tests measure actual versus target RTO. Run a drill to file a CAB change for every P1/P2 job."
        actions={
          <Button size="sm" onClick={onDrill} disabled={running}>
            <ArchiveRestore className="size-4" />
            Run DR drill
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Backup health"
          value={formatPct(healthPct, 0)}
          icon={DatabaseBackup}
          accent={
            healthPct >= 80
              ? 'text-success'
              : healthPct >= 50
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.ok}/${summary.jobs} jobs OK`}
        />
        <StatCard
          label="RTO met"
          value={formatPct(rtoPct, 0)}
          icon={TimerReset}
          accent={
            rtoPct >= 80
              ? 'text-success'
              : rtoPct >= 50
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.restorePassed}/${summary.restoreTests} restores`}
        />
        <StatCard
          label="RPO misses"
          value={`${summary.rpoMisses}`}
          icon={TriangleAlert}
          accent={summary.rpoMisses > 0 ? 'text-warning' : 'text-success'}
          hint={`${summary.failed} failed · ${summary.stale} stale`}
        />
        <StatCard
          label="Storage cost"
          value={`$${summary.monthlyCostUsd.toFixed(2)}`}
          icon={Activity}
          accent="text-primary"
          hint={`${summary.avgSuccessPct}% avg success`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <DatabaseBackup className="size-4 text-primary" />
                Backup jobs
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {summary.jobs} jobs across the fleet — worst first.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Device</th>
                      <th className="py-2 pr-3">Kind</th>
                      <th className="py-2 pr-3">Tier</th>
                      <th className="py-2 pr-3">RPO (h)</th>
                      <th className="py-2 pr-3">Size</th>
                      <th className="py-2 pr-3">Success</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...jobs]
                      .sort((a, b) => {
                        const order: BackupStatus[] = [
                          'failed',
                          'stale',
                          'warning',
                          'ok',
                        ]
                        return order.indexOf(a.status) - order.indexOf(b.status)
                      })
                      .slice(0, JOB_LIMIT)
                      .map((job) => (
                        <tr
                          key={job.id}
                          className="border-b border-border/40 last:border-0"
                        >
                          <td className="py-2 pr-3">
                            <span className="flex items-center gap-1.5">
                              <span
                                className={`size-1.5 rounded-full ${STATUS_DOT[job.status]}`}
                              />
                              <Badge
                                variant={STATUS_VARIANT[job.status]}
                                className="text-[10px]"
                              >
                                {BACKUP_STATUS_LABELS[job.status]}
                              </Badge>
                            </span>
                          </td>
                          <td className="py-2 pr-3 font-medium">
                            {job.deviceName}
                          </td>
                          <td className="py-2 pr-3">
                            {BACKUP_KIND_LABELS[job.kind]}
                          </td>
                          <td className="py-2 pr-3 uppercase">{job.tier}</td>
                          <td className="py-2 pr-3 tabular-nums">
                            {job.actualRpoHrs}
                            <span className="text-xs text-muted-foreground">
                              /{job.targetRpoHrs}
                            </span>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {job.sizeGb} GB
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {job.successRatePct}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TriangleAlert className="size-4 text-warning" />
                Findings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All backups within RPO and all restores within RTO.
                </p>
              ) : (
                findings.slice(0, 8).map((finding) => (
                  <div
                    key={finding.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">{finding.message}</span>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TimerReset className="size-4 text-primary" />
                Restore tests
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {summary.restorePassed}/{summary.restoreTests} within RTO.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {[...tests]
                .sort((a, b) => b.actualRtoHrs - a.actualRtoHrs)
                .slice(0, 6)
                .map((test) => (
                  <div key={test.id} className="space-y-0.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        {test.deviceName}
                      </span>
                      <Badge
                        variant={
                          test.result === 'pass' ? 'secondary' : 'destructive'
                        }
                        className="text-[10px]"
                      >
                        {test.result === 'pass' ? 'within RTO' : 'breach'}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {test.actualRtoHrs} h vs {test.targetRtoHrs} h target ·{' '}
                      {test.tier.toUpperCase()}
                    </p>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ArchiveRestore className="size-4 text-success" />
                Drill history
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Latest DR exercises (each filed a CAB change).
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {drills.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No drills run yet — use “Run DR drill”.
                </p>
              ) : (
                drills.slice(0, 6).map((record) => (
                  <div key={record.id} className="space-y-0.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {record.jobsPassed}/{record.jobsTested} within RTO
                      </span>
                      <Badge
                        variant={
                          record.rtoBreaches > 0 ? 'destructive' : 'secondary'
                        }
                        className="text-[10px]"
                      >
                        {record.rtoBreaches} breaches
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {record.note}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
