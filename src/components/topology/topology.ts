import type { Device, DeviceType } from '@/types'

export interface TopoLink {
  source: string
  target: string
}

/** Visual radius per device type, used by the topology renderer. */
export const NODE_RADIUS: Record<DeviceType, number> = {
  router: 22,
  firewall: 20,
  switch: 18,
  server: 16,
  accessPoint: 14,
}

const HUB_PRIORITY: DeviceType[] = [
  'router',
  'firewall',
  'switch',
  'server',
  'accessPoint',
]

function pickHub(devices: Device[]): Device {
  for (const type of HUB_PRIORITY) {
    const match = devices.find((device) => device.type === type)
    if (match) return match
  }
  return devices[0]
}

/**
 * Derive a plausible, connected topology graph purely from the inventory:
 * each site connects to a site hub, and every hub connects to a global core.
 * Pure function, unit-testable, and independent of any D3 state.
 */
export function deriveLinks(devices: Device[]): TopoLink[] {
  if (devices.length < 2) return []

  const links: TopoLink[] = []
  const seen = new Set<string>()
  const add = (source: string, target: string) => {
    if (source === target) return
    const key = [source, target].sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    links.push({ source, target })
  }

  const bySite = new Map<string, Device[]>()
  for (const device of devices) {
    const list = bySite.get(device.site) ?? []
    list.push(device)
    bySite.set(device.site, list)
  }

  const core = devices.find((device) => device.type === 'router') ?? devices[0]

  for (const siteDevices of bySite.values()) {
    const hub = pickHub(siteDevices)
    for (const device of siteDevices) {
      if (device.id !== hub.id) add(hub.id, device.id)
    }
    if (hub.id !== core.id) add(core.id, hub.id)
  }

  return links
}
