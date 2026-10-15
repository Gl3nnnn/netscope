import { useMemo } from 'react'
import {
  Bug,
  Clock3,
  Flame,
  Gauge,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct } from '@/lib/format'
import {
  CATEGORY_LABELS,
  deviceRisk,
  dueInDays,
  isOverdue,
  patchQueue,
  scanFleet,
  unpatchableFindings,
  vulnSummary,
  withStatus,
  type Vulnerability,
  type VulnStatus,
} from '@/lib/vulnerabilities'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useVulnStore } from '@/store/useVulnStore'

const GRADE_ACCENT: Record<'healthy' | 'degraded' | 'critical', string> = {
  healthy: 'text-success',
  degraded: 'text-warning',
  critical: 'text-destructive',
}

const CVSS_BAR: Record<Vulnerability['severity'], string> = {
  critical: 'bg-destructive',
  high: 'bg-warning',
  medium: 'bg-info',
  low: 'bg-muted-foreground',
}

const STATUS_VARIANT: Record<VulnStatus, 'success' | 'secondary' | 'warning'> =
  {
    open: 'warning',
    patched: 'success',
    accepted: 'secondary',
  }

const RENDER_LIMIT = 100

export function VulnerabilitiesPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const dispositions = useVulnStore((state) => state.dispositions)
  const applyStatus = useVulnStore((state) => state.applyStatus)
  const rescan = useVulnStore((state) => state.rescan)

  const vulns = useMemo(
    () => withStatus(scanFleet(devices, seed), dispositions),
    [devices, seed, dispositions],
  )
  const summary = useMemo(() => vulnSummary(vulns), [vulns])
  const risks = useMemo(() => deviceRisk(vulns).slice(0, 8), [vulns])
  const unpatchable = useMemo(
    () => unpatchableFindings(vulns).slice(0, 6),
    [vulns],
  )

  const rows = useMemo(() => {
    const open = patchQueue(vulns)
    const rest = vulns.filter((vuln) => vuln.status !== 'open')
    return [...open, ...rest]
  }, [vulns])

  const slaBuckets = useMemo(() => {
    const buckets = { overdue: 0, week: 0, month: 0, later: 0 }
    for (const vuln of vulns) {
      if (vuln.status !== 'open') continue
      if (isOverdue(vuln)) buckets.overdue += 1
      else if (dueInDays(vuln) <= 7) buckets.week += 1
      else if (dueInDays(vuln) <= 30) buckets.month += 1
      else buckets.later += 1
    }
    return buckets
  }, [vulns])

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Vulnerabilities"
          description="CVE exposure, patch queue and remediation SLAs."
        />
        <EmptyState
          icon={Bug}
          title="No fleet to scan"
          description="Seed the fleet to run a vulnerability scan."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Vulnerabilities"
        description="Deterministic CVE scan across the fleet: CVSS scoring, exploit availability, remediation SLAs, a patch queue and accepted-risk tracking. Patches and acceptances are recorded on the timeline."
        actions={
          <Button variant="outline" size="sm" onClick={rescan}>
            <RefreshCw className="size-3.5" /> Rescan
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Patch compliance"
          value={formatPct(summary.patchCompliancePct, 0)}
          icon={ShieldCheck}
          accent={
            summary.patchCompliancePct >= 80
              ? 'text-success'
              : summary.patchCompliancePct >= 50
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.patched} patched · ${summary.open} open`}
        />
        <StatCard
          label="Open findings"
          value={`${summary.open}`}
          icon={Bug}
          accent={summary.open > 0 ? 'text-warning' : 'text-success'}
          hint={`${summary.accepted} accepted risk`}
        />
        <StatCard
          label="Exploited / critical"
          value={`${summary.exploitable} / ${summary.critical}`}
          icon={Flame}
          accent={summary.exploitable > 0 ? 'text-destructive' : 'text-success'}
          hint={`${summary.overdue} past SLA`}
        />
        <StatCard
          label="Exposure score"
          value={`${summary.score}`}
          icon={summary.grade === 'healthy' ? ShieldCheck : Gauge}
          accent={GRADE_ACCENT[summary.grade]}
          hint={`${summary.meanAgeDays} d mean open age`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bug className="size-4 text-primary" />
            Findings
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Sorted by the patch queue (exploitable first, then CVSS) — patched
            and accepted findings follow. Criticals must be remediated within 7
            days, highs 14, mediums 30.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No findings for the current fleet. Try a rescan after adding
              devices.
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    CVE
                  </th>
                  <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Severity
                  </th>
                  <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    CVSS
                  </th>
                  <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Device
                  </th>
                  <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Exploit
                  </th>
                  <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    SLA
                  </th>
                  <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, RENDER_LIMIT).map((vuln) => {
                  const overdue = isOverdue(vuln)
                  const left = dueInDays(vuln)
                  return (
                    <tr key={vuln.id} className="border-t border-border/50">
                      <td className="max-w-72 p-2">
                        <span className="block font-mono text-xs font-medium">
                          {vuln.cveId}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {vuln.title}
                        </span>
                      </td>
                      <td className="p-2">
                        <SeverityBadge severity={vuln.severity} />
                      </td>
                      <td className="p-2">
                        <span className="flex items-center gap-2">
                          <span className="w-7 text-xs tabular-nums">
                            {vuln.cvss.toFixed(1)}
                          </span>
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <span
                              className={`block h-full ${CVSS_BAR[vuln.severity]}`}
                              style={{ width: `${vuln.cvss * 10}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      <td className="p-2 text-xs">
                        <span className="block font-medium">
                          {vuln.deviceName}
                        </span>
                        <span className="block text-muted-foreground">
                          {vuln.site} · {vuln.deviceType}
                        </span>
                      </td>
                      <td className="p-2">
                        {vuln.exploitAvailable ? (
                          <Badge variant="destructive" className="text-[10px]">
                            <Flame className="size-3" /> Public
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            none
                          </Badge>
                        )}
                      </td>
                      <td className="p-2 text-right text-xs tabular-nums">
                        {vuln.status !== 'open' ? (
                          <span className="text-muted-foreground">—</span>
                        ) : overdue ? (
                          <span className="text-destructive">
                            overdue {Math.abs(left)} d
                          </span>
                        ) : (
                          <span className={left <= 3 ? 'text-warning' : ''}>
                            {left} d left
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex items-center justify-end gap-1.5">
                          <Badge variant={STATUS_VARIANT[vuln.status]}>
                            {vuln.status}
                          </Badge>
                          {vuln.status === 'open' ? (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                disabled={!vuln.patchAvailable}
                                title={
                                  vuln.patchAvailable
                                    ? 'Apply the vendor patch'
                                    : 'No vendor patch available'
                                }
                                onClick={() => applyStatus(vuln, 'patched')}
                              >
                                <Wrench className="size-3" /> Patch
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => applyStatus(vuln, 'accepted')}
                              >
                                Accept
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => applyStatus(vuln, 'open')}
                            >
                              Reopen
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {rows.length > RENDER_LIMIT ? (
            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              showing {RENDER_LIMIT} of {rows.length} findings
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" />
              Device risk
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Weighted exposure (CVSS, ×2 when exploited).
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {risks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No open findings on any device.
              </p>
            ) : (
              risks.map((row) => (
                <div key={row.deviceId} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <SeverityBadge
                        severity={
                          row.critical > 0
                            ? 'critical'
                            : row.exploitable > 0
                              ? 'high'
                              : 'medium'
                        }
                      />
                      <span className="truncate font-medium">
                        {row.deviceName}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {row.open} open · {row.risk} risk
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${Math.min(100, Math.round((row.risk / 40) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-4 text-primary" />
              Remediation SLA
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Open findings bucketed by time since first detection.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              {
                label: 'Overdue',
                count: slaBuckets.overdue,
                accent: 'text-destructive',
              },
              {
                label: 'Within 7 days',
                count: slaBuckets.week,
                accent: 'text-warning',
              },
              {
                label: 'Within 30 days',
                count: slaBuckets.month,
                accent: 'text-info',
              },
              { label: 'Later', count: slaBuckets.later, accent: '' },
            ].map((bucket) => (
              <div
                key={bucket.label}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className={bucket.accent}>{bucket.label}</span>
                <span className="tabular-nums">{bucket.count}</span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted-foreground">
              Mean open age {summary.meanAgeDays} days · {summary.overdue} past
              SLA
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4 text-warning" />
              No vendor patch
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Mitigate or accept — these stay open until a fix ships.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {unpatchable.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every open finding has a vendor patch available.
              </p>
            ) : (
              unpatchable.map((vuln) => (
                <div
                  key={vuln.id}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SeverityBadge severity={vuln.severity} />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-xs">
                        {vuln.cveId}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {vuln.deviceName} · {CATEGORY_LABELS[vuln.category]}
                      </span>
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={() => applyStatus(vuln, 'accepted')}
                  >
                    Accept
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
