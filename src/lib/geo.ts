import type { Device, DeviceStatus, Thresholds } from '@/types'
import { average } from './aggregate'
import { computeHealthScore } from './health'
import { deriveLinks } from './topology'
import { hashString } from './configs'

/**
 * Geographic operations map.
 *
 * Projects sites onto a stylised world map (equirectangular, no tiles — the app
 * is fully offline). Known sites get curated real-world coordinates; unknown
 * sites fall back to a deterministic hash so custom sites always land in the
 * same place. Markers carry live health, and cross-site topology links are
 * graded by weight and latency. Pure and deterministic.
 */

export interface GeoPoint {
  lat: number
  lng: number
}

/** Curated coordinates for the seeded sites (a plausible global footprint). */
export const SITE_COORDINATES: Record<string, GeoPoint> = {
  'HQ - Floor 1': { lat: 51.5074, lng: -0.1278 },
  'HQ - Floor 2': { lat: 51.516, lng: -0.09 },
  'Data Center A': { lat: 50.1109, lng: 8.6821 },
  'Data Center B': { lat: 52.3676, lng: 4.9041 },
  'Branch - West': { lat: 40.7128, lng: -74.006 },
  'Branch - East': { lat: 1.3521, lng: 103.8198 },
}

/** Deterministic coordinate for a site: curated when known, else hashed. */
export function locationFor(site: string): GeoPoint {
  const known = SITE_COORDINATES[site]
  if (known) return known
  const hash = hashString(site)
  const lat = -55 + (hash % 1300) / 10
  const lng = -160 + ((hash >>> 10) % 3200) / 10
  return { lat, lng }
}

/** Project a coordinate into normalised 0..1 map space (equirectangular). */
export function project(point: GeoPoint): { x: number; y: number } {
  return {
    x: (point.lng + 180) / 360,
    y: (90 - point.lat) / 180,
  }
}

export const MAP_WIDTH = 720
export const MAP_HEIGHT = 360

export function projectToPixels(
  point: GeoPoint,
  width = MAP_WIDTH,
  height = MAP_HEIGHT,
): { x: number; y: number } {
  const { x, y } = project(point)
  return { x: x * width, y: y * height }
}

const STATUS_RANK: Record<DeviceStatus, number> = {
  online: 0,
  degraded: 1,
  offline: 2,
}

export interface SiteMarker {
  site: string
  point: GeoPoint
  x: number
  y: number
  known: boolean
  deviceCount: number
  onlineCount: number
  degradedCount: number
  offlineCount: number
  healthPct: number
  avgLatencyMs: number
  worstStatus: DeviceStatus
  critical: boolean
}

/** Build one marker per site with live health and counts. */
export function buildSiteMarkers(
  devices: Device[],
  thresholds: Thresholds,
): SiteMarker[] {
  const bySite = new Map<string, Device[]>()
  for (const device of devices) {
    const list = bySite.get(device.site) ?? []
    list.push(device)
    bySite.set(device.site, list)
  }

  return [...bySite.entries()]
    .map(([site, members]) => {
      const point = locationFor(site)
      const { x, y } = project(point)
      const worstStatus = members.reduce<DeviceStatus>(
        (worst, device) =>
          STATUS_RANK[device.status] > STATUS_RANK[worst]
            ? device.status
            : worst,
        'online',
      )
      return {
        site,
        point,
        x,
        y,
        known: site in SITE_COORDINATES,
        deviceCount: members.length,
        onlineCount: members.filter((d) => d.status === 'online').length,
        degradedCount: members.filter((d) => d.status === 'degraded').length,
        offlineCount: members.filter((d) => d.status === 'offline').length,
        healthPct: average(
          members.map((d) => computeHealthScore(d, thresholds)),
        ),
        avgLatencyMs: average(members.map((d) => d.latencyMs)),
        worstStatus,
        critical: worstStatus === 'offline',
      } satisfies SiteMarker
    })
    .sort((a, b) => a.site.localeCompare(b.site))
}

export interface GeoLink {
  source: string
  target: string
  weight: number
  avgLatencyMs: number
  crossSite: boolean
}

/** Site-to-site links derived from the topology, deduped and weighted. */
export function buildSiteLinks(devices: Device[]): GeoLink[] {
  const siteOf = new Map(devices.map((device) => [device.id, device.site]))
  const latencyOf = new Map(
    devices.map((device) => [device.id, device.latencyMs]),
  )
  const links = deriveLinks(devices)
  const buckets = new Map<
    string,
    { source: string; target: string; latency: number[] }
  >()

  for (const link of links) {
    const source = siteOf.get(link.source)
    const target = siteOf.get(link.target)
    if (!source || !target || source === target) continue
    const [a, b] = [source, target].sort()
    const key = `${a}|${b}`
    const bucket = buckets.get(key) ?? { source: a, target: b, latency: [] }
    bucket.latency.push(
      (latencyOf.get(link.source) ?? 0) + (latencyOf.get(link.target) ?? 0),
    )
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .map((bucket) => ({
      source: bucket.source,
      target: bucket.target,
      weight: bucket.latency.length,
      avgLatencyMs: average(bucket.latency),
      crossSite: true,
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        a.source.localeCompare(b.source) ||
        a.target.localeCompare(b.target),
    )
}

/** Great-circle distance in kilometres between two coordinates. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface SiteDistance {
  a: string
  b: string
  km: number
}

/** All site-to-site distances, nearest first. */
export function siteDistances(sites: string[]): SiteDistance[] {
  const out: SiteDistance[] = []
  for (let i = 0; i < sites.length; i += 1) {
    for (let j = i + 1; j < sites.length; j += 1) {
      out.push({
        a: sites[i],
        b: sites[j],
        km: haversineKm(locationFor(sites[i]), locationFor(sites[j])),
      })
    }
  }
  return out.sort((x, y) => x.km - y.km)
}

export interface GeoSummary {
  sites: number
  knownSites: number
  crossLinks: number
  worstSite: SiteMarker | null
  /** Longest cross-site link by average latency. */
  slowestLink: GeoLink | null
}

export function geoSummary(
  markers: SiteMarker[],
  links: GeoLink[],
): GeoSummary {
  const offline = markers.filter((marker) => marker.worstStatus === 'offline')
  const worstSite =
    offline.sort((a, b) => b.offlineCount - a.offlineCount)[0] ??
    markers
      .filter((marker) => marker.worstStatus === 'degraded')
      .sort((a, b) => b.degradedCount - a.degradedCount)[0] ??
    null
  const slowestLink =
    [...links].sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)[0] ?? null

  return {
    sites: markers.length,
    knownSites: markers.filter((marker) => marker.known).length,
    crossLinks: links.length,
    worstSite,
    slowestLink,
  }
}
