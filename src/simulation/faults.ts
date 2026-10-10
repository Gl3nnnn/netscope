import type { Device, FaultInjection } from '@/types'

/** Combined effect of every active fault on a single device. */
export interface FaultEffect {
  /** Pin the device offline for this step. */
  forcedOffline: boolean
  /** Pin throughput toward the capacity ceiling for this step. */
  saturated: boolean
}

export const FAULT_LABELS: Record<FaultInjection['kind'], string> = {
  'device-offline': 'Device outage',
  'site-outage': 'Site outage',
  saturate: 'Link saturation',
}

export const FAULT_TRIGGERS: Record<FaultInjection['kind'], string> = {
  'device-offline': 'Stop responding',
  'site-outage': 'Sever site',
  saturate: 'Saturate link',
}

/** Whether a fault is still active at time `now`. */
export function isFaultActive(fault: FaultInjection, now: number): boolean {
  return fault.expiresAt === null || fault.expiresAt > now
}

/** The still-active subset of `faults` at time `now` (order preserved). */
export function activeFaults(
  faults: FaultInjection[],
  now: number,
): FaultInjection[] {
  return faults.filter((fault) => isFaultActive(fault, now))
}

/**
 * Resolve the combined effect of all active faults on one device. Site outages
 * apply to every device at the target site; device faults target one id.
 */
export function resolveFaultEffect(
  faults: FaultInjection[],
  device: Pick<Device, 'id' | 'site'>,
  now: number,
): FaultEffect {
  let forcedOffline = false
  let saturated = false
  for (const fault of faults) {
    if (!isFaultActive(fault, now)) continue
    if (fault.kind === 'device-offline' && fault.target === device.id) {
      forcedOffline = true
    } else if (fault.kind === 'site-outage' && fault.target === device.site) {
      forcedOffline = true
    } else if (fault.kind === 'saturate' && fault.target === device.id) {
      saturated = true
    }
  }
  return { forcedOffline, saturated }
}

/** Site names currently targeted by an active site-outage fault. */
export function faultedSites(faults: FaultInjection[], now: number): string[] {
  const sites = new Set<string>()
  for (const fault of faults) {
    if (fault.kind === 'site-outage' && isFaultActive(fault, now)) {
      sites.add(fault.target)
    }
  }
  return [...sites]
}

/** Human-readable target description used in timeline events. */
export function describeFaultTarget(
  fault: Pick<FaultInjection, 'kind' | 'target'>,
  devices: Device[],
): string {
  if (fault.kind === 'site-outage') return `site ${fault.target}`
  const device = devices.find((item) => item.id === fault.target)
  return device ? `${device.name} (${device.site})` : fault.target
}
