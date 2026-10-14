import { describe, expect, it } from 'vitest'
import type { Device, DeviceType } from '@/types'
import {
  buildInterfaces,
  chassisCapacity,
  downPorts,
  errorPorts,
  fleetInterfaces,
  interfaceSummary,
  portUtilization,
  saturatedPorts,
  type NetworkInterface,
} from '@/lib/interfaces'
import { profileFor } from '@/simulation/profiles'

function device(
  id: string,
  type: DeviceType,
  site = 'DC',
  throughputMbps = 800,
): Device {
  return {
    id,
    name: `${type} ${id}`,
    type,
    site,
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps,
    capacityMbps: 2000,
    cpuPct: 48,
    memoryPct: 70,
    uptimeSec: 1000,
    lastSeen: 0,
  }
}

describe('buildInterfaces', () => {
  it('is deterministic for the same device, peers and seed', () => {
    const dev = device('1', 'switch')
    const peers = [device('2', 'server'), device('3', 'router')]
    const a = buildInterfaces(dev, peers, 7)
    const b = buildInterfaces(dev, peers, 7)
    expect(a).toEqual(b)
  })

  it('produces a plausible port count for the device type', () => {
    const ports = buildInterfaces(device('1', 'switch'))
    expect(ports.length).toBeGreaterThanOrEqual(24)
    expect(ports.length).toBeLessThanOrEqual(48)
  })

  it('makes the first ports uplinks at uplink speed and the rest access speed', () => {
    const ports = buildInterfaces(device('1', 'switch'))
    expect(ports[0]!.speedMbps).toBe(10000)
    expect(ports[1]!.speedMbps).toBe(10000)
    expect(ports[2]!.speedMbps).toBe(1000)
    expect(ports[0]!.name.startsWith('Te')).toBe(true)
    expect(ports[2]!.name.startsWith('Gi')).toBe(true)
  })

  it('keeps admin-down ports operationally down with no traffic', () => {
    const ports = buildInterfaces(device('1', 'switch'))
    for (const port of ports) {
      if (port.adminStatus === 'down') {
        expect(port.operStatus).toBe('down')
        expect(port.throughputMbps).toBe(0)
      }
    }
  })

  it('distributes the device throughput across the ports that are up', () => {
    const dev = device('1', 'switch', 'DC', 900)
    const ports = buildInterfaces(dev)
    const upSum = ports
      .filter((port) => port.operStatus === 'up')
      .reduce((sum, port) => sum + port.throughputMbps, 0)
    expect(upSum).toBeCloseTo(dev.throughputMbps, 0)
  })
})

describe('port helpers', () => {
  const mk = (overrides: Partial<NetworkInterface> = {}): NetworkInterface => ({
    id: 'p',
    deviceId: '1',
    name: 'Gi1/0/1',
    speedMbps: 1000,
    adminStatus: 'up',
    operStatus: 'up',
    duplex: 'full',
    vlan: 10,
    inErrors: 0,
    outErrors: 0,
    crcErrors: 0,
    connectedTo: null,
    throughputMbps: 0,
    ...overrides,
  })

  it('computes utilisation from throughput vs speed', () => {
    expect(portUtilization(mk({ speedMbps: 1000, throughputMbps: 250 }))).toBe(
      25,
    )
    expect(portUtilization(mk({ speedMbps: 1000, throughputMbps: 2000 }))).toBe(
      100,
    )
    expect(portUtilization(mk({ speedMbps: 0 }))).toBe(0)
  })

  it('filters down, error and saturated ports', () => {
    const ports = [
      mk({ id: 'a', operStatus: 'down' }),
      mk({ id: 'b', operStatus: 'err-disabled', inErrors: 100 }),
      mk({ id: 'c', inErrors: 5 }),
      mk({ id: 'd', throughputMbps: 950, speedMbps: 1000 }),
      mk({ id: 'e' }),
    ]
    expect(
      downPorts(ports)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['a', 'b'])
    expect(
      errorPorts(ports)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['b', 'c'])
    expect(saturatedPorts(ports).map((p) => p.id)).toEqual(['d'])
  })

  it('summarises an interface list', () => {
    const ports = [
      mk({ id: 'a', operStatus: 'up', speedMbps: 1000, throughputMbps: 500 }),
      mk({ id: 'b', operStatus: 'down' }),
      mk({ id: 'c', operStatus: 'err-disabled', inErrors: 10 }),
    ]
    const summary = interfaceSummary(ports)
    expect(summary.total).toBe(3)
    expect(summary.up).toBe(1)
    expect(summary.down).toBe(1)
    expect(summary.errDisabled).toBe(1)
    expect(summary.withErrors).toBe(1)
    expect(summary.totalSpeedMbps).toBe(1000)
    expect(summary.avgUtilPct).toBe(50)
  })
})

describe('fleetInterfaces', () => {
  it('returns an entry for every device', () => {
    const devices = [device('1', 'switch'), device('2', 'server')]
    const map = fleetInterfaces(devices)
    expect(map.size).toBe(2)
    expect(map.get('1')!.length).toBeGreaterThan(0)
  })
})

describe('chassisCapacity', () => {
  it('matches the type profile capacity', () => {
    expect(chassisCapacity('switch')).toBe(profileFor('switch').capacityMbps)
    expect(chassisCapacity('server')).toBe(profileFor('server').capacityMbps)
  })
})
