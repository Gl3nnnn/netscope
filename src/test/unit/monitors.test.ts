import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  monitorStatus,
  runCheck,
  targetDevices,
  trimChecks,
  uptimePct,
  type Monitor,
} from '@/lib/monitors'

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: 'Srv 1',
    type: 'server',
    site: 'HQ',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 20,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 500,
    capacityMbps: 1000,
    cpuPct: 20,
    memoryPct: 30,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

function monitor(overrides: Partial<Monitor> = {}): Monitor {
  return {
    id: 'm1',
    name: 'Checkout API',
    target: 'device',
    targetId: 'd1',
    intervalMs: 10_000,
    latencyThresholdMs: 120,
    lossThresholdPct: 5,
    enabled: true,
    lastCheckedAt: 0,
    ...overrides,
  }
}

describe('monitorStatus', () => {
  it('marks healthy telemetry up', () => {
    expect(monitorStatus(20, 0, 100, 120, 5)).toBe('up')
  })

  it('degrades on latency above the threshold', () => {
    expect(monitorStatus(200, 0, 100, 120, 5)).toBe('degraded')
  })

  it('degrades on a little packet loss', () => {
    expect(monitorStatus(20, 0.85, 100, 120, 5)).toBe('degraded')
  })

  it('goes down on loss or low availability', () => {
    expect(monitorStatus(20, 6, 100, 120, 5)).toBe('down')
    expect(monitorStatus(20, 0, 93, 120, 5)).toBe('down')
  })
})

describe('targetDevices', () => {
  const fleet = [
    device({ id: 'a', site: 'HQ' }),
    device({ id: 'b', site: 'DC' }),
    device({ id: 'c', site: 'HQ' }),
  ]

  it('selects by device, site or the whole fleet', () => {
    expect(
      targetDevices({ target: 'device', targetId: 'b' }, fleet).map(
        (d) => d.id,
      ),
    ).toEqual(['b'])
    expect(
      targetDevices({ target: 'site', targetId: 'HQ' }, fleet).map((d) => d.id),
    ).toEqual(['a', 'c'])
    expect(
      targetDevices({ target: 'fleet', targetId: null }, fleet),
    ).toHaveLength(3)
  })
})

describe('runCheck', () => {
  it('probes a single device', () => {
    const result = runCheck({
      monitor: monitor(),
      devices: [device({ latencyMs: 30, packetLossPct: 0.1 })],
      now: 5000,
    })
    expect(result).not.toBeNull()
    expect(result?.at).toBe(5000)
    expect(result?.latencyMs).toBe(30)
    expect(result?.lossPct).toBe(0.1)
    expect(result?.status).toBe('up')
  })

  it('averages telemetry across a site', () => {
    const monitor2 = monitor({ target: 'site', targetId: 'HQ' })
    const fleet = [
      device({ id: 'a', site: 'HQ', latencyMs: 40, packetLossPct: 0.2 }),
      device({ id: 'b', site: 'HQ', latencyMs: 60, packetLossPct: 0.4 }),
      device({ id: 'c', site: 'DC', latencyMs: 500, packetLossPct: 50 }),
    ]
    const result = runCheck({ monitor: monitor2, devices: fleet, now: 1000 })
    expect(result?.latencyMs).toBe(50.0)
    expect(result?.lossPct).toBe(0.3)
    expect(result?.status).toBe('up')
  })

  it('returns null when no devices are targeted', () => {
    expect(
      runCheck({
        monitor: monitor({ targetId: 'missing' }),
        devices: [device()],
        now: 1000,
      }),
    ).toBeNull()
  })
})

describe('uptimePct', () => {
  it('is null without checks and measures availability otherwise', () => {
    expect(uptimePct([])).toBeNull()
    const down = {
      at: 0,
      latencyMs: 0,
      lossPct: 10,
      availabilityPct: 90,
      status: 'down' as const,
    }
    const up = {
      at: 1,
      latencyMs: 10,
      lossPct: 0,
      availabilityPct: 100,
      status: 'up' as const,
    }
    expect(uptimePct([up, up, down, up])).toBe(75)
  })
})

describe('trimChecks', () => {
  it('keeps only the newest retained checks', () => {
    const checks = Array.from({ length: 100 }, (_, i) => ({
      at: i,
      latencyMs: 0,
      lossPct: 0,
      availabilityPct: 100,
      status: 'up' as const,
    }))
    expect(trimChecks(checks)).toHaveLength(60)
    expect(trimChecks(checks)[0]?.at).toBe(40)
  })
})
