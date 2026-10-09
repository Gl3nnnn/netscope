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
 */
export function generateIncidents(params: {
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
  frequency: number
  rng: RngLike
  now: number
}): { incidents: Incident[]; events: TimelineEvent[] } {
  const { devices, incidents, thresholds, frequency, rng, now } = params
  const created: Incident[] = []
  const events: TimelineEvent[] = []

  if (frequency <= 0) return { incidents: created, events }

  for (const device of devices) {
    if (device.inMaintenance) continue
    if (activeIncidentForDevice([...incidents, ...created], device.id)) continue

    const score = computeHealthScore(device, thresholds)
    const unhealthy = device.status === 'offline' || score < 72
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
    created.push(incident)
    events.push({
      id: createId('evt'),
      timestamp: now,
      type: 'incident',
      severity,
      deviceId: device.id,
      message: `Incident opened: ${incident.title} (${device.name})`,
    })
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
