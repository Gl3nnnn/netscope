import { useMemo } from 'react'
import {
  Droplets,
  DoorOpen,
  Gauge,
  Thermometer,
  TriangleAlert,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  HUMIDITY_BAND_PCT,
  TEMP_BAND_C,
  runFacility,
  type SiteStatus,
} from '@/lib/facility'
import { useNetworkStore } from '@/store/useNetworkStore'

const STATUS_VARIANT: Record<
  SiteStatus,
  'destructive' | 'warning' | 'secondary'
> = {
  critical: 'destructive',
  warning: 'warning',
  ok: 'secondary',
}

const KIND_LABEL = {
  'temp-high': 'Hot spot',
  'temp-low': 'Over-cooled',
  humidity: 'Humidity',
  leak: 'Leak',
  smoke: 'Smoke',
  'door-open': 'Door open',
} as const

const READING_UNIT: Record<string, string> = {
  temp: '°C',
  humidity: '%RH',
  leak: '',
  smoke: '',
  door: ' min',
}

export function FacilityPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)
  const lastTick = useNetworkStore((state) => state.lastTick)

  const result = useMemo(
    () => runFacility(devices, seed, lastTick),
    [devices, seed, lastTick],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Facility Sensors"
          description="Temperature, humidity & environmental alarms."
        />
        <EmptyState
          icon={Thermometer}
          title="No facilities to monitor"
          description="Seed the fleet to place site sensors."
        />
      </div>
    )
  }

  const { sites, findings, summary } = result

  return (
    <div className="space-y-5">
      <PageHeader
        title="Facility Sensors"
        description="DCIM sensor overlay for the power/heat model: CRAC supply and hot-aisle return temperatures, sub-floor leak, perimeter smoke, humidity and door contacts — banded by ASHRAE (18–27 °C, 40–60 %RH) and correlated with live facility load to spot hot spots."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sites OK"
          value={`${summary.ok}/${summary.sites}`}
          icon={Gauge}
          accent={
            summary.critical > 0
              ? 'text-destructive'
              : summary.warning > 0
                ? 'text-warning'
                : 'text-success'
          }
          hint={`${summary.warning} warning · ${summary.critical} critical`}
        />
        <StatCard
          label="Hottest site"
          value={`${summary.hottestTempC} °C`}
          icon={Thermometer}
          accent={
            summary.hottestTempC >= 27 ? 'text-destructive' : 'text-success'
          }
          hint={summary.hottestSite}
        />
        <StatCard
          label="Avg temperature"
          value={`${summary.avgTempC} °C`}
          icon={Thermometer}
          accent="text-primary"
          hint={`band ${TEMP_BAND_C[0]}–${TEMP_BAND_C[1]} °C`}
        />
        <StatCard
          label="Findings"
          value={`${summary.findings}`}
          icon={TriangleAlert}
          accent={summary.findings > 0 ? 'text-warning' : 'text-success'}
          hint={`${summary.sensors} sensors reporting`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {sites.map((site) => (
            <Card key={site.site}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Thermometer className="size-4 text-primary" />
                    {site.site}
                    <Badge
                      variant={STATUS_VARIANT[site.status]}
                      className="text-[10px]"
                    >
                      {site.status}
                    </Badge>
                  </CardTitle>
                  <span className="text-xs text-muted-foreground">
                    {site.facilityWatts.toFixed(0)} W facility load · hot zone:{' '}
                    {site.hottestZone}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-3">
                  {site.sensors.map((sensor) => (
                    <div
                      key={sensor.id}
                      className={`rounded-md border p-2 ${
                        sensor.inBand
                          ? 'border-border/60'
                          : 'border-destructive/50 bg-destructive/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[11px] text-muted-foreground">
                          {sensor.zone}
                        </span>
                        {sensor.kind === 'leak' ? (
                          <Droplets
                            className={`size-3.5 ${sensor.reading === 1 ? 'text-destructive' : 'text-success'}`}
                          />
                        ) : sensor.kind === 'door' ? (
                          <DoorOpen
                            className={`size-3.5 ${sensor.reading > 10 ? 'text-warning' : 'text-success'}`}
                          />
                        ) : null}
                      </div>
                      <p className="text-sm font-medium tabular-nums">
                        {sensor.kind === 'leak' || sensor.kind === 'smoke'
                          ? sensor.reading === 1
                            ? 'ALARM'
                            : 'clear'
                          : `${sensor.reading}${READING_UNIT[sensor.kind] ?? ''}`}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {sensor.label}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
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
                  All sensors in band — no environmental alarms.
                </p>
              ) : (
                findings.slice(0, 8).map((finding) => (
                  <div
                    key={finding.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      <Badge variant="outline" className="mr-2 text-[10px]">
                        {KIND_LABEL[finding.kind]}
                      </Badge>
                      {finding.message}
                    </span>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Operating envelope</CardTitle>
              <p className="text-xs text-muted-foreground">
                ASHRAE recommended bands.
              </p>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Temperature</span>
                <span className="tabular-nums">
                  {TEMP_BAND_C[0]} – {TEMP_BAND_C[1]} °C
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Humidity</span>
                <span className="tabular-nums">
                  {HUMIDITY_BAND_PCT[0]} – {HUMIDITY_BAND_PCT[1]} %RH
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Door open</span>
                <span className="tabular-nums">≤ 10 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hot spot alert</span>
                <span className="tabular-nums">≥ 30 °C critical</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
