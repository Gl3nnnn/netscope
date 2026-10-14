import { describe, expect, it } from 'vitest'
import type { Device, DeviceType, Thresholds } from '@/types'
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  SITE_COORDINATES,
  buildSiteLinks,
  buildSiteMarkers,
  geoSummary,
  haversineKm,
  locationFor,
  project,
  projectToPixels,
  siteDistances,
} from '@/lib/geo'

const THRESHOLDS: Thresholds = {
  latencyMs: 120,
  packetLossPct: 1,
  availabilityPct: 99,
}

function device(
  id: string,
  type: DeviceType,
  site: string,
  overrides: Partial<Device> = {},
): Device {
  return {
    id,
    name: `${type} ${id}`,
    type,
    site,
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 600,
    capacityMbps: 2000,
    cpuPct: 48,
    memoryPct: 70,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

describe('locationFor', () => {
  it('returns curated coordinates for known sites', () => {
    expect(locationFor('Data Center A')).toEqual(
      SITE_COORDINATES['Data Center A'],
    )
  })

  it('falls back deterministically for unknown sites within valid bounds', () => {
    const a = locationFor('Custom Site 42')
    const b = locationFor('Custom Site 42')
    expect(a).toEqual(b)
    expect(a.lat).toBeGreaterThanOrEqual(-55)
    expect(a.lat).toBeLessThanOrEqual(75)
    expect(a.lng).toBeGreaterThanOrEqual(-160)
    expect(a.lng).toBeLessThanOrEqual(160)
  })
})

describe('project', () => {
  it('maps the equator and prime meridian to the centre', () => {
    expect(project({ lat: 0, lng: 0 })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('maps the corners to 0..1 space', () => {
    expect(project({ lat: 90, lng: -180 })).toEqual({ x: 0, y: 0 })
    expect(project({ lat: -90, lng: 180 })).toEqual({ x: 1, y: 1 })
  })

  it('scales to map pixels', () => {
    const { x, y } = projectToPixels({ lat: 0, lng: 0 })
    expect(x).toBe(MAP_WIDTH / 2)
    expect(y).toBe(MAP_HEIGHT / 2)
  })
})

describe('buildSiteMarkers', () => {
  it('rolls up counts and worst status per site', () => {
    const devices = [
      device('1', 'switch', 'SiteA'),
      device('2', 'accessPoint', 'SiteA', { status: 'degraded' }),
      device('3', 'server', 'SiteB', { status: 'offline' }),
      device('4', 'router', 'SiteB'),
    ]
    const markers = buildSiteMarkers(devices, THRESHOLDS)
    const a = markers.find((m) => m.site === 'SiteA')!
    const b = markers.find((m) => m.site === 'SiteB')!

    expect(a.deviceCount).toBe(2)
    expect(a.onlineCount).toBe(1)
    expect(a.degradedCount).toBe(1)
    expect(a.worstStatus).toBe('degraded')
    expect(a.critical).toBe(false)

    expect(b.worstStatus).toBe('offline')
    expect(b.offlineCount).toBe(1)
    expect(b.critical).toBe(true)
    expect(b.known).toBe(false)
  })

  it('sorts markers by site name and drops sites with no devices', () => {
    const devices = [
      device('1', 'switch', 'Zulu'),
      device('2', 'switch', 'Alpha'),
    ]
    const markers = buildSiteMarkers(devices, THRESHOLDS)
    expect(markers.map((m) => m.site)).toEqual(['Alpha', 'Zulu'])
  })

  it('scores an offline-only site at zero health', () => {
    const markers = buildSiteMarkers(
      [device('1', 'switch', 'Down', { status: 'offline' })],
      THRESHOLDS,
    )
    expect(markers[0].healthPct).toBe(0)
  })
})

describe('buildSiteLinks', () => {
  it('derives cross-site links and excludes intra-site pairs', () => {
    const devices = [
      device('core', 'router', 'DC'),
      device('a1', 'switch', 'SiteA'),
      device('a2', 'accessPoint', 'SiteA'),
      device('b1', 'switch', 'SiteB'),
    ]
    const links = buildSiteLinks(devices)
    const pairs = links
      .map((link) => [link.source, link.target].join('|'))
      .sort()
    expect(pairs).toEqual(['DC|SiteA', 'DC|SiteB'])
    expect(links.every((link) => link.crossSite)).toBe(true)
    expect(links.every((link) => link.weight >= 1)).toBe(true)
  })

  it('returns no links for a single site', () => {
    const devices = [
      device('1', 'switch', 'Only'),
      device('2', 'accessPoint', 'Only'),
    ]
    expect(buildSiteLinks(devices)).toEqual([])
  })
})

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 10, lng: 20 }, { lat: 10, lng: 20 })).toBe(0)
  })

  it('approximates London to Paris', () => {
    const km = haversineKm(
      { lat: 51.5074, lng: -0.1278 },
      { lat: 48.8566, lng: 2.3522 },
    )
    expect(km).toBeGreaterThan(330)
    expect(km).toBeLessThan(360)
  })
})

describe('siteDistances', () => {
  it('returns every pair sorted by distance ascending', () => {
    const distances = siteDistances([
      'Data Center A',
      'Data Center B',
      'Branch - West',
    ])
    expect(distances).toHaveLength(3)
    const kms = distances.map((d) => d.km)
    expect(kms).toEqual([...kms].sort((a, b) => a - b))
    expect(distances[0].km).toBeLessThan(distances[2].km)
  })
})

describe('geoSummary', () => {
  it('picks the worst site and the slowest cross-site link', () => {
    const devices = [
      device('core', 'router', 'DC', { latencyMs: 40 }),
      device('a1', 'switch', 'SiteA', { latencyMs: 200 }),
      device('b1', 'switch', 'SiteB', { status: 'offline', latencyMs: 500 }),
    ]
    const markers = buildSiteMarkers(devices, THRESHOLDS)
    const links = buildSiteLinks(devices)
    const summary = geoSummary(markers, links)

    expect(summary.sites).toBe(3)
    expect(summary.crossLinks).toBe(2)
    expect(summary.worstSite?.site).toBe('SiteB')
    expect(summary.slowestLink?.avgLatencyMs).toBeGreaterThan(0)
  })
})
