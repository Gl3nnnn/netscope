import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  deviceSites,
  filterDevices,
  sortDevices,
} from '../../lib/devices'
import type { Device } from '../../types'

function make(partial: Partial<Device> & Pick<Device, 'id' | 'name'>): Device {
  return {
    id: partial.id,
    name: partial.name,
    type: partial.type ?? 'server',
    site: partial.site ?? 'HQ',
    ip: partial.ip ?? '10.0.0.1',
    mac: partial.mac ?? 'AA:BB:CC:DD:EE:FF',
    status: partial.status ?? 'online',
    tags: partial.tags ?? [],
    latencyMs: partial.latencyMs ?? 5,
    packetLossPct: partial.packetLossPct ?? 0,
    availabilityPct: partial.availabilityPct ?? 100,
    throughputMbps: partial.throughputMbps ?? 100,
    capacityMbps: partial.capacityMbps ?? 1000,
    cpuPct: partial.cpuPct ?? 10,
    memoryPct: partial.memoryPct ?? 20,
    uptimeSec: partial.uptimeSec ?? 1000,
    lastSeen: partial.lastSeen ?? Date.now(),
  }
}

const devices: Device[] = [
  make({
    id: '1',
    name: 'rtr-core',
    type: 'router',
    site: 'Data Center A',
    ip: '10.0.0.1',
    latencyMs: 3,
    tags: ['core'],
  }),
  make({
    id: '2',
    name: 'sw-edge',
    type: 'switch',
    site: 'Branch - West',
    ip: '10.0.1.1',
    status: 'degraded',
    latencyMs: 50,
    tags: ['edge'],
  }),
  make({
    id: '3',
    name: 'srv-app',
    type: 'server',
    site: 'Data Center A',
    ip: '10.0.0.9',
    status: 'offline',
    latencyMs: 120,
  }),
]

describe('filterDevices', () => {
  it('returns all devices with empty filters', () => {
    expect(filterDevices(devices, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filters by query across fields', () => {
    expect(
      filterDevices(devices, { ...EMPTY_FILTERS, query: 'core' }),
    ).toHaveLength(1)
    expect(
      filterDevices(devices, { ...EMPTY_FILTERS, query: '10.0.1' }),
    ).toHaveLength(1)
    expect(
      filterDevices(devices, { ...EMPTY_FILTERS, query: 'edge' }),
    ).toHaveLength(1)
  })

  it('filters by type, status and site', () => {
    expect(
      filterDevices(devices, { ...EMPTY_FILTERS, type: 'server' }),
    ).toHaveLength(1)
    expect(
      filterDevices(devices, { ...EMPTY_FILTERS, status: 'degraded' }),
    ).toHaveLength(1)
    expect(
      filterDevices(devices, { ...EMPTY_FILTERS, site: 'Data Center A' }),
    ).toHaveLength(2)
  })
})

describe('sortDevices', () => {
  it('sorts numerically by latency', () => {
    const sorted = sortDevices(devices, 'latencyMs', 'asc')
    expect(sorted.map((d) => d.id)).toEqual(['1', '2', '3'])
  })

  it('sorts descending', () => {
    const sorted = sortDevices(devices, 'latencyMs', 'desc')
    expect(sorted.map((d) => d.id)).toEqual(['3', '2', '1'])
  })

  it('sorts alphabetically by name', () => {
    const sorted = sortDevices(devices, 'name', 'asc')
    expect(sorted[0].name).toBe('rtr-core')
  })
})

describe('deviceSites', () => {
  it('returns unique sorted sites', () => {
    expect(deviceSites(devices)).toEqual(['Branch - West', 'Data Center A'])
  })
})
