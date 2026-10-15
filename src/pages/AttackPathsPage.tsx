import { useMemo } from 'react'
import { Crosshair, Gauge, ShieldAlert, Target } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  MAX_PATHS,
  runAttackPaths,
  type AttackPath,
  type RiskBand,
} from '@/lib/attackpath'
import { useCertStore } from '@/store/useCertStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useServicesStore } from '@/store/useServicesStore'
import { useVulnStore } from '@/store/useVulnStore'

const PATH_LIMIT = 10

const BAND_VARIANT: Record<RiskBand, 'destructive' | 'warning' | 'secondary'> =
  {
    critical: 'destructive',
    high: 'destructive',
    medium: 'warning',
    low: 'secondary',
  }

const STEP_LABEL: Record<AttackPath['steps'][number]['kind'], string> = {
  entry: 'Entry',
  lateral: 'Lateral',
  target: 'Target',
}

export function AttackPathsPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const dispositions = useVulnStore((state) => state.dispositions)
  const certOverrides = useCertStore((state) => state.overrides)
  const services = useServicesStore((state) => state.services)

  const result = useMemo(
    () =>
      runAttackPaths({
        devices,
        seed,
        statuses: dispositions,
        certOverrides,
        services,
      }),
    [devices, seed, dispositions, certOverrides, services],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Attack Paths"
          description="Exposure graph and choke points."
        />
        <EmptyState
          icon={Crosshair}
          title="No fleet to attack"
          description="Seed the fleet to model exposure paths."
        />
      </div>
    )
  }

  const { summary } = result

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attack Paths"
        description="Cross-engine exposure analysis: open management ports, critical CVEs (honouring your patch dispositions) and expired certificates feed a topology-aware graph that ranks how an intruder could reach P1/P2 services — with the choke points that break the most paths."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Paths found"
          value={`${summary.paths}`}
          icon={Crosshair}
          accent={summary.paths > 0 ? 'text-warning' : 'text-success'}
          hint={`avg risk ${summary.avgRisk}`}
        />
        <StatCard
          label="Critical paths"
          value={`${summary.critical}`}
          icon={Target}
          accent={summary.critical > 0 ? 'text-destructive' : 'text-success'}
          hint={`${summary.high} high · ${summary.medium} medium · ${summary.low} low`}
        />
        <StatCard
          label="Exposure points"
          value={`${summary.exposures}`}
          icon={ShieldAlert}
          accent={summary.exposures > 0 ? 'text-warning' : 'text-success'}
          hint="ports, CVEs and certificates"
        />
        <StatCard
          label="Top risk score"
          value={`${summary.topRisk}`}
          icon={Gauge}
          accent={
            summary.topRisk >= 75
              ? 'text-destructive'
              : summary.topRisk >= 55
                ? 'text-warning'
                : 'text-success'
          }
          hint="worst ranked path, 0–100"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {result.paths.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No reachable attack paths — exposures are either remediated or
                segmented away from your critical services.
              </CardContent>
            </Card>
          ) : (
            result.paths.slice(0, PATH_LIMIT).map((path) => (
              <Card key={path.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Crosshair className="size-4 text-destructive" />
                      {path.steps[0]!.deviceName} → {path.targetService}
                      <Badge variant="outline" className="text-[10px]">
                        {path.tier.toUpperCase()}
                      </Badge>
                    </CardTitle>
                    <span className="flex items-center gap-2">
                      <Badge
                        variant={BAND_VARIANT[path.band]}
                        className="text-[10px]"
                      >
                        {path.band} · risk {path.risk}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {path.lateralHops} hops
                      </Badge>
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ol className="space-y-1.5">
                    {path.steps.map((step, index) => (
                      <li
                        key={`${path.id}-${index}`}
                        className="flex items-start gap-2 text-sm"
                      >
                        <Badge
                          variant="outline"
                          className="mt-0.5 shrink-0 text-[10px]"
                        >
                          {STEP_LABEL[step.kind]}
                        </Badge>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate font-medium">
                            {step.deviceName}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {step.detail}
                          </span>
                        </span>
                        <SeverityBadge severity={step.severity} />
                      </li>
                    ))}
                  </ol>
                  <div className="rounded-md border border-border/60 bg-muted/30 p-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Mitigations
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {path.mitigations.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
          {result.paths.length > PATH_LIMIT ? (
            <p className="text-center text-[11px] text-muted-foreground">
              showing worst {PATH_LIMIT} of {result.paths.length} ranked paths
              (cap {MAX_PATHS})
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="size-4 text-primary" />
                Choke points
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Intermediate devices on the most ranked paths.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.chokePoints.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No lateral hops to instrument.
                </p>
              ) : (
                result.chokePoints.slice(0, 6).map((point) => (
                  <div
                    key={point.deviceId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate">{point.deviceName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {point.pathCount} paths · {point.sharePct}%
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="size-4 text-warning" />
                Exposure inventory
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {result.exposures.length} open exposure points.
              </p>
            </CardHeader>
            <CardContent className="space-y-2">
              {result.exposures.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No exposed ports, critical CVEs or expired certificates.
                </p>
              ) : (
                result.exposures.slice(0, 8).map((item) => (
                  <div key={item.id} className="space-y-0.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        {item.deviceName}
                      </span>
                      <SeverityBadge severity={item.severity} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {item.detail}
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
