import type { Device, DeviceType } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import { profileFor } from '@/simulation/profiles'
import { round } from './format'

/**
 * Interface / port inventory (per-port state derived deterministically from a
 * device and its type profile). Pure and reproducible: the same device and seed
 * always produce the same port layout, states and utilisation.
 */

export type PortAdminStatus = 'up' | 'down'
export type PortOperStatus = 'up' | 'down' | 'err-disabled'
export type PortDuplex = 'full' | 'half'

export interface NetworkInterface {
  id: string
  deviceId: string
  name: string
  speedMbps: number
  adminStatus: PortAdminStatus
  operStatus: PortOperStatus
  duplex: PortDuplex
  vlan: number
  inErrors: number
  outErrors: number
  crcErrors: number
  /** Device id of the far end, when known. */
  connectedTo: string | null
  throughputMbps: number
}

interface PortSpec {
  count: [number, number]
  uplinkCount: number
  uplinkSpeed: number
  accessSpeed: number
  kind: 'cisco' | 'flat'
}

const PORT_SPEC: Record<DeviceType, PortSpec> = {
  switch: {
    count: [24, 48],
    uplinkCount: 2,
    uplinkSpeed: 10000,
    accessSpeed: 1000,
    kind: 'cisco',
  },
  router: {
    count: [8, 16],
    uplinkCount: 2,
    uplinkSpeed: 10000,
    accessSpeed: 1000,
    kind: 'cisco',
  },
  firewall: {
    count: [8, 12],
    uplinkCount: 2,
    uplinkSpeed: 10000,
    accessSpeed: 1000,
    kind: 'flat',
  },
  server: {
    count: [2, 4],
    uplinkCount: 0,
    uplinkSpeed: 10000,
    accessSpeed: 10000,
    kind: 'flat',
  },
  accessPoint: {
    count: [2, 3],
    uplinkCount: 1,
    uplinkSpeed: 1000,
    accessSpeed: 1000,
    kind: 'flat',
  },
}

function portName(spec: PortSpec, index: number, uplink: boolean): string {
  if (spec.kind === 'cisco') {
    return uplink ? `Te1/0/${index + 1}` : `Gi1/0/${index + 1}`
  }
  return `eth${index}`
}

/**
 * Build a device's interfaces. `peers` (other devices) are used to populate
 * `connectedTo` for a subset of access ports.
 */
export function buildInterfaces(
  device: Device,
  peers: Device[] = [],
  seed = 0,
): NetworkInterface[] {
  const spec = PORT_SPEC[device.type]
  const rng = mulberry32((hashSeed(device.id) ^ seed) >>> 0)
  const count = rng.int(spec.count[0], spec.count[1])
  const candidates = peers.filter((peer) => peer.id !== device.id)

  const ports: NetworkInterface[] = []
  for (let i = 0; i < count; i += 1) {
    const uplink = i < spec.uplinkCount
    const speedMbps = uplink ? spec.uplinkSpeed : spec.accessSpeed
    const adminStatus: PortAdminStatus = rng.chance(0.92) ? 'up' : 'down'

    let operStatus: PortOperStatus = 'down'
    let inErrors = 0
    let outErrors = 0
    let crcErrors = 0
    if (adminStatus === 'up') {
      if (rng.chance(0.03)) {
        operStatus = 'err-disabled'
        inErrors = rng.int(50, 400)
        crcErrors = rng.int(10, 120)
      } else {
        operStatus = 'up'
        if (rng.chance(0.12)) {
          inErrors = rng.int(1, 40)
          outErrors = rng.int(1, 25)
        }
      }
    }

    const connectedTo =
      !uplink && operStatus === 'up' && candidates.length > 0 && rng.chance(0.4)
        ? rng.pick(candidates).id
        : null

    ports.push({
      id: `${device.id}:${i}`,
      deviceId: device.id,
      name: portName(spec, i, uplink),
      speedMbps,
      adminStatus,
      operStatus,
      duplex: rng.chance(0.05) && !uplink ? 'half' : 'full',
      vlan: uplink ? 1 : rng.int(1, 40),
      inErrors,
      outErrors,
      crcErrors,
      connectedTo,
      throughputMbps: 0,
    })
  }

  // Distribute the device's throughput across the ports that are up.
  const upPorts = ports.filter((port) => port.operStatus === 'up')
  if (upPorts.length > 0) {
    const shares = upPorts.map(() => rng.range(0.3, 1.7))
    const totalShare = shares.reduce((sum, share) => sum + share, 0)
    upPorts.forEach((port, idx) => {
      port.throughputMbps = round(
        (device.throughputMbps * shares[idx]!) / totalShare,
        2,
      )
    })
  }

  return ports
}

/** Build interfaces for every device, keyed by device id. */
export function fleetInterfaces(
  devices: Device[],
  seed = 0,
): Map<string, NetworkInterface[]> {
  const byDevice = new Map<string, NetworkInterface[]>()
  for (const device of devices) {
    byDevice.set(device.id, buildInterfaces(device, devices, seed))
  }
  return byDevice
}

/** Utilisation (0-100) of a port from its throughput vs line speed. */
export function portUtilization(port: NetworkInterface): number {
  if (port.speedMbps <= 0) return 0
  return Math.min(100, (port.throughputMbps / port.speedMbps) * 100)
}

export function downPorts(ports: NetworkInterface[]): NetworkInterface[] {
  return ports.filter((port) => port.operStatus !== 'up')
}

export function errorPorts(ports: NetworkInterface[]): NetworkInterface[] {
  return ports.filter(
    (port) =>
      port.operStatus === 'err-disabled' ||
      port.inErrors + port.outErrors + port.crcErrors > 0,
  )
}

export function saturatedPorts(
  ports: NetworkInterface[],
  thresholdPct = 80,
): NetworkInterface[] {
  return ports.filter((port) => portUtilization(port) > thresholdPct)
}

export interface InterfaceSummary {
  total: number
  up: number
  down: number
  errDisabled: number
  withErrors: number
  totalSpeedMbps: number
  avgUtilPct: number
}

export function interfaceSummary(ports: NetworkInterface[]): InterfaceSummary {
  const up = ports.filter((port) => port.operStatus === 'up')
  const totalSpeedMbps = up.reduce((sum, port) => sum + port.speedMbps, 0)
  const totalThroughput = up.reduce((sum, port) => sum + port.throughputMbps, 0)
  return {
    total: ports.length,
    up: up.length,
    down: ports.filter((port) => port.operStatus === 'down').length,
    errDisabled: ports.filter((port) => port.operStatus === 'err-disabled')
      .length,
    withErrors: errorPorts(ports).length,
    totalSpeedMbps,
    avgUtilPct:
      totalSpeedMbps > 0
        ? round((totalThroughput / totalSpeedMbps) * 100, 1)
        : 0,
  }
}

/** Chassis capacity (Mbps) implied by the device type profile. */
export function chassisCapacity(type: DeviceType): number {
  return profileFor(type).capacityMbps
}
