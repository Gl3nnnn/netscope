import { describe, it, expect } from 'vitest'
import {
  ipToLong,
  longToIp,
  parseCidr,
  subnetCapacity,
  usedIps,
  freeIps,
  subnetUtilization,
  cidrOverlaps,
  findConflicts,
  vlanCatalog,
  ipamSummary,
  generateIpam,
  type Subnet,
  type IpAllocation,
  type Vlan,
} from '@/lib/ipam'

const SITES = ['HQ', 'DC'] as const

function subnet(overrides: Partial<Subnet> = {}): Subnet {
  return {
    id: 'sn-1',
    cidr: '10.0.0.0/24',
    site: 'HQ',
    vlanId: 10,
    gateway: '10.0.0.1',
    description: 'users',
    ...overrides,
  }
}

function allocation(overrides: Partial<IpAllocation> = {}): IpAllocation {
  return {
    ip: '10.0.0.10',
    subnetId: 'sn-1',
    hostname: 'pc-0',
    deviceId: null,
    status: 'allocated',
    ...overrides,
  }
}

function vlan(overrides: Partial<Vlan> = {}): Vlan {
  return { id: 10, name: 'Users', site: 'HQ', ...overrides }
}

describe('ipToLong / longToIp', () => {
  it('round-trips dotted quads', () => {
    expect(longToIp(ipToLong('10.0.0.1'))).toBe('10.0.0.1')
    expect(longToIp(ipToLong('192.168.1.255'))).toBe('192.168.1.255')
    expect(ipToLong('255.255.255.255')).toBe(4294967295)
    expect(ipToLong('0.0.0.0')).toBe(0)
  })

  it('computes expected integer for 10.0.0.1', () => {
    expect(ipToLong('10.0.0.1')).toBe(167772161)
  })
})

describe('parseCidr', () => {
  it('parses a /24', () => {
    const info = parseCidr('10.0.0.0/24')
    expect(info.totalIps).toBe(256)
    expect(info.usableIps).toBe(254)
    expect(info.firstHostLong).toBe(ipToLong('10.0.0.1'))
    expect(info.lastHostLong).toBe(ipToLong('10.0.0.254'))
    expect(longToIp(info.broadcastLong)).toBe('10.0.0.255')
  })

  it('handles /30, /31 and /32 usable counts', () => {
    expect(parseCidr('10.0.0.0/30').usableIps).toBe(2)
    expect(parseCidr('10.0.0.0/31').usableIps).toBe(2)
    expect(parseCidr('10.0.0.0/32').usableIps).toBe(1)
  })

  it('masks non-aligned networks down to the base', () => {
    const info = parseCidr('10.0.0.128/25')
    expect(longToIp(info.networkLong)).toBe('10.0.0.128')
    expect(info.totalIps).toBe(128)
    expect(info.usableIps).toBe(126)
  })
})

describe('cidrOverlaps', () => {
  it('detects identical and nested ranges', () => {
    expect(cidrOverlaps('10.0.0.0/24', '10.0.0.0/24')).toBe(true)
    expect(cidrOverlaps('10.0.0.0/16', '10.0.0.0/24')).toBe(true)
    expect(cidrOverlaps('10.0.1.0/24', '10.0.0.0/16')).toBe(true)
  })

  it('reports adjacent and distant ranges as non-overlapping', () => {
    expect(cidrOverlaps('10.0.0.0/24', '10.0.1.0/24')).toBe(false)
    expect(cidrOverlaps('10.0.0.0/24', '192.168.0.0/24')).toBe(false)
  })
})

describe('findConflicts', () => {
  it('finds the one overlapping pair among three subnets', () => {
    const subnets = [
      subnet({ id: 'a', cidr: '10.0.0.0/16' }),
      subnet({ id: 'b', cidr: '10.0.0.0/24' }),
      subnet({ id: 'c', cidr: '10.5.0.0/24' }),
    ]
    const conflicts = findConflicts(subnets)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.aId).toBe('a')
    expect(conflicts[0]!.bId).toBe('b')
  })

  it('returns empty for disjoint subnets', () => {
    const subnets = [
      subnet({ id: 'a', cidr: '10.0.0.0/24' }),
      subnet({ id: 'b', cidr: '10.1.0.0/24' }),
    ]
    expect(findConflicts(subnets)).toHaveLength(0)
  })
})

describe('utilisation ledger', () => {
  const allocations = [
    allocation({ ip: '10.0.0.10' }),
    allocation({ ip: '10.0.0.11', status: 'reserved' }),
    allocation({ ip: '10.0.0.12', subnetId: 'sn-2' }),
  ]

  it('counts both allocated and reserved against capacity', () => {
    expect(usedIps('sn-1', allocations)).toBe(2)
    expect(subnetCapacity(subnet())).toBe(254)
    expect(freeIps(subnet(), allocations)).toBe(252)
  })

  it('computes utilisation as a percentage', () => {
    expect(subnetUtilization(subnet(), allocations)).toBeCloseTo(0.8, 1)
  })
})

describe('vlanCatalog', () => {
  it('joins VLANs to their subnet and sorts by id', () => {
    const vlans = [vlan({ id: 100, name: 'Servers' }), vlan({ id: 10 })]
    const subnets = [
      subnet({ vlanId: 100, id: 'srv' }),
      subnet({ vlanId: 10, id: 'usr' }),
    ]
    const rows = vlanCatalog(vlans, subnets, [])
    expect(rows.map((row) => row.vlan.id)).toEqual([10, 100])
    expect(rows[0]!.subnet?.id).toBe('usr')
  })
})

describe('ipamSummary', () => {
  it('aggregates counts, capacity and conflicts', () => {
    const subnets = [
      subnet({ id: 'a', cidr: '10.0.0.0/24' }),
      subnet({ id: 'b', cidr: '10.0.0.0/16' }),
    ]
    const allocations = Array.from({ length: 500 }, (_, i) =>
      allocation({ ip: `10.0.0.${i % 254}`, subnetId: 'a' }),
    )
    const summary = ipamSummary(subnets, [vlan()], allocations)
    expect(summary.subnetCount).toBe(2)
    expect(summary.vlanCount).toBe(1)
    expect(summary.totalUsed).toBe(500)
    expect(summary.conflictCount).toBe(1)
    expect(summary.overallUtilPct).toBeGreaterThan(0)
  })
})

describe('generateIpam', () => {
  it('is deterministic for a given seed', () => {
    const a = generateIpam(SITES, 7)
    const b = generateIpam(SITES, 7)
    expect(a.subnets).toEqual(b.subnets)
    expect(a.vlans).toEqual(b.vlans)
    expect(a.allocations).toEqual(b.allocations)
  })

  it('creates two subnets and two VLANs per site', () => {
    const seed = generateIpam(SITES)
    expect(seed.subnets).toHaveLength(4)
    expect(seed.vlans).toHaveLength(4)
    expect(seed.subnets.every((s) => s.cidr.endsWith('/24'))).toBe(true)
  })

  it('gives each site distinct /24s', () => {
    const seed = generateIpam(SITES)
    const cidrs = new Set(seed.subnets.map((s) => s.cidr))
    expect(cidrs.size).toBe(seed.subnets.length)
  })
})
