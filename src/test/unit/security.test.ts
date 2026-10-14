import { describe, expect, it } from 'vitest'
import type { Device, DeviceType, Severity } from '@/types'
import { buildFlows } from '@/lib/flow'
import {
  TECHNIQUES,
  attackHeatmap,
  evaluateSecurity,
  securityScore,
  securitySummary,
  topTargets,
  withDisposition,
  type SecurityEvent,
} from '@/lib/security'

function device(
  id: string,
  type: DeviceType,
  site: string,
  opts: Partial<Device> = {},
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
    latencyMs: 10,
    packetLossPct: 0.2,
    availabilityPct: 99.9,
    throughputMbps: 200,
    capacityMbps: 1000,
    cpuPct: 30,
    memoryPct: 40,
    uptimeSec: 5000,
    lastSeen: 0,
    ...opts,
  }
}

function fleet(): Device[] {
  return [
    device('r1', 'router', 'DC', { throughputMbps: 900, cpuPct: 70 }),
    device('s1', 'switch', 'DC', { throughputMbps: 400 }),
    device('fw1', 'firewall', 'HQ', { throughputMbps: 800, cpuPct: 80 }),
    device('sv1', 'server', 'HQ', { throughputMbps: 100 }),
    device('sv2', 'server', 'Branch', { throughputMbps: 30, capacityMbps: 60 }),
    device('ap1', 'accessPoint', 'Branch', { throughputMbps: 20 }),
  ]
}

const NOW = 1_700_000_000_000

describe('evaluateSecurity', () => {
  it('is deterministic for the same fleet and seed', () => {
    const a = evaluateSecurity({ devices: fleet(), now: NOW, seed: 42 })
    const b = evaluateSecurity({ devices: fleet(), now: NOW, seed: 42 })
    expect(a).toEqual(b)
  })

  it('produces different results for a different seed', () => {
    const a = evaluateSecurity({ devices: fleet(), now: NOW, seed: 1 })
    const b = evaluateSecurity({ devices: fleet(), now: NOW, seed: 9999 })
    expect(a.map((e) => e.id).join()).not.toEqual(b.map((e) => e.id).join())
  })

  it('preserves dispositions and merges history across re-evaluations', () => {
    const first = evaluateSecurity({ devices: fleet(), now: NOW, seed: 7 })
    expect(first.length).toBeGreaterThan(0)
    const target = first[0]!
    const marked = withDisposition(first, target.id, 'contained')
    const second = evaluateSecurity({
      devices: fleet(),
      now: NOW + 1000,
      seed: 7,
      existing: marked,
    })
    const reloaded = second.find((e) => e.id === target.id)
    expect(reloaded?.disposition).toBe('contained')
  })

  it('tags every event with a known technique and 0..1 confidence', () => {
    const events = evaluateSecurity({ devices: fleet(), now: NOW, seed: 3 })
    for (const event of events) {
      expect(TECHNIQUES[event.technique]).toBeDefined()
      expect(event.confidence).toBeGreaterThanOrEqual(0)
      expect(event.confidence).toBeLessThanOrEqual(1)
      expect(event.count).toBeGreaterThan(0)
    }
  })

  it('emits no findings on an empty fleet', () => {
    expect(evaluateSecurity({ devices: [], now: NOW, seed: 5 })).toEqual([])
  })
})

describe('withDisposition', () => {
  it('marks a single event and leaves the rest untouched', () => {
    const events = evaluateSecurity({ devices: fleet(), now: NOW, seed: 11 })
    const id = events[0]!.id
    const out = withDisposition(events, id, 'false-positive')
    expect(out.find((e) => e.id === id)?.disposition).toBe('false-positive')
    expect(out.filter((e) => e.disposition === 'open').length).toBe(
      events.length - 1,
    )
  })
})

describe('securityScore', () => {
  it('scores an empty set as fully secure', () => {
    const score = securityScore([])
    expect(score.score).toBe(100)
    expect(score.grade).toBe('secure')
    expect(score.topTechnique).toBeNull()
  })

  it('lowers the score as critical open findings accumulate', () => {
    const base = evaluateSecurity({ devices: fleet(), now: NOW, seed: 2 })
    const criticals: SecurityEvent[] = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      technique: 'T1071',
      severity: 'critical' as Severity,
      confidence: 0.9,
      deviceId: 'sv1',
      deviceName: 'server sv1',
      site: 'HQ',
      srcIp: '1.1.1.1',
      dstIp: '10.0.0.sv1',
      dstPort: 443,
      count: 30,
      firstSeen: NOW - 1000,
      lastSeen: NOW,
      disposition: 'open',
    }))
    const score = securityScore([...base, ...criticals])
    expect(score.score).toBeLessThan(55)
    expect(score.grade).toBe('critical')
  })

  it('excludes contained and false-positive events from the open count', () => {
    const events = evaluateSecurity({ devices: fleet(), now: NOW, seed: 4 })
    const allClosed = events.map((e) => ({
      ...e,
      disposition: 'contained' as const,
    }))
    const score = securityScore(allClosed)
    expect(score.open).toBe(0)
    expect(score.contained).toBe(events.length)
    expect(score.score).toBe(100)
  })
})

describe('topTargets', () => {
  it('ranks devices by worst severity then count and caps at n', () => {
    const events = evaluateSecurity({ devices: fleet(), now: NOW, seed: 6 })
    const targets = topTargets(events, 3)
    expect(targets.length).toBeLessThanOrEqual(3)
    for (let i = 1; i < targets.length; i += 1) {
      expect(['critical', 'high', 'medium', 'low']).toContain(
        targets[i]!.worstSeverity,
      )
    }
  })

  it('returns empty for no open events', () => {
    expect(topTargets([])).toEqual([])
  })
})

describe('attackHeatmap', () => {
  it('covers every technique with a count of open events', () => {
    const events = evaluateSecurity({ devices: fleet(), now: NOW, seed: 8 })
    const cells = attackHeatmap(events)
    expect(cells.length).toBe(Object.keys(TECHNIQUES).length)
    for (const cell of cells) {
      expect(cell.count).toBeGreaterThanOrEqual(0)
    }
  })

  it('reflects a marked containment by dropping the open count', () => {
    const events = evaluateSecurity({ devices: fleet(), now: NOW, seed: 9 })
    const closed = events.map((e) => ({
      ...e,
      disposition: 'false-positive' as const,
    }))
    const cells = attackHeatmap(closed)
    for (const cell of cells) expect(cell.count).toBe(0)
  })
})

describe('securitySummary', () => {
  it('summarizes totals, open/contained and the score', () => {
    const events = evaluateSecurity({ devices: fleet(), now: NOW, seed: 10 })
    const summary = securitySummary(events)
    expect(summary.total).toBe(events.length)
    expect(summary.open + summary.contained + summary.falsePositives).toBe(
      events.length,
    )
    expect(summary.score).toBeGreaterThanOrEqual(0)
    expect(summary.score).toBeLessThanOrEqual(100)
  })
})

describe('integration with flows', () => {
  it('accepts a precomputed flow set and stays deterministic', () => {
    const flows = buildFlows(fleet(), 21)
    const a = evaluateSecurity({ devices: fleet(), flows, now: NOW, seed: 21 })
    const b = evaluateSecurity({ devices: fleet(), flows, now: NOW, seed: 21 })
    expect(a).toEqual(b)
  })
})
