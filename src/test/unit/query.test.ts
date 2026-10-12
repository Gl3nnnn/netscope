import { describe, expect, it } from 'vitest'
import type { Device, MetricSample } from '@/types'
import {
  applyQuery,
  compareMetric,
  matchesQuery,
  metricFromDevice,
  metricFromSample,
  parseQuery,
  queryMetricMeta,
} from '@/lib/query'

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'dev1',
    name: 'core-sw-01',
    type: 'switch',
    site: 'DC-A',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: ['edge', 'production'],
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

function sample(overrides: Partial<MetricSample> = {}): MetricSample {
  return {
    t: 1000,
    latencyMs: 10,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 500,
    cpuPct: 20,
    memoryPct: 30,
    ...overrides,
  }
}

describe('parseQuery', () => {
  it('parses free text, fields and comparisons', () => {
    const query = parseQuery('core site:DC-A latency>50 tag:edge')
    expect(query.terms).toEqual([
      { kind: 'text', value: 'core' },
      { kind: 'field', field: 'site', value: 'DC-A' },
      { kind: 'comparison', metric: 'latency', op: '>', value: 50 },
      { kind: 'field', field: 'tag', value: 'edge' },
    ])
  })

  it('resolves metric aliases', () => {
    expect(parseQuery('mem>=80').terms[0]).toEqual({
      kind: 'comparison',
      metric: 'memory',
      op: '>=',
      value: 80,
    })
    expect(parseQuery('util<50').terms[0]).toMatchObject({
      metric: 'utilisation',
    })
    expect(parseQuery('pktloss=3').terms[0]).toMatchObject({ kind: 'text' })
  })

  it('falls back to text for malformed comparisons and unknown fields', () => {
    expect(parseQuery('latency>abc').terms[0]).toEqual({
      kind: 'text',
      value: 'latency>abc',
    })
    expect(parseQuery('foo:bar').terms[0]).toEqual({
      kind: 'text',
      value: 'foo:bar',
    })
  })

  it('ignores extra whitespace', () => {
    expect(parseQuery('   ').terms).toEqual([])
    expect(parseQuery('  site:DC-A   cpu>80  ').terms).toHaveLength(2)
  })
})

describe('compareMetric', () => {
  it('handles each operator', () => {
    expect(compareMetric(5, '>', 3)).toBe(true)
    expect(compareMetric(3, '>=', 3)).toBe(true)
    expect(compareMetric(2, '<', 3)).toBe(true)
    expect(compareMetric(3, '<=', 3)).toBe(true)
    expect(compareMetric(3, '=', 3)).toBe(true)
    expect(compareMetric(4, '=', 3)).toBe(false)
  })
})

describe('metricFromDevice', () => {
  it('reads each metric', () => {
    expect(metricFromDevice(device({ latencyMs: 42 }), 'latency')).toBe(42)
    expect(metricFromDevice(device({ packetLossPct: 3 }), 'loss')).toBe(3)
    expect(
      metricFromDevice(device({ availabilityPct: 98 }), 'availability'),
    ).toBe(98)
    expect(
      metricFromDevice(device({ throughputMbps: 250 }), 'throughput'),
    ).toBe(250)
    expect(metricFromDevice(device({ cpuPct: 90 }), 'cpu')).toBe(90)
    expect(metricFromDevice(device({ memoryPct: 70 }), 'memory')).toBe(70)
    expect(metricFromDevice(device(), 'utilisation')).toBe(50)
  })
})

describe('metricFromSample', () => {
  it('derives utilisation from throughput and capacity', () => {
    expect(metricFromSample(sample(), 'utilisation', 1000)).toBe(50)
    expect(
      metricFromSample(sample({ throughputMbps: 750 }), 'utilisation', 1000),
    ).toBe(75)
    expect(metricFromSample(sample({ latencyMs: 7 }), 'latency')).toBe(7)
  })
})

describe('queryMetricMeta', () => {
  it('returns metadata and a fallback', () => {
    expect(queryMetricMeta('latency').unit).toBe('ms')
    // @ts-expect-error defensive fallback
    expect(queryMetricMeta('nope').key).toBe('latency')
  })
})

describe('matchesQuery / applyQuery', () => {
  const fleet = [
    device({
      id: 'a',
      name: 'core-sw-01',
      site: 'DC-A',
      status: 'degraded',
      latencyMs: 80,
      tags: ['production'],
    }),
    device({
      id: 'b',
      name: 'edge-rt-02',
      site: 'DC-B',
      type: 'router',
      tags: ['edge'],
    }),
    device({
      id: 'c',
      name: 'db-srv-03',
      site: 'DC-A',
      type: 'server',
      cpuPct: 95,
      tags: ['database'],
    }),
  ]

  it('matches free text across name, site, ip and tags', () => {
    expect(applyQuery(fleet, 'edge').map((d) => d.id)).toEqual(['b'])
    expect(applyQuery(fleet, 'dc-a').map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('matches fields case-insensitively', () => {
    expect(applyQuery(fleet, 'type:server').map((d) => d.id)).toEqual(['c'])
    expect(applyQuery(fleet, 'status:degraded').map((d) => d.id)).toEqual(['a'])
    expect(applyQuery(fleet, 'site:dc-a').map((d) => d.id)).toEqual(['a', 'c'])
  })

  it('matches metric comparisons', () => {
    expect(applyQuery(fleet, 'latency>50').map((d) => d.id)).toEqual(['a'])
    expect(applyQuery(fleet, 'cpu>=90').map((d) => d.id)).toEqual(['c'])
  })

  it('ANDs multiple terms', () => {
    expect(applyQuery(fleet, 'site:DC-A cpu>90').map((d) => d.id)).toEqual([
      'c',
    ])
    expect(applyQuery(fleet, 'site:DC-A type:router')).toEqual([])
  })

  it('returns the whole fleet for an empty query', () => {
    expect(applyQuery(fleet, '')).toHaveLength(3)
    expect(applyQuery(fleet, '   ')).toHaveLength(3)
  })

  it('exposes matchesQuery directly', () => {
    const query = parseQuery('type:router')
    expect(matchesQuery(fleet[1], query)).toBe(true)
    expect(matchesQuery(fleet[0], query)).toBe(false)
  })
})
