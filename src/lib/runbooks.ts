import type { Device, FaultInjection, Incident } from '@/types'
import { SATURATION_THRESHOLD_PCT, utilizationPct } from './capacity'
import { resolveFaultEffect } from '@/simulation/faults'

export type RunbookId = 'offline' | 'saturation' | 'degraded' | 'investigate'

export interface Runbook {
  id: RunbookId
  title: string
  summary: string
  steps: string[]
  /** Whether "Apply runbook" can safely auto-remediate in the DEMO engine. */
  autoRemediable: boolean
}

export const RUNBOOKS: Record<RunbookId, Runbook> = {
  offline: {
    id: 'offline',
    title: 'Host unreachable',
    summary:
      'The device has stopped responding. Verify the path, then restore service.',
    steps: [
      'Confirm power and physical cabling to the device',
      'Check the upstream switch port for errors or err-disable',
      'Restart the network service or bounce the interface',
      'Confirm telemetry returns to baseline before closing',
    ],
    autoRemediable: true,
  },
  saturation: {
    id: 'saturation',
    title: 'Link saturation',
    summary:
      'Utilisation is at or above the saturation ceiling and pushing latency up.',
    steps: [
      'Identify the top talkers on the saturated link',
      'Apply QoS / rate limiting to the noisy tenant',
      'Reroute or add capacity to the uplink',
      'Confirm utilisation falls below the saturation threshold',
    ],
    autoRemediable: true,
  },
  degraded: {
    id: 'degraded',
    title: 'Performance degradation',
    summary:
      'Latency, loss or availability crossed a threshold but the device is up.',
    steps: [
      'Review recent changes and correlated alerts',
      'Check CPU and memory for resource pressure',
      'Restart the affected service to clear leaked state',
      'Watch for ten minutes to confirm it holds',
    ],
    autoRemediable: true,
  },
  investigate: {
    id: 'investigate',
    title: 'Manual investigation',
    summary:
      'No single device fault was isolated. Triage from the topology outward.',
    steps: [
      'Gather scope from the dependent-device blast radius',
      'Correlate recent timeline events and deployments',
      'Escalate to the owning team with evidence attached',
      'Record findings for the incident postmortem',
    ],
    autoRemediable: false,
  },
}

export interface RunbookSignals {
  offline: boolean
  saturation: boolean
  degraded: boolean
}

/** Pick the most urgent runbook that fits the observed signals. */
export function matchRunbook(signals: RunbookSignals): Runbook {
  if (signals.offline) return RUNBOOKS.offline
  if (signals.saturation) return RUNBOOKS.saturation
  if (signals.degraded) return RUNBOOKS.degraded
  return RUNBOOKS.investigate
}

/** Derive triage signals from a set of devices plus any active faults. */
export function signalsForDevices(
  devices: Device[],
  faults: FaultInjection[] = [],
  now = 0,
): RunbookSignals {
  let offline = false
  let saturation = false
  let degraded = false
  for (const device of devices) {
    const effect = resolveFaultEffect(faults, device, now)
    const util = utilizationPct(device.throughputMbps, device.capacityMbps)
    if (effect.forcedOffline || device.status === 'offline') {
      offline = true
    } else if (effect.saturated || util >= SATURATION_THRESHOLD_PCT) {
      saturation = true
    } else if (device.status === 'degraded') {
      degraded = true
    }
  }
  return { offline, saturation, degraded }
}

/** Choose a runbook for an incident by looking at its affected devices. */
export function runbookForIncident(input: {
  incident: Incident
  devices: Device[]
  faults?: FaultInjection[]
  now?: number
}): Runbook {
  const targets = new Set(input.incident.deviceIds)
  const affected = input.devices.filter((device) => targets.has(device.id))
  return matchRunbook(
    signalsForDevices(affected, input.faults ?? [], input.now ?? 0),
  )
}
