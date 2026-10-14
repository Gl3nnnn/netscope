import { useMemo, useState } from 'react'
import { Globe2, MapPin, Network, Route } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GeoMap } from '@/components/geo/GeoMap'
import { formatMs, formatPct, round } from '@/lib/format'
import { DEVICE_TYPE_LABELS, STATUS_HEX } from '@/lib/health'
import {
  buildSiteLinks,
  buildSiteMarkers,
  geoSummary,
  siteDistances,
  type SiteMarker,
} from '@/lib/geo'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'

const STATUS_VARIANT = {
  online: 'success',
  degraded: 'warning',
  offline: 'destructive',
} as const

function HealthBar({ value }: { value: number }) {
  const tone =
    value >= 90
      ? 'bg-emerald-500'
      : value >= 70
        ? 'bg-amber-500'
        : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatPct(value)}
      </span>
    </div>
  )
}

export function GeoPage() {
  const devices = useNetworkStore((state) => state.devices)
  const thresholds = useSettingsStore((state) => state.thresholds)
  const [selected, setSelected] = useState<string | null>(null)

  const markers = useMemo(
    () => buildSiteMarkers(devices, thresholds),
    [devices, thresholds],
  )
  const links = useMemo(() => buildSiteLinks(devices), [devices])
  const distances = useMemo(
    () => siteDistances(markers.map((marker) => marker.site)),
    [markers],
  )
  const summary = useMemo(() => geoSummary(markers, links), [markers, links])

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Geographic Operations"
          description="A world view of your sites, health and cross-site links."
        />
        <EmptyState
          icon={Globe2}
          title="No sites to map"
          description="Seed the fleet to place your first site."
        />
      </div>
    )
  }

  const nearestOf = (site: string): number | null => {
    const near = distances.find(
      (distance) => distance.a === site || distance.b === site,
    )
    return near ? near.km : null
  }

  const selectedMarker: SiteMarker | null =
    markers.find((marker) => marker.site === selected) ?? null
  const selectedDevices = selected
    ? devices.filter((device) => device.site === selected)
    : []

  return (
    <div className="space-y-5">
      <PageHeader
        title="Geographic Operations"
        description="A world view of your sites, health and cross-site links."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Sites"
          value={`${summary.sites}`}
          icon={MapPin}
          hint={`${summary.knownSites} at curated coordinates`}
        />
        <StatCard
          label="Cross-site links"
          value={`${summary.crossLinks}`}
          icon={Network}
        />
        <StatCard
          label="Worst region"
          value={summary.worstSite ? summary.worstSite.site : 'None'}
          icon={Globe2}
          accent={summary.worstSite ? 'text-destructive' : 'text-success'}
          hint={
            summary.worstSite
              ? `${summary.worstSite.offlineCount} offline`
              : 'all sites healthy'
          }
        />
        <StatCard
          label="Slowest link"
          value={
            summary.slowestLink
              ? formatMs(summary.slowestLink.avgLatencyMs)
              : '—'
          }
          icon={Route}
          hint={
            summary.slowestLink
              ? `${summary.slowestLink.source} ↔ ${summary.slowestLink.target}`
              : 'no cross-site links'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe2 className="size-4 text-primary" />
              Site map
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <GeoMap
              markers={markers}
              links={links}
              selected={selected}
              onSelect={setSelected}
            />
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <i
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: STATUS_HEX.online }}
                />
                online
              </span>
              <span className="flex items-center gap-1.5">
                <i
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: STATUS_HEX.degraded }}
                />
                degraded
              </span>
              <span className="flex items-center gap-1.5">
                <i
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: STATUS_HEX.offline }}
                />
                offline
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-0.5 w-6 bg-emerald-500" />
                &lt;60ms
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-0.5 w-6 bg-amber-500" />
                &lt;120ms
              </span>
              <span className="flex items-center gap-1.5">
                <i className="h-0.5 w-6 bg-rose-500" />
                ≥120ms
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Site detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedMarker ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {selectedMarker.site}
                  </span>
                  <Badge variant={STATUS_VARIANT[selectedMarker.worstStatus]}>
                    {selectedMarker.worstStatus}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedMarker.known
                    ? 'curated coordinates'
                    : 'derived coordinates'}{' '}
                  · {round(selectedMarker.point.lat, 1)},{' '}
                  {round(selectedMarker.point.lng, 1)}
                </p>
                <HealthBar value={selectedMarker.healthPct} />
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span className="text-muted-foreground">Devices</span>
                  <span className="text-right tabular-nums">
                    {selectedMarker.deviceCount}
                  </span>
                  <span className="text-muted-foreground">Avg latency</span>
                  <span className="text-right tabular-nums">
                    {formatMs(selectedMarker.avgLatencyMs)}
                  </span>
                  <span className="text-muted-foreground">Offline</span>
                  <span className="text-right tabular-nums">
                    {selectedMarker.offlineCount}
                  </span>
                </div>
                <ul className="space-y-1.5 border-t border-border/60 pt-3">
                  {selectedDevices.map((device) => (
                    <li
                      key={device.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <i
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: STATUS_HEX[device.status] }}
                        />
                        <span className="truncate">{device.name}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {DEVICE_TYPE_LABELS[device.type]} ·{' '}
                        {formatMs(device.latencyMs)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Select a marker to inspect a site.
                </p>
                {summary.worstSite ? (
                  <button
                    className="w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-left text-xs"
                    onClick={() => setSelected(summary.worstSite!.site)}
                  >
                    <span className="font-medium">
                      Focus {summary.worstSite.site}
                    </span>
                    <span className="block text-muted-foreground">
                      {summary.worstSite.offlineCount} offline device(s)
                    </span>
                  </button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4 text-primary" />
            Site roster
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Site</th>
                  <th className="py-2 pr-4 font-medium">Devices</th>
                  <th className="py-2 pr-4 font-medium">Health</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Avg latency</th>
                  <th className="py-2 font-medium">Nearest site</th>
                </tr>
              </thead>
              <tbody>
                {markers.map((marker) => {
                  const nearest = nearestOf(marker.site)
                  return (
                    <tr
                      key={marker.site}
                      className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/40"
                      onClick={() =>
                        setSelected(
                          selected === marker.site ? null : marker.site,
                        )
                      }
                    >
                      <td className="py-2 pr-4 font-medium">{marker.site}</td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {marker.deviceCount}
                      </td>
                      <td className="py-2 pr-4">
                        <HealthBar value={marker.healthPct} />
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_VARIANT[marker.worstStatus]}>
                          {marker.worstStatus}
                        </Badge>
                      </td>
                      <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                        {formatMs(marker.avgLatencyMs)}
                      </td>
                      <td className="py-2 tabular-nums text-muted-foreground">
                        {nearest === null
                          ? '—'
                          : `${nearest < 1 ? '<1' : round(nearest)} km`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Route className="size-4 text-primary" />
              Longest cross-site links
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {links.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cross-site links.
              </p>
            ) : (
              [...links]
                .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
                .slice(0, 6)
                .map((link) => (
                  <div
                    key={`${link.source}|${link.target}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="truncate">
                      {link.source} ↔ {link.target}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatMs(link.avgLatencyMs)}
                    </span>
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="size-4 text-primary" />
              Nearest site pairs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {distances.slice(0, 6).map((distance) => (
              <div
                key={`${distance.a}|${distance.b}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate">
                  {distance.a} ↔ {distance.b}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {distance.km < 1 ? '<1' : round(distance.km)} km
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
