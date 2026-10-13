import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  baselineConfig,
  detectDrift,
  driftConfig,
  fleetDrift,
  generateConfig,
  hashString,
  type DeviceConfig,
} from '@/lib/configs'

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: 'Core Router',
    type: 'router',
    site: 'HQ',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 10,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 10,
    memoryPct: 20,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

function config(overrides: Partial<DeviceConfig> = {}): DeviceConfig {
  return {
    deviceId: 'd1',
    baseline: 'a\nb\nc',
    current: 'a\nb\nc',
    versions: [],
    updatedAt: 0,
    ...overrides,
  }
}

describe('hashString', () => {
  it('is stable and differs for different inputs', () => {
    expect(hashString('router-1')).toBe(hashString('router-1'))
    expect(hashString('router-1')).not.toBe(hashString('router-2'))
  })
})

describe('baselineConfig', () => {
  it('produces type-specific, deterministic config', () => {
    const router = device({ type: 'router' })
    const text = baselineConfig(router)
    expect(text).toContain('router ospf 1')
    expect(text).toContain('interface GigabitEthernet0/0')
    expect(baselineConfig(router)).toBe(text)
  })

  it('tailors content to the device type', () => {
    expect(baselineConfig(device({ type: 'switch' }))).toContain(
      'spanning-tree',
    )
    expect(baselineConfig(device({ type: 'server' }))).toContain('sshd:')
  })
})

describe('driftConfig', () => {
  it('is deterministic for a given device', () => {
    const d = device()
    expect(driftConfig(d)).toBe(driftConfig(d))
  })

  it('alters the config for some devices and not others', () => {
    const devices = Array.from({ length: 30 }, (_, i) =>
      device({ id: `dev-${i}` }),
    )
    const drifted = devices.filter((d) => driftConfig(d) !== baselineConfig(d))
    expect(drifted.length).toBeGreaterThan(0)
    expect(drifted.length).toBeLessThan(devices.length)
  })
})

describe('detectDrift', () => {
  it('reports no drift for identical configs', () => {
    const summary = detectDrift(config())
    expect(summary.drifted).toBe(false)
    expect(summary.changed).toBe(false)
  })

  it('reports drift with line counts', () => {
    const summary = detectDrift(config({ current: 'a\nc' }))
    expect(summary.drifted).toBe(true)
    expect(summary.removed).toBe(1)
    expect(summary.deviceId).toBe('d1')
  })
})

describe('fleetDrift', () => {
  it('resolves each device through the provided resolver', () => {
    const devices = [device({ id: 'a' }), device({ id: 'b' })]
    const summaries = fleetDrift(devices, (d) =>
      d.id === 'a'
        ? config({ deviceId: 'a' })
        : config({ deviceId: 'b', current: 'x' }),
    )
    expect(summaries).toHaveLength(2)
    expect(summaries.find((s) => s.deviceId === 'a')?.drifted).toBe(false)
    expect(summaries.find((s) => s.deviceId === 'b')?.drifted).toBe(true)
  })
})

describe('generateConfig', () => {
  it('produces a config whose drift matches driftConfig', () => {
    const d = device()
    const cfg = generateConfig(d)
    expect(cfg.baseline).toBe(baselineConfig(d))
    expect(cfg.current).toBe(driftConfig(d))
  })
})
