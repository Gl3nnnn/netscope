import type {
  Device,
  FaultInjection,
  Incident,
  MetricSample,
  Thresholds,
  TimelineEvent,
} from '@/types'
import { createId } from '@/lib/id'
import { advanceDevice } from './metrics'
import { faultedSites, resolveFaultEffect } from './faults'
import { autoResolveIncidents, generateIncidents } from './incidents'
import type { Rng } from './random'
import { trafficMultiplier } from './timecurve'

export interface TickInput {
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
  /** Integer number of inner steps to advance. */
  steps: number
  incidentFrequency: number
  now: number
  rng: Rng
  /** Simulated wall-clock time between inner steps, in milliseconds. */
  stepMs?: number
  /** User-injected faults the engine should honour this tick. */
  faults?: FaultInjection[]
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
  const stepMs = Math.max(1000, input.stepMs ? input.stepMs : 5000)
  const faults = input.faults ?? []
  const events: TimelineEvent[] = []
  let devices = input.devices

  const sites = [...new Set(input.devices.map((device) => device.site))]
  const disturbedSites = new Set<string>()
  const load = trafficMultiplier(now)
  const siteOutageChance = 0.02 * incidentFrequency * (0.6 + 0.8 * load)

  for (let s = 0; s < steps; s += 1) {
    // Inner steps share one wall-clock tick but are simulated as if they
    // happened at staggered times, so history and events read naturally.
    const eventTime = now - (steps - 1 - s) * stepMs

    // User-injected site outages count as disturbed sites for incident merging.
    for (const site of faultedSites(faults, eventTime)) {
      disturbedSites.add(site)
    }

    // Occasionally a whole site is disturbed at once, degrading every device in
    // it and producing correlated incidents (realistic for shared uplinks).
    const distressedSite =
      sites.length > 0 && rng.chance(siteOutageChance) ? rng.pick(sites) : null
    if (distressedSite) {
      disturbedSites.add(distressedSite)
      events.push({
        id: createId('evt'),
        timestamp: eventTime,
        type: 'status',
        severity: 'high',
        message: `Site-wide disturbance detected at ${distressedSite}`,
      })
    }

    const advanced = devices.map((device) => {
      const affected = distressedSite !== null && device.site === distressedSite
      const effect = resolveFaultEffect(faults, device, eventTime)
      return advanceDevice(device, rng, thresholds, eventTime, {
        intensity: affected ? 2.5 : 1,
        outageBoost: affected ? 6 : 0,
        forcedOffline: effect.forcedOffline,
        saturated: effect.saturated,
        stepMs,
      })
    })
    devices = advanced.map((entry) => entry.device)

    for (const entry of advanced) {
      if (!entry.statusChanged) continue
      events.push({
        id: createId('evt'),
        timestamp: eventTime,
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
    affectedSiteIds: [...disturbedSites],
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
