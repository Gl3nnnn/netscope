import type { Device, DeviceStatus, DeviceType } from '@/types'

export type DeviceSortKey =
  | 'name'
  | 'type'
  | 'site'
  | 'status'
  | 'latencyMs'
  | 'packetLossPct'
  | 'availabilityPct'
  | 'cpuPct'

export type SortDirection = 'asc' | 'desc'

export interface DeviceFilters {
  query: string
  type: DeviceType | 'all'
  status: DeviceStatus | 'all'
  site: string | 'all'
}

export const EMPTY_FILTERS: DeviceFilters = {
  query: '',
  type: 'all',
  status: 'all',
  site: 'all',
}

export function filterDevices(
  devices: Device[],
  filters: DeviceFilters,
): Device[] {
  const query = filters.query.trim().toLowerCase()
  return devices.filter((device) => {
    if (filters.type !== 'all' && device.type !== filters.type) return false
    if (filters.status !== 'all' && device.status !== filters.status)
      return false
    if (filters.site !== 'all' && device.site !== filters.site) return false
    if (!query) return true
    return (
      device.name.toLowerCase().includes(query) ||
      device.ip.toLowerCase().includes(query) ||
      device.mac.toLowerCase().includes(query) ||
      device.site.toLowerCase().includes(query) ||
      device.tags.some((tag) => tag.toLowerCase().includes(query))
    )
  })
}

export function sortDevices(
  devices: Device[],
  key: DeviceSortKey,
  direction: SortDirection = 'asc',
): Device[] {
  const sorted = [...devices].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (typeof av === 'number' && typeof bv === 'number') return av - bv
    return String(av).localeCompare(String(bv))
  })
  return direction === 'asc' ? sorted : sorted.reverse()
}

export function deviceSites(devices: Device[]): string[] {
  return [...new Set(devices.map((device) => device.site))].sort()
}

/**
 * Reset a device to a clean, healthy snapshot. Used by remediation runbooks to
 * bring a faulted device back online immediately instead of waiting for the
 * random walk to recover it. Pure, so it is easy to unit test.
 */
export function recoverDevice(device: Device, now: number): Device {
  return {
    ...device,
    status: 'online',
    latencyMs: 4,
    packetLossPct: 0,
    availabilityPct: 100,
    cpuPct: Math.min(device.cpuPct, 15),
    memoryPct: Math.min(device.memoryPct, 25),
    inMaintenance: false,
    flapping: false,
    uptimeSec: 0,
    lastSeen: now,
  }
}
