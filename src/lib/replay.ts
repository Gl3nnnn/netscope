import type { Device, Incident, Thresholds, TimelineEvent } from '@/types'
import { overallHealth, averageLatency } from '@/lib/aggregate'
import { fleetUtilization, utilizationPct } from '@/lib/capacity'
import { round } from '@/lib/format'

/**
 * Time Machine — a bounded, in-memory ring buffer of fleet frames used to scrub
 * back through the recent simulation, replay an incident and diff any two
 * moments. Frames are never persisted; they live only for the session.
 */

export const MAX_REPLAY_FRAMES = 240

export interface ReplayFrame {
  t: number
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
  /** Fleet-wide health score 0-100. */
  health: number
  openIncidents: number
  offlineCount: number
  degradedCount: number
  fleetUtilPct: number
  avgLatencyMs: number
}

export interface CaptureInput {
  t: number
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
  thresholds: Thresholds
}

/** Snapshot the fleet and its derived aggregates into a replay frame. */
export function captureFrame(input: CaptureInput): ReplayFrame {
  const { devices, incidents } = input
  let offlineCount = 0
  let degradedCount = 0
  for (const device of devices) {
    if (device.status === 'offline') offlineCount += 1
    else if (device.status === 'degraded') degradedCount += 1
  }
  return {
    t: input.t,
    devices,
    incidents,
    events: input.events,
    health: round(overallHealth(devices, input.thresholds), 1),
    openIncidents: incidents.filter(
      (incident) => incident.status !== 'resolved',
    ).length,
    offlineCount,
    degradedCount,
    fleetUtilPct: round(fleetUtilization(devices), 1),
    avgLatencyMs: round(averageLatency(devices), 1),
  }
}

/** Append a frame, trimming the ring buffer to `max` frames. */
export function pushFrame(
  frames: ReplayFrame[],
  frame: ReplayFrame,
  max = MAX_REPLAY_FRAMES,
): ReplayFrame[] {
  const next = [...frames, frame]
  return next.length > max ? next.slice(next.length - max) : next
}

/** Index of the frame nearest a timestamp (binary search; 0 when empty). */
export function nearestFrameIndex(frames: ReplayFrame[], t: number): number {
  if (frames.length === 0) return 0
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (frames[mid]!.t < t) low = mid + 1
    else high = mid
  }
  const candidate = frames[low]!
  const prev = frames[low - 1]
  if (prev && Math.abs(prev.t - t) <= Math.abs(candidate.t - t)) {
    return low - 1
  }
  return low
}

export interface DeviceDelta {
  id: string
  name: string
  site: string
  statusFrom: Device['status']
  statusTo: Device['status']
  latencyMs: number
  throughputMbps: number
  cpuPct: number
  memoryPct: number
  utilFrom: number
  utilTo: number
}

export interface FrameDiff {
  from: ReplayFrame
  to: ReplayFrame
  /** Devices whose status changed between the two frames. */
  statusChanges: DeviceDelta[]
  /** Devices present in both frames, with metric deltas. */
  metricChanges: DeviceDelta[]
  addedIds: string[]
  removedIds: string[]
  health: number
  openIncidents: number
  offlineCount: number
  fleetUtilPct: number
  avgLatencyMs: number
}

function deltaFor(before: Device, after: Device): DeviceDelta {
  return {
    id: after.id,
    name: after.name,
    site: after.site,
    statusFrom: before.status,
    statusTo: after.status,
    latencyMs: round(after.latencyMs - before.latencyMs, 1),
    throughputMbps: round(after.throughputMbps - before.throughputMbps, 1),
    cpuPct: round(after.cpuPct - before.cpuPct, 1),
    memoryPct: round(after.memoryPct - before.memoryPct, 1),
    utilFrom: round(
      utilizationPct(before.throughputMbps, before.capacityMbps),
      1,
    ),
    utilTo: round(utilizationPct(after.throughputMbps, after.capacityMbps), 1),
  }
}

/** Compare two frames to highlight what changed. */
export function diffFrames(from: ReplayFrame, to: ReplayFrame): FrameDiff {
  const before = new Map(from.devices.map((device) => [device.id, device]))
  const after = new Map(to.devices.map((device) => [device.id, device]))
  const statusChanges: DeviceDelta[] = []
  const metricChanges: DeviceDelta[] = []

  for (const [id, nextDevice] of after) {
    const prevDevice = before.get(id)
    if (!prevDevice) continue
    const delta = deltaFor(prevDevice, nextDevice)
    if (delta.statusFrom !== delta.statusTo) statusChanges.push(delta)
    metricChanges.push(delta)
  }

  const addedIds = [...after.keys()].filter((id) => !before.has(id))
  const removedIds = [...before.keys()].filter((id) => !after.has(id))

  return {
    from,
    to,
    statusChanges: statusChanges.sort((a, b) => a.name.localeCompare(b.name)),
    metricChanges: metricChanges.sort(
      (a, b) => Math.abs(b.latencyMs) - Math.abs(a.latencyMs),
    ),
    addedIds,
    removedIds,
    health: round(to.health - from.health, 1),
    openIncidents: to.openIncidents - from.openIncidents,
    offlineCount: to.offlineCount - from.offlineCount,
    fleetUtilPct: round(to.fleetUtilPct - from.fleetUtilPct, 1),
    avgLatencyMs: round(to.avgLatencyMs - from.avgLatencyMs, 1),
  }
}

/** The frames where an incident first appears (its creation window). */
export function seekIncidentTime(
  frames: ReplayFrame[],
  incident: Pick<Incident, 'createdAt'>,
): number {
  return nearestFrameIndex(frames, incident.createdAt)
}

/** Incidents that opened between two adjacent frames, newest first. */
export function incidentsOpenedIn(
  frame: ReplayFrame,
  previous: ReplayFrame | null,
): Incident[] {
  const beforeIds = new Set(
    (previous?.incidents ?? []).map((incident) => incident.id),
  )
  return frame.incidents
    .filter((incident) => !beforeIds.has(incident.id))
    .sort((a, b) => b.createdAt - a.createdAt)
}
