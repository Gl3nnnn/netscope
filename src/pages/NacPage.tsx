import { useMemo } from 'react'
import {
  FingerprintPattern,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  KIND_LABELS,
  METHOD_LABELS,
  POSTURE_LABELS,
  postureBreakdown,
  runNac,
  type Endpoint,
  type PostureStatus,
} from '@/lib/nac'
import { SITES } from '@/simulation/seed'
import { useNacStore } from '@/store/useNacStore'
import { useNetworkStore } from '@/store/useNetworkStore'

const ENDPOINT_LIMIT = 50
const FINDING_LIMIT = 10

const POSTURE_VARIANT: Record<
  PostureStatus,
  'success' | 'warning' | 'destructive' | 'secondary'
> = {
  compliant: 'success',
  noncompliant: 'warning',
  quarantined: 'destructive',
  guest: 'secondary',
}

export function NacPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const quarantined = useNacStore((state) => state.quarantined)
  const quarantine = useNacStore((state) => state.quarantine)
  const release = useNacStore((state) => state.release)

  const nac = useMemo(
    () => runNac(devices, SITES, seed, quarantined),
    [devices, seed, quarantined],
  )
  const breakdown = useMemo(
    () => postureBreakdown(nac.endpoints),
    [nac.endpoints],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Access Control"
          description="802.1X and endpoint posture."
        />
        <EmptyState
          icon={FingerprintPattern}
          title="No network access"
          description="Seed the fleet to simulate endpoint authentication."
        />
      </div>
    )
  }

  const { summary } = nac

  return (
    <div className="space-y-5">
      <PageHeader
        title="Access Control"
        description="Simulated 802.1X/MAB/guest authentication across the fleet: posture checks (encryption, patching, AV, host firewall), failure storms and quarantine. Quarantine decisions persist and write device events to the timeline."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Posture compliance"
          value={`${summary.compliancePct}%`}
          icon={ShieldCheck}
          accent={
            summary.compliancePct >= 85
              ? 'text-success'
              : summary.compliancePct >= 70
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.compliant} of ${summary.endpoints} endpoints`}
        />
        <StatCard
          label="Quarantined"
          value={`${summary.quarantined}`}
          icon={FingerprintPattern}
          accent={summary.quarantined > 0 ? 'text-warning' : 'text-success'}
          hint="isolated to the quarantine VLAN"
        />
        <StatCard
          label="Auth failures"
          value={`${summary.authFailures}`}
          icon={ShieldAlert}
          accent={
            summary.authFailures > 40
              ? 'text-destructive'
              : summary.authFailures > 0
                ? 'text-warning'
                : 'text-success'
          }
          hint="consecutive failures this window"
        />
        <StatCard
          label="EAP-TLS share"
          value={`${summary.eapTlsPct}%`}
          icon={KeyRound}
          accent={summary.eapTlsPct >= 50 ? 'text-success' : 'text-warning'}
          hint="certificate-based authentication"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-warning" />
              Findings
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {nac.findings.length} open · sorted by severity
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {nac.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every endpoint is authenticated and posture-compliant.
              </p>
            ) : (
              nac.findings.slice(0, FINDING_LIMIT).map((finding) => (
                <div
                  key={finding.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate">{finding.message}</span>
                  <Badge
                    variant={
                      finding.severity === 'critical' ||
                      finding.severity === 'high'
                        ? 'destructive'
                        : finding.severity === 'medium'
                          ? 'warning'
                          : 'secondary'
                    }
                    className="shrink-0 text-[10px]"
                  >
                    {finding.severity}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" />
              Posture checks
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Pass rate per check (guests excluded).
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {breakdown.map((row) => (
              <div key={row.key} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>{row.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {row.passPct}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={
                      row.passPct >= 85
                        ? 'h-full bg-success'
                        : row.passPct >= 60
                          ? 'h-full bg-warning'
                          : 'h-full bg-destructive'
                    }
                    style={{ width: `${row.passPct}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FingerprintPattern className="size-4 text-primary" />
            Endpoints
          </CardTitle>
          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span>
              methods:{' '}
              {Object.entries(summary.byMethod)
                .map(
                  ([method, count]) =>
                    `${METHOD_LABELS[method as keyof typeof METHOD_LABELS]} ${count}`,
                )
                .join(' · ')}
            </span>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Endpoint
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Access device
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Site
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Method
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Posture
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Failures
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {nac.endpoints
                .slice(0, ENDPOINT_LIMIT)
                .map((endpoint: Endpoint) => (
                  <tr key={endpoint.id} className="border-t border-border/50">
                    <td className="max-w-56 p-2">
                      <span className="block font-mono text-xs font-medium">
                        {endpoint.mac}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {KIND_LABELS[endpoint.kind]}
                      </span>
                    </td>
                    <td className="p-2 text-xs">{endpoint.deviceName}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {endpoint.site}
                    </td>
                    <td className="p-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">
                        {METHOD_LABELS[endpoint.method]}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Badge
                        variant={POSTURE_VARIANT[endpoint.posture]}
                        className="text-[10px]"
                      >
                        {POSTURE_LABELS[endpoint.posture]}
                      </Badge>
                    </td>
                    <td
                      className={`p-2 text-right text-xs tabular-nums ${
                        endpoint.authFailures >= 5
                          ? 'text-destructive'
                          : endpoint.authFailures > 0
                            ? 'text-warning'
                            : 'text-foreground'
                      }`}
                    >
                      {endpoint.authFailures}
                    </td>
                    <td className="p-2 text-right">
                      {endpoint.quarantined ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => release(endpoint.id)}
                        >
                          Release
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => quarantine(endpoint)}
                        >
                          Quarantine
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {nac.endpoints.length > ENDPOINT_LIMIT ? (
            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              showing {ENDPOINT_LIMIT} of {nac.endpoints.length} endpoints
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
