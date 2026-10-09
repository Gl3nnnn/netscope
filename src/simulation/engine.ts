import type {
  Device,
  Incident,
  MetricSample,
  Thresholds,
  TimelineEvent,
} from '@/types'
import { createId } from '@/lib/id'
import { advanceDevice } from './metrics'
import { autoResolveIncidents, generateIncidents } from './incidents'
import type { Rng } from './random'

export interface TickInput {
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
  /** Integer number of inner steps to advance. */
  steps: number
  incidentFrequency: number
  now: number
  rng: Rng
}

export interface TickResult {
  devices: Device[]
  incidents: Incident[]
  /** New samples keyed by device id. */
  samples: Record<string, MetricSample>
  /** New timeline events (newest last). */
  events: TimelineEvent[]
}

/**
 * Advance the whole simulation by one or more steps. This is the single source
 * of truth for how DEMO telemetry evolves and is deliberately free of any
 * React / DOM dependencies so it can be unit tested.
 */
export function runTick(input: TickInput): TickResult {
  const { thresholds, incidentFrequency, now, rng } = input
  const steps = Math.max(1, Math.round(input.steps))

  const events: TimelineEvent[] = []
  let devices = input.devices

  const sites = [...new Set(input.devices.map((device) => device.site))]
  const siteOutageChance = 0.02 * incidentFrequency

  for (let s = 0; s < steps; s += 1) {
    // Occasionally a whole site is disturbed at once, degrading every device in
    // it and producing correlated incidents (realistic for shared uplinks).
    const distressedSite =
      sites.length > 0 && rng.chance(siteOutageChance) ? rng.pick(sites) : null
    if (distressedSite) {
      events.push({
        id: createId('evt'),
        timestamp: now,
        type: 'status',
        severity: 'high',
        message: `Site-wide disturbance detected at ${distressedSite}`,
      })
    }

    const advanced = devices.map((device) => {
      const affected = distressedSite !== null && device.site === distressedSite
      return advanceDevice(device, rng, thresholds, now, {
        intensity: affected ? 2.5 : 1,
        outageBoost: affected ? 6 : 0,
      })
    })
    devices = advanced.map((entry) => entry.device)

    for (const entry of advanced) {
      if (!entry.statusChanged) continue
      events.push({
        id: createId('evt'),
        timestamp: now,
        type: 'status',
        deviceId: entry.device.id,
        message: `${entry.device.name} changed status to ${entry.device.status}`,
      })
    }
  }

  const generated = generateIncidents({
    devices,
    incidents: input.incidents,
    thresholds,
    frequency: incidentFrequency / Math.max(1, steps),
    rng,
    now,
  })
  events.push(...generated.events)

  const resolved = autoResolveIncidents({
    devices,
    incidents: [...input.incidents, ...generated.incidents],
    thresholds,
    rng,
    now,
  })
  events.push(...resolved.events)

  const samples: Record<string, MetricSample> = {}
  for (const device of devices) {
    samples[device.id] = {
      t: now,
      latencyMs: device.latencyMs,
      packetLossPct: device.packetLossPct,
      availabilityPct: device.availabilityPct,
      throughputMbps: device.throughputMbps,
      cpuPct: device.cpuPct,
      memoryPct: device.memoryPct,
    }
  }

  return {
    devices,
    incidents: resolved.incidents,
    samples,
    events,
  }
}
