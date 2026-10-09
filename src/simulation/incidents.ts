import type {
  Device,
  Incident,
  Severity,
  Thresholds,
  TimelineEvent,
} from '@/types'
import { createId } from '@/lib/id'
import { computeHealthScore, severityForScore } from '@/lib/health'

const SEVERITY_TITLES: Record<Severity, string> = {
  critical: 'Critical connectivity failure',
  high: 'Service degradation detected',
  medium: 'Intermittent performance issues',
  low: 'Minor performance variance',
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

function worstSeverity(severities: Severity[]): Severity {
  return severities.reduce(
    (worst, severity) =>
      SEVERITY_RANK[severity] > SEVERITY_RANK[worst] ? severity : worst,
    'low' as Severity,
  )
}

function activeIncidentForDevice(
  incidents: Incident[],
  deviceId: string,
): Incident | undefined {
  return incidents.find(
    (incident) =>
      incident.status !== 'resolved' && incident.deviceIds.includes(deviceId),
  )
}

/**
 * Decide whether new incidents should be opened for degraded/offline devices.
 * Returns any newly created incidents and matching timeline events.
 *
 * Devices in a site listed in `affectedSiteIds` (a site-wide disturbance)
 * are bundled into a single merged incident for that site, with the worst
 * member severity, instead of one incident per device.
 */
export function generateIncidents(params: {
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
  frequency: number
  rng: RngLike
  now: number
  affectedSiteIds?: string[]
}): { incidents: Incident[]; events: TimelineEvent[] } {
  const { devices, incidents, thresholds, frequency, rng, now } = params
  const affectedSites = new Set(params.affectedSiteIds ?? [])
  const created: Incident[] = []
  const events: TimelineEvent[] = []

  if (frequency <= 0) return { incidents: created, events }

  const unhealthyScore = (device: Device) => {
    const score = computeHealthScore(device, thresholds)
    const unhealthy = device.status === 'offline' || score < 72
    return { score, unhealthy }
  }

  const pushIncident = (incident: Incident, message: string) => {
    created.push(incident)
    events.push({
      id: createId('evt'),
      timestamp: now,
      type: 'incident',
      severity: incident.severity,
      deviceId: incident.deviceIds[0],
      message,
    })
  }

  // Merge unhealthy devices of every disturbed site into one incident per site.
  const mergedBySite = new Map<string, Device[]>()
  for (const device of devices) {
    if (!affectedSites.has(device.site)) continue
    if (device.inMaintenance) continue
    if (activeIncidentForDevice([...incidents, ...created], device.id)) continue
    if (!unhealthyScore(device).unhealthy) continue
    const list = mergedBySite.get(device.site) ?? []
    list.push(device)
    mergedBySite.set(device.site, list)
  }

  for (const [site, siteDevices] of mergedBySite) {
    const anyOffline = siteDevices.some((device) => device.status === 'offline')
    const baseChance = anyOffline ? 0.5 : 0.22
    if (!rng.chance(baseChance * frequency)) continue

    const severity = worstSeverity(
      siteDevices.map((device) =>
        severityForScore(unhealthyScore(device).score),
      ),
    )
    const affectedNames = siteDevices.map((device) => device.name).join(', ')
    pushIncident(
      {
        id: createId('inc'),
        title: `Site-wide degradation at ${site}`,
        description: `${siteDevices.length} device(s) at ${site} are degraded or offline: ${affectedNames}.`,
        severity,
        status: 'open',
        deviceIds: siteDevices.map((device) => device.id),
        createdAt: now,
        updatedAt: now,
      },
      `Incident opened: site-wide degradation at ${site} (${siteDevices.length} device(s))`,
    )
  }

  for (const device of devices) {
    if (affectedSites.has(device.site)) continue
    if (device.inMaintenance) continue
    if (activeIncidentForDevice([...incidents, ...created], device.id)) continue

    const { score, unhealthy } = unhealthyScore(device)
    if (!unhealthy) continue

    const baseChance = device.status === 'offline' ? 0.5 : 0.22
    if (!rng.chance(baseChance * frequency)) continue

    const severity = severityForScore(score)
    const incident: Incident = {
      id: createId('inc'),
      title: SEVERITY_TITLES[severity],
      description:
        device.status === 'offline'
          ? `${device.name} (${device.ip}) stopped responding to simulated probes at ${device.site}.`
          : `${device.name} (${device.ip}) is reporting elevated latency/loss in the ${device.site} simulation.`,
      severity,
      status: 'open',
      deviceIds: [device.id],
      createdAt: now,
      updatedAt: now,
    }
    pushIncident(
      incident,
      `Incident opened: ${incident.title} (${device.name})`,
    )
  }

  return { incidents: created, events }
}

/**
 * Auto-resolve incidents whose affected devices have fully recovered. User
 * initiated acknowledgements/resolutions live in the store.
 */
export function autoResolveIncidents(params: {
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
  rng: RngLike
  now: number
}): { incidents: Incident[]; events: TimelineEvent[] } {
  const { devices, incidents, thresholds, rng, now } = params
  const resolved: Incident[] = []
  const events: TimelineEvent[] = []
  const byId = new Map(devices.map((d) => [d.id, d]))

  const next = incidents.map((incident) => {
    if (incident.status === 'resolved') return incident

    const affected = incident.deviceIds
      .map((id) => byId.get(id))
      .filter((d): d is Device => Boolean(d))
    if (affected.length === 0) return incident

    const allHealthy = affected.every(
      (d) => d.status === 'online' && computeHealthScore(d, thresholds) >= 88,
    )
    if (!allHealthy || !rng.chance(0.3)) return incident

    const updated: Incident = {
      ...incident,
      status: 'resolved',
      updatedAt: now,
      resolvedAt: now,
    }
    resolved.push(updated)
    events.push({
      id: createId('evt'),
      timestamp: now,
      type: 'incident',
      severity: incident.severity,
      deviceId: incident.deviceIds[0],
      message: `Incident auto-resolved: ${incident.title}`,
    })
    return updated
  })

  if (resolved.length === 0) return { incidents, events }
  return { incidents: next, events }
}

/** Minimal structural type to avoid a circular import with random.ts. */
interface RngLike {
  chance(p: number): boolean
}
