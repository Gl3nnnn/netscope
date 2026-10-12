import { describe, expect, it } from 'vitest'
import type { Device, Incident, Thresholds } from '@/types'
import {
  captureFrame,
  diffFrames,
  incidentsOpenedIn,
  nearestFrameIndex,
  pushFrame,
  seekIncidentTime,
  type ReplayFrame,
} from '@/lib/replay'

const THRESHOLDS: Thresholds = {
  latencyMs: 120,
  packetLossPct: 1,
  availabilityPct: 99,
}

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: 'Device 1',
    type: 'server',
    site: 'HQ',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 10,
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

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'Latency spike',
    description: '',
    severity: 'high',
    status: 'open',
    deviceIds: ['d1'],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function frame(t: number, overrides: Partial<ReplayFrame> = {}): ReplayFrame {
  return {
    t,
    devices: [device()],
    incidents: [],
    events: [],
    health: 90,
    openIncidents: 0,
    offlineCount: 0,
    degradedCount: 0,
    fleetUtilPct: 50,
    avgLatencyMs: 10,
    ...overrides,
  }
}

describe('captureFrame', () => {
  it('computes fleet aggregates', () => {
    const captured = captureFrame({
      t: 5000,
      devices: [
        device({ id: 'a', status: 'offline' }),
        device({ id: 'b', status: 'degraded', throughputMbps: 1000 }),
        device({ id: 'c', status: 'online' }),
      ],
      incidents: [incident(), incident({ id: 'i2', status: 'resolved' })],
      events: [],
      thresholds: THRESHOLDS,
    })
    expect(captured.t).toBe(5000)
    expect(captured.openIncidents).toBe(1)
    expect(captured.offlineCount).toBe(1)
    expect(captured.degradedCount).toBe(1)
    expect(captured.fleetUtilPct).toBeGreaterThan(0)
    expect(captured.health).toBeGreaterThanOrEqual(0)
    expect(captured.health).toBeLessThanOrEqual(100)
  })
})

describe('pushFrame', () => {
  it('appends frames in order', () => {
    const frames = pushFrame(pushFrame([], frame(1)), frame(2))
    expect(frames.map((f) => f.t)).toEqual([1, 2])
  })

  it('trims to the ring-buffer bound, dropping the oldest', () => {
    let frames: ReplayFrame[] = []
    for (let i = 0; i < 5; i += 1) frames = pushFrame(frames, frame(i), 3)
    expect(frames.map((f) => f.t)).toEqual([2, 3, 4])
  })
})

describe('nearestFrameIndex', () => {
  const frames = [frame(0), frame(1000), frame(2000), frame(3000)]

  it('finds the closest frame', () => {
    expect(nearestFrameIndex(frames, 900)).toBe(1)
    expect(nearestFrameIndex(frames, 1600)).toBe(2)
    expect(nearestFrameIndex(frames, -500)).toBe(0)
    expect(nearestFrameIndex(frames, 9999)).toBe(3)
  })

  it('returns 0 for an empty buffer', () => {
    expect(nearestFrameIndex([], 100)).toBe(0)
  })
})

describe('diffFrames', () => {
  it('reports status changes and metric deltas', () => {
    const from = frame(1000, {
      devices: [device({ id: 'a', status: 'online', latencyMs: 10 })],
    })
    const to = frame(2000, {
      devices: [device({ id: 'a', status: 'offline', latencyMs: 80 })],
      health: 70,
    })
    const diff = diffFrames(from, to)
    expect(diff.statusChanges).toHaveLength(1)
    expect(diff.statusChanges[0]?.statusTo).toBe('offline')
    expect(diff.metricChanges[0]?.latencyMs).toBe(70)
    expect(diff.health).toBe(-20)
  })

  it('detects added and removed devices', () => {
    const from = frame(1000, { devices: [device({ id: 'a' })] })
    const to = frame(2000, {
      devices: [device({ id: 'a' }), device({ id: 'b' })],
    })
    const diff = diffFrames(from, to)
    expect(diff.addedIds).toEqual(['b'])
    expect(diff.removedIds).toEqual([])
  })

  it('is empty when nothing changed', () => {
    const same = frame(1000)
    const diff = diffFrames(same, frame(2000))
    expect(diff.statusChanges).toHaveLength(0)
    expect(diff.addedIds).toHaveLength(0)
    expect(diff.health).toBe(0)
  })
})

describe('seekIncidentTime', () => {
  it('returns the frame nearest an incident creation time', () => {
    const frames = [frame(0), frame(10_000), frame(20_000)]
    expect(seekIncidentTime(frames, incident({ createdAt: 11_000 }))).toBe(1)
  })
})

describe('incidentsOpenedIn', () => {
  it('finds incidents that first appear', () => {
    const previous = frame(1000, { incidents: [incident({ id: 'old' })] })
    const current = frame(2000, {
      incidents: [incident({ id: 'old' }), incident({ id: 'new' })],
    })
    expect(incidentsOpenedIn(current, previous).map((i) => i.id)).toEqual([
      'new',
    ])
    expect(incidentsOpenedIn(frame(0), null)).toHaveLength(0)
  })
})
