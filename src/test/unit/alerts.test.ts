import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  alertInstanceId,
  compare,
  describeCondition,
  describeDuration,
  evaluateAlerts,
  firingAlerts,
  metricMeta,
  metricValue,
  pendingAlerts,
  scopeMatches,
  type AlertInstance,
  type AlertRule,
} from '@/lib/alerts'

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'dev1',
    name: 'Core Router',
    type: 'router',
    site: 'HQ',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: ['edge'],
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

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule1',
    name: 'Test rule',
    metric: 'latencyMs',
    op: 'gt',
    threshold: 100,
    forMs: 0,
    severity: 'high',
    ...overrides,
  }
}

function instance(overrides: Partial<AlertInstance>): AlertInstance {
  return {
    id: 'i',
    ruleId: 'rule1',
    ruleName: 'Test rule',
    deviceId: 'dev1',
    deviceName: 'Core Router',
    severity: 'high',
    status: 'firing',
    startedAt: 0,
    firedAt: 0,
    value: 1,
    ...overrides,
  }
}

describe('compare', () => {
  it('handles every operator', () => {
    expect(compare(5, 'gt', 3)).toBe(true)
    expect(compare(3, 'gt', 3)).toBe(false)
    expect(compare(3, 'gte', 3)).toBe(true)
    expect(compare(2, 'lt', 3)).toBe(true)
    expect(compare(3, 'lt', 3)).toBe(false)
    expect(compare(3, 'lte', 3)).toBe(true)
  })
})

describe('scopeMatches', () => {
  const d = device({ type: 'router', site: 'HQ', tags: ['edge', 'core'] })

  it('matches everything with no scope', () => {
    expect(scopeMatches(d, undefined)).toBe(true)
    expect(scopeMatches(d, {})).toBe(true)
  })

  it('filters by type, site and tag', () => {
    expect(scopeMatches(d, { type: 'router' })).toBe(true)
    expect(scopeMatches(d, { type: 'server' })).toBe(false)
    expect(scopeMatches(d, { site: 'HQ' })).toBe(true)
    expect(scopeMatches(d, { site: 'DC' })).toBe(false)
    expect(scopeMatches(d, { tag: 'edge' })).toBe(true)
    expect(scopeMatches(d, { tag: 'missing' })).toBe(false)
  })

  it('requires every present constraint to match', () => {
    expect(scopeMatches(d, { type: 'router', site: 'DC' })).toBe(false)
    expect(scopeMatches(d, { type: 'router', site: 'HQ', tag: 'edge' })).toBe(
      true,
    )
  })
})

describe('metricValue', () => {
  it('reads straight device metrics', () => {
    expect(metricValue(device({ latencyMs: 42 }), 'latencyMs')).toBe(42)
    expect(metricValue(device({ cpuPct: 99 }), 'cpuPct')).toBe(99)
    expect(metricValue(device({ memoryPct: 88 }), 'memoryPct')).toBe(88)
    expect(metricValue(device({ packetLossPct: 4 }), 'packetLossPct')).toBe(4)
    expect(
      metricValue(device({ availabilityPct: 95 }), 'availabilityPct'),
    ).toBe(95)
  })

  it('derives link utilisation from throughput and capacity', () => {
    expect(metricValue(device(), 'utilizationPct')).toBe(50)
    expect(
      metricValue(
        device({ throughputMbps: 900, capacityMbps: 1000 }),
        'utilizationPct',
      ),
    ).toBe(90)
  })
})

describe('metricMeta', () => {
  it('returns metadata and falls back for unknown metrics', () => {
    expect(metricMeta('latencyMs').label).toBe('Latency')
    // @ts-expect-error exercising the defensive fallback
    expect(metricMeta('nope').key).toBe('latencyMs')
  })
})

describe('descriptions', () => {
  it('describes conditions and durations', () => {
    expect(describeCondition(rule())).toBe('Latency > 100ms')
    expect(
      describeCondition(rule({ op: 'lte', metric: 'cpuPct', threshold: 90 })),
    ).toBe('CPU \u2264 90%')
    expect(describeDuration(0)).toBe('immediately')
    expect(describeDuration(10_000)).toBe('for 10s')
    expect(describeDuration(120_000)).toBe('for 2m')
  })
})

describe('evaluateAlerts', () => {
  const id = alertInstanceId('rule1', 'dev1')

  it('fires immediately when forMs is zero', () => {
    const result = evaluateAlerts({
      devices: [device({ latencyMs: 150 })],
      rules: [rule()],
      states: {},
      now: 1000,
    })
    expect(result.states[id].status).toBe('firing')
    expect(result.states[id].firedAt).toBe(1000)
    expect(result.changes).toEqual([
      { kind: 'firing', instance: result.states[id] },
    ])
  })

  it('stays pending until the condition holds long enough', () => {
    const dev = device({ latencyMs: 150 })
    const r = rule({ forMs: 10_000 })

    const first = evaluateAlerts({
      devices: [dev],
      rules: [r],
      states: {},
      now: 1000,
    })
    expect(first.states[id].status).toBe('pending')
    expect(first.states[id].firedAt).toBeNull()
    expect(first.changes).toEqual([])

    const mid = evaluateAlerts({
      devices: [dev],
      rules: [r],
      states: first.states,
      now: 5000,
    })
    expect(mid.states[id].status).toBe('pending')
    expect(mid.changes).toEqual([])

    const later = evaluateAlerts({
      devices: [dev],
      rules: [r],
      states: mid.states,
      now: 11_001,
    })
    expect(later.states[id].status).toBe('firing')
    expect(later.states[id].firedAt).toBe(11_001)
    expect(later.changes.map((c) => c.kind)).toEqual(['firing'])
  })

  it('resolves a firing alert once the condition clears', () => {
    const fired = evaluateAlerts({
      devices: [device({ latencyMs: 150 })],
      rules: [rule()],
      states: {},
      now: 1000,
    }).states

    const result = evaluateAlerts({
      devices: [device({ latencyMs: 10 })],
      rules: [rule()],
      states: fired,
      now: 2000,
    })
    expect(result.states[id]).toBeUndefined()
    expect(result.changes).toEqual([{ kind: 'resolved', instance: fired[id] }])
  })

  it('reports nothing when an alert never fired', () => {
    const result = evaluateAlerts({
      devices: [device({ latencyMs: 10 })],
      rules: [rule()],
      states: {},
      now: 1000,
    })
    expect(result.changes).toEqual([])
    expect(result.states).toEqual({})
  })

  it('updates the value of a firing alert without re-firing', () => {
    const fired = evaluateAlerts({
      devices: [device({ latencyMs: 150 })],
      rules: [rule()],
      states: {},
      now: 1000,
    }).states

    const result = evaluateAlerts({
      devices: [device({ latencyMs: 175 })],
      rules: [rule()],
      states: fired,
      now: 2000,
    })
    expect(result.states[id].value).toBe(175)
    expect(result.states[id].status).toBe('firing')
    expect(result.states[id].firedAt).toBe(1000)
    expect(result.changes).toEqual([])
  })

  it('honours rule scope', () => {
    const router = device({ id: 'r1', type: 'router' })
    const server = device({ id: 's1', type: 'server', latencyMs: 150 })
    const result = evaluateAlerts({
      devices: [router, server],
      rules: [rule({ scope: { type: 'server' } })],
      states: {},
      now: 1000,
    })
    expect(Object.keys(result.states)).toEqual([alertInstanceId('rule1', 's1')])
  })

  it('tracks many rules and devices independently', () => {
    const result = evaluateAlerts({
      devices: [
        device({ id: 'a', latencyMs: 150 }),
        device({ id: 'b', cpuPct: 99 }),
      ],
      rules: [rule(), rule({ id: 'rule2', metric: 'cpuPct', threshold: 90 })],
      states: {},
      now: 1000,
    })
    expect(Object.keys(result.states).sort()).toEqual([
      alertInstanceId('rule1', 'a'),
      alertInstanceId('rule2', 'b'),
    ])
  })
})

describe('firingAlerts / pendingAlerts', () => {
  const states = {
    a: instance({ id: 'a', status: 'pending', startedAt: 500, firedAt: null }),
    b: instance({ id: 'b', status: 'firing', firedAt: 1000 }),
    c: instance({ id: 'c', status: 'firing', firedAt: 3000 }),
  }

  it('returns only firing alerts, newest first', () => {
    expect(firingAlerts(states).map((i) => i.id)).toEqual(['c', 'b'])
  })

  it('returns only pending alerts', () => {
    expect(pendingAlerts(states).map((i) => i.id)).toEqual(['a'])
  })
})
