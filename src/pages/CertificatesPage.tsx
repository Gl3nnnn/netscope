import { useMemo } from 'react'
import { Clock3, KeyRound, RefreshCw, ShieldCheck, ShieldX } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct } from '@/lib/format'
import {
  EXPIRING_SOON_DAYS,
  FINDING_LABELS,
  ISSUER_LABELS,
  KIND_LABELS,
  certFindings,
  certSummary,
  expiryBuckets,
  seedCertificates,
  withOverrides,
} from '@/lib/certificates'
import { useCertStore } from '@/store/useCertStore'
import { useNetworkStore } from '@/store/useNetworkStore'

const RENDER_LIMIT = 100
const FINDING_LIMIT = 12

const BUCKET_ROWS: Array<{
  key: 'expired' | 'week' | 'month' | 'quarter' | 'later'
  label: string
  bar: string
  text: string
}> = [
  {
    key: 'expired',
    label: 'Expired',
    bar: 'bg-destructive',
    text: 'text-destructive',
  },
  {
    key: 'week',
    label: '≤ 7 days',
    bar: 'bg-destructive/70',
    text: 'text-destructive',
  },
  {
    key: 'month',
    label: '≤ 30 days',
    bar: 'bg-warning',
    text: 'text-warning',
  },
  {
    key: 'quarter',
    label: '≤ 90 days',
    bar: 'bg-info',
    text: 'text-info',
  },
  { key: 'later', label: '> 90 days', bar: 'bg-success', text: '' },
]

function expiryTone(days: number): string {
  if (days < 0) return 'text-destructive'
  if (days <= 7) return 'text-destructive'
  if (days <= EXPIRING_SOON_DAYS) return 'text-warning'
  return 'text-success'
}

export function CertificatesPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)
  const lastTick = useNetworkStore((state) => state.lastTick)

  const overrides = useCertStore((state) => state.overrides)
  const renew = useCertStore((state) => state.renew)

  const certs = useMemo(
    () => withOverrides(seedCertificates(devices, seed), overrides),
    [devices, seed, overrides],
  )
  const findings = useMemo(() => certFindings(certs), [certs])
  const summary = useMemo(() => certSummary(certs), [certs])
  const buckets = useMemo(() => expiryBuckets(certs), [certs])

  const bucketMax = useMemo(
    () => Math.max(1, ...Object.values(buckets)),
    [buckets],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Certificates"
          description="Expiry, rotation and trust posture."
        />
        <EmptyState
          icon={KeyRound}
          title="No fleet to manage"
          description="Seed the fleet to inventory its certificates."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Certificates"
        description="Simulated certificate inventory per device: issuers, key strength, SANs and expiry. Renewals reissue the cert for 365 days, persist across reloads and file a CAB change (emergency when already expired)."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Compliance"
          value={formatPct(summary.compliancePct, 0)}
          icon={ShieldCheck}
          accent={
            summary.compliancePct >= 85
              ? 'text-success'
              : summary.compliancePct >= 60
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.healthy} of ${summary.total} healthy`}
        />
        <StatCard
          label="Expired"
          value={`${summary.expired}`}
          icon={ShieldX}
          accent={summary.expired > 0 ? 'text-destructive' : 'text-success'}
          hint={
            summary.expired > 0
              ? `worst: ${Math.abs(Math.min(0, summary.urgentDays))} d overdue`
              : 'all certificates valid'
          }
        />
        <StatCard
          label={`Expiring ≤ ${EXPIRING_SOON_DAYS} d`}
          value={`${summary.expiring}`}
          icon={Clock3}
          accent={summary.expiring > 0 ? 'text-warning' : 'text-success'}
          hint={
            summary.urgentDays >= 0
              ? `most urgent in ${summary.urgentDays} d`
              : 'urgent rotation needed'
          }
        />
        <StatCard
          label="Trust & keys"
          value={`${summary.weakKeys + summary.selfSigned}`}
          icon={KeyRound}
          accent={
            summary.weakKeys + summary.selfSigned > 0
              ? 'text-warning'
              : 'text-success'
          }
          hint={`${summary.weakKeys} weak keys · ${summary.selfSigned} self-signed`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-4 text-primary" />
              Expiry distribution
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {summary.total} certificates across {devices.length} devices.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {BUCKET_ROWS.map((row) => {
              const count = buckets[row.key]
              return (
                <div key={row.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className={row.text}>{row.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${row.bar}`}
                      style={{
                        width: `${Math.round((count / bucketMax) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldX className="size-4 text-warning" />
              Findings
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {findings.length} open · sorted by severity
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every certificate is trusted, strong and outside the expiry
                window.
              </p>
            ) : (
              findings.slice(0, FINDING_LIMIT).map((finding) => (
                <div
                  key={finding.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SeverityBadge severity={finding.severity} />
                    <span className="truncate">{finding.message}</span>
                  </span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {FINDING_LABELS[finding.kind]}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" />
            Inventory
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Sorted by days-to-expiry. Rotation files a change request on the
            Changes board.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Subject
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Device
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Issuer
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Key
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Expires
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Auto-renew
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {certs.slice(0, RENDER_LIMIT).map((cert) => {
                const certFindingsForCert = findings.filter(
                  (finding) => finding.certId === cert.id,
                )
                return (
                  <tr key={cert.id} className="border-t border-border/50">
                    <td className="max-w-72 p-2">
                      <span className="block truncate font-mono text-xs font-medium">
                        {cert.commonName}
                      </span>
                      <span className="flex flex-wrap gap-1 pt-0.5">
                        <Badge variant="outline" className="text-[10px]">
                          {KIND_LABELS[cert.kind]}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {cert.sans.length} SANs
                        </Badge>
                        {certFindingsForCert.map((finding) => (
                          <Badge
                            key={finding.id}
                            variant={
                              finding.severity === 'critical' ||
                              finding.severity === 'high'
                                ? 'destructive'
                                : 'warning'
                            }
                            className="text-[10px]"
                          >
                            {FINDING_LABELS[finding.kind]}
                          </Badge>
                        ))}
                      </span>
                    </td>
                    <td className="p-2 text-xs">
                      <span className="block font-medium">
                        {cert.deviceName}
                      </span>
                      <span className="block text-muted-foreground">
                        {cert.site}
                      </span>
                    </td>
                    <td className="p-2 text-xs">
                      {ISSUER_LABELS[cert.issuer]}
                    </td>
                    <td className="p-2 text-xs tabular-nums">
                      {cert.keyType}-{cert.keyBits}
                    </td>
                    <td
                      className={`p-2 text-right text-xs tabular-nums ${expiryTone(cert.daysToExpiry)}`}
                    >
                      {cert.daysToExpiry < 0
                        ? `expired ${Math.abs(cert.daysToExpiry)} d ago`
                        : `in ${cert.daysToExpiry} d`}
                    </td>
                    <td className="p-2 text-right">
                      <Badge
                        variant={cert.autoRenew ? 'info' : 'secondary'}
                        className="text-[10px]"
                      >
                        {cert.autoRenew ? 'on' : 'off'}
                      </Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => renew(cert, lastTick)}
                      >
                        <RefreshCw className="size-3" /> Renew
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {certs.length > RENDER_LIMIT ? (
            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              showing {RENDER_LIMIT} of {certs.length} certificates
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
