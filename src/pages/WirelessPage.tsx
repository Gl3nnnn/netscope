import { useMemo } from 'react'
import { Radio, ShieldAlert, Signal, Wifi, WifiOff } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge, StatusBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct } from '@/lib/format'
import {
  BAND_LABELS,
  CLIENTS_PER_AP,
  CONGESTION_THRESHOLD,
  WIFI_SECURITY_LABELS,
  WEAK_RSSI_DBM,
  buildAccessPoints,
  coverageReport,
  detectRogues,
  fleetSites,
  siteSsids,
  wirelessFindings,
  wirelessSummary,
} from '@/lib/wireless'
import { useNetworkStore } from '@/store/useNetworkStore'

const COVERAGE_VARIANT = {
  covered: 'success',
  partial: 'warning',
  none: 'destructive',
} as const

const COVERAGE_LABEL = {
  covered: 'Covered',
  partial: 'Partial',
  none: 'No coverage',
} as const

const GRADE_ACCENT = {
  healthy: 'text-success',
  degraded: 'text-warning',
  critical: 'text-destructive',
} as const

export function WirelessPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const sites = useMemo(() => fleetSites(devices), [devices])
  const aps = useMemo(() => buildAccessPoints(devices, seed), [devices, seed])
  const rogues = useMemo(() => detectRogues(devices, seed), [devices, seed])
  const coverage = useMemo(
    () => coverageReport(devices, aps, seed),
    [devices, aps, seed],
  )
  const ssidsBySite = useMemo(
    () =>
      Object.fromEntries(sites.map((site) => [site, siteSsids(site, seed)])),
    [sites, seed],
  )
  const findings = useMemo(
    () => wirelessFindings(aps, rogues, coverage, ssidsBySite),
    [aps, rogues, coverage, ssidsBySite],
  )
  const summary = useMemo(
    () => wirelessSummary(aps, rogues, coverage, findings),
    [aps, rogues, coverage, findings],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Wireless & RF"
          description="SSID plans, channel interference, clients and coverage."
        />
        <EmptyState
          icon={WifiOff}
          title="No fleet to scan"
          description="Seed the fleet to model the wireless estate."
        />
      </div>
    )
  }

  const sortedFindings = findings.slice(0, 12)

  return (
    <div className="space-y-5">
      <PageHeader
        title="Wireless & RF"
        description="Simulated WLAN estate: dual-radio channel plans, co-channel interference, client density, rogue detection and site coverage planning."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Wireless health"
          value={`${summary.score}`}
          icon={summary.grade === 'healthy' ? Wifi : ShieldAlert}
          accent={GRADE_ACCENT[summary.grade]}
          hint={`${summary.findings} findings`}
        />
        <StatCard
          label="Access points"
          value={`${summary.onlineAps}/${summary.aps}`}
          icon={Signal}
          accent={
            summary.onlineAps < summary.aps ? 'text-warning' : 'text-success'
          }
          hint={`${summary.radios} radios online`}
        />
        <StatCard
          label="Clients"
          value={`${summary.clients}`}
          icon={Radio}
          hint={`${summary.avgClientsPerAp} per AP avg`}
        />
        <StatCard
          label="Rogue APs"
          value={`${summary.rogues}`}
          icon={ShieldAlert}
          accent={summary.rogues > 0 ? 'text-destructive' : 'text-success'}
          hint={`${formatPct(summary.coveragePct, 0)} sites covered`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Signal className="size-4 text-primary" />
            Channel plan &amp; radio health
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Greedy per-site channel assignment. Congestion at or above{' '}
            {CONGESTION_THRESHOLD}% utilisation; weak clients at {WEAK_RSSI_DBM}{' '}
            dBm or worse.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  AP
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Site
                </th>
                <th className="p-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  2.4 GHz
                </th>
                <th className="p-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  5 GHz
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Clients
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  RSSI / SNR
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Weak clients
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {aps.map((ap) => {
                const radio24 = ap.radios.find((r) => r.band === '2.4GHz')!
                const radio5 = ap.radios.find((r) => r.band === '5GHz')!
                return (
                  <tr key={ap.id} className="border-t border-border/50">
                    <td className="p-2">
                      <span className="font-medium">{ap.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {ap.model}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {ap.site}
                    </td>
                    {[radio24, radio5].map((radio) => (
                      <td key={radio.band} className="p-2 text-center text-xs">
                        <span className="tabular-nums">
                          ch {radio.channel} · {radio.widthMhz} MHz
                        </span>
                        <span
                          className={`ml-1 tabular-nums ${
                            radio.utilisationPct >= CONGESTION_THRESHOLD
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {formatPct(radio.utilisationPct, 0)}
                        </span>
                        {radio.coChannel > 0 ? (
                          <Badge
                            variant="warning"
                            className="ml-1 align-middle text-[10px]"
                          >
                            CCI×{radio.coChannel}
                          </Badge>
                        ) : null}
                      </td>
                    ))}
                    <td className="p-2 text-right tabular-nums">
                      {ap.clients}
                    </td>
                    <td className="p-2 text-right text-xs tabular-nums">
                      {ap.avgRssiDbm} dBm / {ap.snrDbm} dB
                    </td>
                    <td className="p-2 text-right text-xs tabular-nums">
                      <span
                        className={
                          ap.weakClientPct > 15
                            ? 'text-warning'
                            : 'text-muted-foreground'
                        }
                      >
                        {ap.weakClientPct}%
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      <StatusBadge status={ap.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {aps.length === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              No managed access points in the inventory — every site below is a
              coverage gap.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wifi className="size-4 text-primary" />
            Coverage planning
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {summary.sitesCovered} of {summary.sitesTotal} sites with wireless
            service ({CLIENTS_PER_AP} clients per AP guideline).
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {coverage.map((site) => (
            <div key={site.site} className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant={COVERAGE_VARIANT[site.status]}>
                    {COVERAGE_LABEL[site.status]}
                  </Badge>
                  <span className="font-medium">{site.site}</span>
                  <span className="text-xs text-muted-foreground">
                    {site.clients} clients
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {site.apsDeployed}/{site.apsRequired} APs
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${COVERAGE_VARIANT[site.status] === 'success' ? 'bg-success' : COVERAGE_VARIANT[site.status] === 'warning' ? 'bg-warning' : 'bg-destructive'}`}
                  style={{ width: `${site.coveragePct}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="size-4 text-primary" />
              Broadcast SSIDs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {sites.map((site) => (
              <div key={site} className="text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {site}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(ssidsBySite[site] ?? []).map((ssid) => (
                    <span
                      key={ssid.name}
                      className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-xs"
                      title={`${WIFI_SECURITY_LABELS[ssid.security]} · VLAN ${ssid.vlan} · ${ssid.bands.map((b) => BAND_LABELS[b]).join(', ')}`}
                    >
                      {ssid.name}
                      <span className="text-[10px] text-muted-foreground">
                        {WIFI_SECURITY_LABELS[ssid.security]}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-warning" />
              Rogue access points
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rogues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No unauthorised SSIDs detected in this scan window.
              </p>
            ) : (
              rogues.map((rogue) => (
                <div
                  key={rogue.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <SeverityBadge severity={rogue.severity} />
                    <span className="truncate font-medium">"{rogue.ssid}"</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {rogue.site} · {BAND_LABELS[rogue.band]} ch
                      {rogue.channel}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {WIFI_SECURITY_LABELS[rogue.security]} ·{' '}
                    {Math.round(rogue.confidence * 100)}%
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4 text-warning" />
            RF findings
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {findings.length} total · sorted by severity
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No interference, coverage or security issues detected.
            </p>
          ) : (
            sortedFindings.map((finding) => (
              <div
                key={finding.id}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <span className="flex min-w-0 items-start gap-2">
                  <SeverityBadge severity={finding.severity} />
                  <span className="truncate">{finding.message}</span>
                </span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {finding.kind}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
