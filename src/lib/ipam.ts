import type { Device } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import { round } from './format'

/**
 * IPAM — IP address & VLAN management.
 *
 * Pure CIDR arithmetic plus a deterministic seed generator that turns a set of
 * sites into subnets, VLANs and allocations. Utilisation is derived from the
 * allocation ledger (not stored), so releasing an IP immediately frees space.
 */

export interface Subnet {
  id: string
  cidr: string
  site: string
  vlanId: number
  gateway: string
  description: string
}

export interface Vlan {
  id: number
  name: string
  site: string
}

export type AllocationStatus = 'allocated' | 'reserved'

export interface IpAllocation {
  ip: string
  subnetId: string
  hostname: string | null
  deviceId: string | null
  status: AllocationStatus
}

export interface CidrInfo {
  networkLong: number
  prefix: number
  broadcastLong: number
  totalIps: number
  usableIps: number
  firstHostLong: number
  lastHostLong: number
}

export function ipToLong(ip: string): number {
  const parts = ip.split('.').map((part) => Number.parseInt(part, 10))
  return (
    (((parts[0] ?? 0) << 24) |
      ((parts[1] ?? 0) << 16) |
      ((parts[2] ?? 0) << 8) |
      (parts[3] ?? 0)) >>>
    0
  )
}

export function longToIp(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.')
}

export function parseCidr(cidr: string): CidrInfo {
  const [rawIp, rawPrefix] = cidr.split('/')
  const prefix = Number.parseInt(rawPrefix ?? '32', 10)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const networkLong = (ipToLong(rawIp ?? '0.0.0.0') & mask) >>> 0
  const totalIps = 2 ** (32 - prefix)
  const broadcastLong = (networkLong + totalIps - 1) >>> 0
  const usableIps = prefix >= 31 ? totalIps : Math.max(0, totalIps - 2)
  return {
    networkLong,
    prefix,
    broadcastLong,
    totalIps,
    usableIps,
    firstHostLong: (networkLong + 1) >>> 0,
    lastHostLong: (broadcastLong - 1) >>> 0,
  }
}

/** Number of host addresses a subnet can hold. */
export function subnetCapacity(subnet: Subnet): number {
  return parseCidr(subnet.cidr).usableIps
}

export function usedIps(subnetId: string, allocations: IpAllocation[]): number {
  return allocations.filter(
    (allocation) =>
      allocation.subnetId === subnetId && allocation.status !== undefined,
  ).length
}

export function freeIps(subnet: Subnet, allocations: IpAllocation[]): number {
  return Math.max(0, subnetCapacity(subnet) - usedIps(subnet.id, allocations))
}

export function subnetUtilization(
  subnet: Subnet,
  allocations: IpAllocation[],
): number {
  const capacity = subnetCapacity(subnet)
  if (capacity <= 0) return 0
  return round((usedIps(subnet.id, allocations) / capacity) * 100, 1)
}

/** True if two CIDR blocks share any address space. */
export function cidrOverlaps(a: string, b: string): boolean {
  const infoA = parseCidr(a)
  const infoB = parseCidr(b)
  return (
    infoA.networkLong <= infoB.broadcastLong &&
    infoB.networkLong <= infoA.broadcastLong
  )
}

export interface SubnetConflict {
  aId: string
  bId: string
  reason: string
}

/** Pairs of subnets whose address ranges intersect. */
export function findConflicts(subnets: Subnet[]): SubnetConflict[] {
  const conflicts: SubnetConflict[] = []
  for (let i = 0; i < subnets.length; i += 1) {
    for (let j = i + 1; j < subnets.length; j += 1) {
      const a = subnets[i]!
      const b = subnets[j]!
      if (cidrOverlaps(a.cidr, b.cidr)) {
        conflicts.push({
          aId: a.id,
          bId: b.id,
          reason: `${a.cidr} overlaps ${b.cidr}`,
        })
      }
    }
  }
  return conflicts
}

export interface VlanRow {
  vlan: Vlan
  subnet: Subnet | null
  utilizationPct: number
}

/** Join VLANs with their subnet and live utilisation. */
export function vlanCatalog(
  vlans: Vlan[],
  subnets: Subnet[],
  allocations: IpAllocation[],
): VlanRow[] {
  return vlans
    .map((vlan) => {
      const subnet =
        subnets.find((candidate) => candidate.vlanId === vlan.id) ?? null
      return {
        vlan,
        subnet,
        utilizationPct: subnet ? subnetUtilization(subnet, allocations) : 0,
      }
    })
    .sort((a, b) => a.vlan.id - b.vlan.id)
}

export interface IpamSummary {
  subnetCount: number
  vlanCount: number
  totalCapacity: number
  totalUsed: number
  overallUtilPct: number
  conflictCount: number
}

export function ipamSummary(
  subnets: Subnet[],
  vlans: Vlan[],
  allocations: IpAllocation[],
): IpamSummary {
  const totalCapacity = subnets.reduce(
    (sum, subnet) => sum + subnetCapacity(subnet),
    0,
  )
  const totalUsed = subnets.reduce(
    (sum, subnet) => sum + usedIps(subnet.id, allocations),
    0,
  )
  return {
    subnetCount: subnets.length,
    vlanCount: vlans.length,
    totalCapacity,
    totalUsed,
    overallUtilPct:
      totalCapacity > 0 ? round((totalUsed / totalCapacity) * 100, 1) : 0,
    conflictCount: findConflicts(subnets).length,
  }
}

export interface IpamSeed {
  subnets: Subnet[]
  vlans: Vlan[]
  allocations: IpAllocation[]
}

/**
 * Deterministically seed subnets, VLANs and allocations for a set of sites.
 * Each site gets a user VLAN (/24) and a server VLAN (/24) with a plausible
 * allocation ledger.
 */
export function generateIpam(sites: readonly string[], seed = 0): IpamSeed {
  const subnets: Subnet[] = []
  const vlans: Vlan[] = []
  const allocations: IpAllocation[] = []

  sites.forEach((site, index) => {
    const rng = mulberry32((hashSeed(site) ^ seed) >>> 0)

    const userVlanId = 10 + index
    const serverVlanId = 100 + index
    const userSubnetId = `sn-${index}-user`
    const serverSubnetId = `sn-${index}-server`

    subnets.push({
      id: userSubnetId,
      cidr: `10.${index}.0.0/24`,
      site,
      vlanId: userVlanId,
      gateway: `10.${index}.0.1`,
      description: `${site} user access`,
    })
    subnets.push({
      id: serverSubnetId,
      cidr: `10.${index}.1.0/24`,
      site,
      vlanId: serverVlanId,
      gateway: `10.${index}.1.1`,
      description: `${site} servers`,
    })

    vlans.push({ id: userVlanId, name: `${site} Users`, site })
    vlans.push({ id: serverVlanId, name: `${site} Servers`, site })

    const userCount = rng.int(24, 70)
    for (let n = 0; n < userCount; n += 1) {
      allocations.push({
        ip: `10.${index}.0.${10 + n}`,
        subnetId: userSubnetId,
        hostname: `pc-${n}.${site.toLowerCase().replace(/\s+/g, '')}`,
        deviceId: null,
        status: 'allocated',
      })
    }
    const reserved = rng.int(1, 3)
    for (let n = 0; n < reserved; n += 1) {
      allocations.push({
        ip: `10.${index}.0.${200 + n}`,
        subnetId: userSubnetId,
        hostname: null,
        deviceId: null,
        status: 'reserved',
      })
    }

    const serverCount = rng.int(6, 16)
    for (let n = 0; n < serverCount; n += 1) {
      allocations.push({
        ip: `10.${index}.1.${10 + n}`,
        subnetId: serverSubnetId,
        hostname: `srv-${n}`,
        deviceId: null,
        status: 'allocated',
      })
    }
  })

  return { subnets, vlans, allocations }
}

/** Link allocations to live devices whose IP falls inside the allocation. */
export function linkAllocationsToDevice(
  allocations: IpAllocation[],
  devices: Device[],
): IpAllocation[] {
  const deviceByIp = new Map(devices.map((device) => [device.ip, device.id]))
  return allocations.map((allocation) => ({
    ...allocation,
    deviceId: deviceByIp.get(allocation.ip) ?? allocation.deviceId,
  }))
}
