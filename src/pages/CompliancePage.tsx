import { useMemo, useState } from 'react'
import {
  Ban,
  CheckCircle2,
  FileCheck2,
  ListChecks,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { resolveConfig } from '@/lib/configs'
import {
  COMPLIANCE_CATEGORY_LABELS,
  COMPLIANCE_GRADE_LABELS,
  COMPLIANCE_RULES,
  COMPLIANCE_SEVERITY_LABELS,
  COMPLIANCE_STATUS_LABELS,
  complianceRisk,
  evaluateCompliance,
  waiverKey,
  type ComplianceCategory,
  type ComplianceSeverity,
  type ComplianceStatus,
} from '@/lib/compliance'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useConfigsStore } from '@/store/useConfigsStore'
import { usePolicyStore } from '@/store/usePolicyStore'
import { useComplianceStore } from '@/store/useComplianceStore'

const CATEGORIES: ComplianceCategory[] = [
  'hardening',
  'segmentation',
  'availability',
  'hygiene',
]

const SEVERITY_VARIANT: Record<ComplianceSeverity, string> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'info',
  low: 'outline',
}

const STATUS_VARIANT: Record<ComplianceStatus, string> = {
  fail: 'destructive',
  pass: 'success',
  waived: 'secondary',
  na: 'outline',
}

export function CompliancePage() {
  const devices = useNetworkStore((state) => state.devices)
  const overrides = useConfigsStore((state) => state.overrides)
  const policyRules = usePolicyStore((state) => state.rules)
  const waivers = useComplianceStore((state) => state.waivers)
  const toggleWaiver = useComplianceStore((state) => state.toggleWaiver)
  const clearWaivers = useComplianceStore((state) => state.clearWaivers)

  const [category, setCategory] = useState<'all' | ComplianceCategory>('all')
  const [failuresOnly, setFailuresOnly] = useState(false)

  const report = useMemo(
    () =>
      devices.length === 0
        ? null
        : evaluateCompliance({
            devices,
            configFor: (device) => resolveConfig(overrides, device).current,
            policyRules,
            waivers: new Set(waivers),
          }),
    [devices, overrides, policyRules, waivers],
  )

  if (devices.length === 0 || !report) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Compliance & Hardening"
          description="Audit the fleet against hardening, segmentation, availability and hygiene rules."
        />
        <EmptyState
          icon={ShieldCheck}
          title="No devices to audit"
          description="Seed the fleet before running a compliance audit."
        />
      </div>
    )
  }

  const risk = complianceRisk(report)
  const gradeVariant =
    report.grade === 'compliant'
      ? 'success'
      : report.grade === 'at-risk'
        ? 'warning'
        : 'destructive'

  const findings = report.findings.filter((finding) => {
    if (finding.status === 'na') return false
    if (category !== 'all' && finding.category !== category) return false
    if (failuresOnly && finding.status !== 'fail') return false
    return true
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Compliance & Hardening"
        description="Audit the fleet against hardening, segmentation, availability and hygiene rule packs, with documented waivers."
      />

      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <FileCheck2 className="size-4 text-primary" />
          <span className="text-muted-foreground">
            {report.pass} checks passing · {report.fail} failing ·{' '}
            {report.waived} waived · risk score {risk}
          </span>
          <Badge variant={gradeVariant} className="ml-auto gap-1">
            <ShieldCheck className="size-3" />
            {COMPLIANCE_GRADE_LABELS[report.grade]} · {report.score}%
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Compliance score"
          value={`${report.score}%`}
          icon={ShieldCheck}
          hint={COMPLIANCE_GRADE_LABELS[report.grade]}
          accent={
            report.grade === 'compliant' ? 'text-success' : 'text-warning'
          }
        />
        <StatCard
          label="Critical findings"
          value={`${report.bySeverity.critical}`}
          icon={ShieldAlert}
          accent={
            report.bySeverity.critical > 0 ? 'text-destructive' : 'text-success'
          }
        />
        <StatCard
          label="High findings"
          value={`${report.bySeverity.high}`}
          icon={ShieldAlert}
          accent="text-amber-500"
        />
        <StatCard
          label="Waived"
          value={`${report.waived}`}
          icon={Ban}
          hint="documented exceptions"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4 text-primary" />
              Findings
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select
                value={category}
                onValueChange={(value) =>
                  setCategory(value as 'all' | ComplianceCategory)
                }
              >
                <SelectTrigger className="h-8 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {COMPLIANCE_CATEGORY_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={failuresOnly ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setFailuresOnly((current) => !current)}
              >
                Failures only
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {findings.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                No findings match the current filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Device</th>
                      <th className="px-4 py-2 font-medium">Check</th>
                      <th className="px-4 py-2 font-medium">Severity</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {findings.slice(0, 100).map((finding) => {
                      const key = waiverKey(finding.ruleId, finding.deviceId)
                      return (
                        <tr
                          key={key}
                          className="border-b border-border/40 last:border-0"
                        >
                          <td className="px-4 py-2">
                            <span className="font-medium">
                              {finding.deviceName}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {finding.site}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            <span>{finding.ruleTitle}</span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {COMPLIANCE_CATEGORY_LABELS[finding.category]}
                            </span>
                            {finding.status === 'fail' ? (
                              <p className="text-xs text-muted-foreground">
                                {finding.detail}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              variant={
                                SEVERITY_VARIANT[finding.severity] as never
                              }
                            >
                              {COMPLIANCE_SEVERITY_LABELS[finding.severity]}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">
                            <Badge
                              variant={STATUS_VARIANT[finding.status] as never}
                            >
                              {COMPLIANCE_STATUS_LABELS[finding.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 text-right">
                            {finding.status === 'waived' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  toggleWaiver(key)
                                  toast.success('Waiver removed')
                                }}
                              >
                                Un-waive
                              </Button>
                            ) : finding.status === 'fail' ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  toggleWaiver(key)
                                  toast.success('Finding waived')
                                }}
                              >
                                Waive
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {findings.length > 100 ? (
                  <p className="px-4 py-2 text-xs text-muted-foreground">
                    Showing first 100 of {findings.length} findings.
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">By category</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {CATEGORIES.map((item) => {
                const summary = report.byCategory[item]
                return (
                  <div
                    key={item}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2"
                  >
                    <span className="text-sm">
                      {COMPLIANCE_CATEGORY_LABELS[item]}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      <span className="text-success">{summary.pass}</span>
                      {' / '}
                      <span
                        className={
                          summary.fail > 0 ? 'text-destructive' : undefined
                        }
                      >
                        {summary.fail}
                      </span>
                    </span>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Ban className="size-4" /> Waivers
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={report.waived === 0}
                onClick={() => {
                  clearWaivers()
                  toast.success('All waivers cleared')
                }}
              >
                Clear
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {report.waived === 0
                  ? 'No waivers recorded. Waive a finding to document an accepted exception.'
                  : `${report.waived} finding(s) waived.`}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Worst devices</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {report.deviceSummaries.slice(0, 5).map((summary) => (
                <div
                  key={summary.deviceId}
                  className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {summary.deviceName}
                  </span>
                  <span className="flex items-center gap-2 text-xs tabular-nums">
                    <span className="text-muted-foreground">
                      {summary.pass}/{summary.pass + summary.fail}
                    </span>
                    <Badge
                      variant={
                        summary.score >= 90
                          ? 'success'
                          : summary.score >= 75
                            ? 'warning'
                            : 'destructive'
                      }
                    >
                      {summary.score}%
                    </Badge>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4 text-success" />
            Rule packs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Rule</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Severity</th>
                  <th className="px-4 py-2 text-right font-medium">Pass</th>
                  <th className="px-4 py-2 text-right font-medium">Fail</th>
                  <th className="px-4 py-2 text-right font-medium">Waived</th>
                </tr>
              </thead>
              <tbody>
                {COMPLIANCE_RULES.map((rule) => {
                  const summary = report.ruleSummaries.find(
                    (item) => item.ruleId === rule.id,
                  )
                  if (!summary) return null
                  return (
                    <tr
                      key={rule.id}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-4 py-2">{rule.title}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {COMPLIANCE_CATEGORY_LABELS[rule.category]}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={SEVERITY_VARIANT[rule.severity] as never}
                        >
                          {COMPLIANCE_SEVERITY_LABELS[rule.severity]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-success">
                        {summary.pass}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-destructive">
                        {summary.fail}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {summary.waived}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
