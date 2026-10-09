import type { Device, Incident, MetricSample, Severity } from '@/types'
import { average } from './aggregate'

export interface SiteSla {
  site: string
  devices: number
  incidents: number
  uptimePct: number
}

export interface SlaSummary {
  /** Mean availability across the whole fleet, 0-100. */
  uptimePct: number
  /** Mean time to acknowledge, in milliseconds (null when nothing acknowledged). */
  mttaMs: number | null
  /** Mean time to resolve, in milliseconds (null when nothing resolved). */
  mttrMs: number | null
  totalIncidents: number
  openIncidents: number
  resolvedIncidents: number
  bySeverity: Record<Severity, number>
  sites: SiteSla[]
}

/** Mean time from incident creation to acknowledgement. */
export function meanTimeToAcknowledge(incidents: Incident[]): number | null {
  const durations = incidents
    .filter((incident) => incident.acknowledgedAt !== undefined)
    .map((incident) =>
      Math.max(0, (incident.acknowledgedAt as number) - incident.createdAt),
    )
  return durations.length > 0 ? average(durations) : null
}

/** Mean time from incident creation to resolution. */
export function meanTimeToResolve(incidents: Incident[]): number | null {
  const durations = incidents
    .filter((incident) => incident.resolvedAt !== undefined)
    .map((incident) =>
      Math.max(0, (incident.resolvedAt as number) - incident.createdAt),
    )
  return durations.length > 0 ? average(durations) : null
}

export function incidentsBySeverity(
  incidents: Incident[],
): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const incident of incidents) counts[incident.severity] += 1
  return counts
}

/**
 * Uptime for a single device, derived from its historical availability samples
 * and falling back to its current live percentage when no history is available.
 */
export function deviceUptimePct(
  device: Device,
  history?: MetricSample[],
): number {
  if (history && history.length > 0) {
    return average(history.map((sample) => sample.availabilityPct))
  }
  return device.availabilityPct
}

/** Fleet-wide mean uptime. */
export function fleetUptimePct(
  devices: Device[],
  history: Record<string, MetricSample[]>,
): number {
  if (devices.length === 0) return 0
  return average(
    devices.map((device) => deviceUptimePct(device, history[device.id])),
  )
}

/**
 * Per-site SLA rollup: device count, distinct incidents touching the site and
 * mean uptime. Sorted worst-uptime first so problem sites surface at the top.
 */
export function siteSla(
  devices: Device[],
  incidents: Incident[],
  history: Record<string, MetricSample[]>,
): SiteSla[] {
  const sites = new Map<string, Device[]>()
  for (const device of devices) {
    const list = sites.get(device.site) ?? []
    list.push(device)
    sites.set(device.site, list)
  }

  const deviceToSite = new Map(
    devices.map((device) => [device.id, device.site]),
  )
  const incidentsPerSite = new Map<string, number>()
  for (const incident of incidents) {
    const counted = new Set<string>()
    for (const deviceId of incident.deviceIds) {
      const site = deviceToSite.get(deviceId)
      if (site && !counted.has(site)) {
        counted.add(site)
        incidentsPerSite.set(site, (incidentsPerSite.get(site) ?? 0) + 1)
      }
    }
  }

  return [...sites.entries()]
    .map(([site, siteDevices]) => ({
      site,
      devices: siteDevices.length,
      incidents: incidentsPerSite.get(site) ?? 0,
      uptimePct: average(
        siteDevices.map((device) =>
          deviceUptimePct(device, history[device.id]),
        ),
      ),
    }))
    .sort((a, b) => a.uptimePct - b.uptimePct)
}

export function computeSla(
  devices: Device[],
  incidents: Incident[],
  history: Record<string, MetricSample[]>,
): SlaSummary {
  const resolvedIncidents = incidents.filter(
    (incident) => incident.status === 'resolved',
  ).length
  return {
    uptimePct: fleetUptimePct(devices, history),
    mttaMs: meanTimeToAcknowledge(incidents),
    mttrMs: meanTimeToResolve(incidents),
    totalIncidents: incidents.length,
    openIncidents: incidents.length - resolvedIncidents,
    resolvedIncidents,
    bySeverity: incidentsBySeverity(incidents),
    sites: siteSla(devices, incidents, history),
  }
}
