/**
 * Capacity utilisation helpers.
 *
 * Every DEMO device carries a `capacityMbps` ceiling so utilisation, headroom
 * and saturation risk are real, testable numbers rather than raw throughput.
 */

export const SATURATION_THRESHOLD_PCT = 80

export interface CapacityView {
  throughputMbps: number
  capacityMbps: number
}

/** Utilisation as a percentage of the capacity ceiling, clamped to [0, 100]. */
export function utilizationPct(
  throughputMbps: number,
  capacityMbps: number,
): number {
  if (!Number.isFinite(capacityMbps) || capacityMbps <= 0) return 0
  return Math.min(100, Math.max(0, (throughputMbps / capacityMbps) * 100))
}

/** Mean utilisation across a fleet or site. */
export function avgUtilization(devices: CapacityView[]): number {
  if (devices.length === 0) return 0
  const total = devices.reduce(
    (sum, device) =>
      sum + utilizationPct(device.throughputMbps, device.capacityMbps),
    0,
  )
  return total / devices.length
}

/** Highest single-device utilisation in a fleet or site. */
export function maxUtilization(devices: CapacityView[]): number {
  return devices.reduce(
    (max, device) =>
      Math.max(max, utilizationPct(device.throughputMbps, device.capacityMbps)),
    0,
  )
}

/** Aggregate headroom: how full the fleet is as a share of total capacity. */
export function fleetUtilization(devices: CapacityView[]): number {
  const totalCapacity = devices.reduce(
    (sum, device) => sum + device.capacityMbps,
    0,
  )
  if (totalCapacity <= 0) return 0
  const totalThroughput = devices.reduce(
    (sum, device) => sum + device.throughputMbps,
    0,
  )
  return utilizationPct(totalThroughput, totalCapacity)
}

/** Devices whose utilisation is at or above the saturation threshold. */
export function saturated(devices: CapacityView[]): CapacityView[] {
  return devices.filter(
    (device) =>
      utilizationPct(device.throughputMbps, device.capacityMbps) >=
      SATURATION_THRESHOLD_PCT,
  )
}
