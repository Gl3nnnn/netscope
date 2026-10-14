import { useMemo } from 'react'
import { Cloud, DollarSign, Leaf, Server, Thermometer, Zap } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ENVIRONMENT_GRADE_LABELS,
  carbonBySite,
  devicePower,
  environmentScore,
  powerSummary,
  sitePower,
} from '@/lib/environment'
import { useNetworkStore } from '@/store/useNetworkStore'

export function EnvironmentPage() {
  const devices = useNetworkStore((state) => state.devices)

  const summary = useMemo(() => powerSummary(devices), [devices])
  const score = useMemo(() => environmentScore(devices), [devices])
  const sites = useMemo(() => carbonBySite(devices), [devices])
  const topEmitters = useMemo(
    () =>
      devices
        .map(devicePower)
        .sort((a, b) => b.watts - a.watts)
        .slice(0, 10),
    [devices],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Environment"
          description="Power draw, heat, carbon and energy cost across the fleet."
        />
        <EmptyState
          icon={Leaf}
          title="No devices to measure"
          description="Seed the fleet to model its environmental footprint."
        />
      </div>
    )
  }

  const gradeVariant =
    score.grade === 'excellent'
      ? 'success'
      : score.grade === 'good'
        ? 'warning'
        : 'destructive'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Environment"
        description="Deterministic power, heat, carbon and energy-cost modelling per device and site."
      />

      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <Leaf className="size-4 text-primary" />
          <span className="text-muted-foreground">
            {summary.deviceCount} devices · {summary.avgLoadPct}% average load ·{' '}
            {summary.coolingWatts.toFixed(0)} W cooling overhead
          </span>
          <Badge variant={gradeVariant} className="ml-auto">
            {ENVIRONMENT_GRADE_LABELS[score.grade]} · {score.score}%
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="IT power"
          value={`${summary.itWatts.toFixed(0)} W`}
          icon={Zap}
          hint={`peak ${summary.peakWatts.toFixed(0)} W`}
        />
        <StatCard
          label="Facility power"
          value={`${summary.facilityWatts.toFixed(0)} W`}
          icon={Thermometer}
          hint="includes cooling (PUE 1.45)"
        />
        <StatCard
          label="Carbon"
          value={`${summary.co2KgDay.toFixed(1)} kg/day`}
          icon={Cloud}
          hint="0.42 kg CO2 / kWh"
        />
        <StatCard
          label="Energy cost"
          value={`$${summary.costPerDay.toFixed(2)}/day`}
          icon={DollarSign}
          hint="$0.14 / kWh"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cloud className="size-4 text-primary" />
              Carbon by site
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sites.map((site) => {
              const max = sites[0]!.co2KgDay || 1
              return (
                <div key={site.site} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{site.site}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {site.co2KgDay.toFixed(2)} kg/day
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${Math.max(4, (site.co2KgDay / max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4 text-primary" />
              Top emitters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {topEmitters.map((power) => (
              <div
                key={power.deviceId}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate font-medium">{power.deviceName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {power.watts.toFixed(0)} W · {power.loadPct}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="size-4 text-primary" />
            Site power breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Site</th>
                  <th className="px-4 py-2 font-medium">Devices</th>
                  <th className="px-4 py-2 font-medium">IT power</th>
                  <th className="px-4 py-2 font-medium">Facility</th>
                  <th className="px-4 py-2 font-medium">Cooling</th>
                  <th className="px-4 py-2 font-medium">Avg load</th>
                  <th className="px-4 py-2 font-medium">CO2 / day</th>
                  <th className="px-4 py-2 font-medium">Cost / day</th>
                </tr>
              </thead>
              <tbody>
                {devices.length > 0
                  ? [...new Set(devices.map((d) => d.site))]
                      .sort()
                      .map((site) => {
                        const power = sitePower(devices, site)
                        return (
                          <tr
                            key={site}
                            className="border-b border-border/40 last:border-0"
                          >
                            <td className="px-4 py-2 font-medium">{site}</td>
                            <td className="px-4 py-2 tabular-nums">
                              {power.deviceCount}
                            </td>
                            <td className="px-4 py-2 tabular-nums">
                              {power.itWatts.toFixed(0)} W
                            </td>
                            <td className="px-4 py-2 tabular-nums">
                              {power.facilityWatts.toFixed(0)} W
                            </td>
                            <td className="px-4 py-2 tabular-nums">
                              {power.coolingWatts.toFixed(0)} W
                            </td>
                            <td className="px-4 py-2 tabular-nums">
                              {power.avgLoadPct}%
                            </td>
                            <td className="px-4 py-2 tabular-nums">
                              {power.co2KgDay.toFixed(2)} kg
                            </td>
                            <td className="px-4 py-2 tabular-nums">
                              ${power.costPerDay.toFixed(2)}
                            </td>
                          </tr>
                        )
                      })
                  : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
