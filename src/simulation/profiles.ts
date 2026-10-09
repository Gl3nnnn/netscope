import type { DeviceType } from '@/types'

/**
 * Per-type baseline telemetry profile. The simulation mean-reverts each device
 * toward these values and scales its random-walk spread by `volatility`, which
 * gives every device type a plausible personality (switches are steady,
 * access points and servers are noisy).
 */
export interface DeviceProfile {
  latencyMs: number
  packetLossPct: number
  throughputMbps: number
  cpuPct: number
  memoryPct: number
  /** Multiplier applied to random-walk spread and spike intensity. */
  volatility: number
}

export const TYPE_PROFILES: Record<DeviceType, DeviceProfile> = {
  router: {
    latencyMs: 3,
    packetLossPct: 0.05,
    throughputMbps: 1800,
    cpuPct: 32,
    memoryPct: 55,
    volatility: 0.9,
  },
  switch: {
    latencyMs: 1.4,
    packetLossPct: 0.02,
    throughputMbps: 3200,
    cpuPct: 24,
    memoryPct: 48,
    volatility: 0.7,
  },
  firewall: {
    latencyMs: 6,
    packetLossPct: 0.08,
    throughputMbps: 1200,
    cpuPct: 41,
    memoryPct: 62,
    volatility: 1.1,
  },
  server: {
    latencyMs: 12,
    packetLossPct: 0.1,
    throughputMbps: 640,
    cpuPct: 48,
    memoryPct: 70,
    volatility: 1.3,
  },
  accessPoint: {
    latencyMs: 9,
    packetLossPct: 0.35,
    throughputMbps: 420,
    cpuPct: 29,
    memoryPct: 52,
    volatility: 1.5,
  },
}

export function profileFor(type: DeviceType): DeviceProfile {
  return TYPE_PROFILES[type]
}
