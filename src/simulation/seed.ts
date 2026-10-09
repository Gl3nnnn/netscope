import type { Device, DeviceInput, DeviceType } from '@/types'
import { clamp, round } from '@/lib/format'
import { seededId } from '@/lib/id'
import type { Rng } from './random'
import { TYPE_PROFILES } from './profiles'

export const SITES = [
  'HQ - Floor 1',
  'HQ - Floor 2',
  'Data Center A',
  'Data Center B',
  'Branch - West',
  'Branch - East',
] as const

const NAME_PREFIX: Record<DeviceType, string> = {
  router: 'rtr',
  switch: 'sw',
  firewall: 'fw',
  server: 'srv',
  accessPoint: 'ap',
}

const TYPE_SEQUENCE: DeviceType[] = [
  'router',
  'switch',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]

function macFromRng(rng: Rng): string {
  const hex = () => Math.floor(rng.range(0, 256)).toString(16).padStart(2, '0')
  return Array.from({ length: 6 }, hex).join(':').toUpperCase()
}

export function makeDevice(
  partial: Partial<Device> & Pick<Device, 'id' | 'name' | 'type' | 'site'>,
  rng: Rng,
  now = Date.now(),
): Device {
  const profile = TYPE_PROFILES[partial.type]
  const cpuBase = partial.cpuPct ?? profile.cpuPct + rng.noise(8)
  return {
    id: partial.id,
    name: partial.name,
    type: partial.type,
    site: partial.site,
    ip:
      partial.ip ?? `10.${rng.int(0, 40)}.${rng.int(0, 40)}.${rng.int(2, 250)}`,
    mac: partial.mac ?? macFromRng(rng),
    status: partial.status ?? 'online',
    tags: partial.tags ?? [partial.type],
    latencyMs:
      partial.latencyMs ?? round(profile.latencyMs + rng.range(0, 3), 2),
    packetLossPct:
      partial.packetLossPct ??
      round(clamp(profile.packetLossPct + rng.range(0, 0.1), 0, 20), 2),
    availabilityPct:
      partial.availabilityPct ?? round(rng.range(99.5, 99.99), 3),
    throughputMbps:
      partial.throughputMbps ??
      round(profile.throughputMbps * rng.range(0.4, 0.9), 1),
    capacityMbps: partial.capacityMbps ?? profile.capacityMbps,
    cpuPct: round(clamp(cpuBase, 2, 99), 1),
    memoryPct:
      partial.memoryPct ??
      round(clamp(profile.memoryPct + rng.noise(10), 10, 92), 1),
    uptimeSec: partial.uptimeSec ?? rng.int(3600, 60 * 60 * 24 * 90),
    lastSeen: partial.lastSeen ?? now,
  }
}

/**
 * Build a deterministic set of DEMO devices spread across several sites.
 * ~24 devices total, weighted towards less powerful gear.
 */
export function buildSeedDevices(rng: Rng, now = Date.now()): Device[] {
  const devices: Device[] = []
  const target = 24

  for (let i = 0; i < target; i += 1) {
    const type = TYPE_SEQUENCE[i % TYPE_SEQUENCE.length] as DeviceType
    const site = SITES[i % SITES.length]
    const seq = Math.floor(i / SITES.length) + 1
    const name = `${NAME_PREFIX[type]}-${site.split(' ').pop()!.toLowerCase()}-${seq}`
    devices.push(
      makeDevice(
        {
          id: seededId('dev', i + 1),
          name,
          type,
          site,
          tags: [type, site.startsWith('Data Center') ? 'core' : 'edge'],
        },
        rng,
        now,
      ),
    )
  }

  return devices
}

/** Build a new device from user input using a live RNG. */
export function deviceFromInput(
  input: DeviceInput,
  rng: Rng,
  now = Date.now(),
): Device {
  return makeDevice(
    {
      id: `dev_${Date.now().toString(36)}_${Math.floor(rng.range(0, 1e6)).toString(36)}`,
      name: input.name.trim(),
      type: input.type,
      site: input.site.trim(),
      ip: input.ip.trim(),
      mac: input.mac.trim().toUpperCase(),
      tags: input.tags,
    },
    rng,
    now,
  )
}
