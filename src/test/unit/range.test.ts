import { describe, expect, it } from 'vitest'
import type { Device, MetricSample } from '@/types'
import {
  buildMultiSeries,
  filterSamples,
  rangeStartMs,
  timeRangeById,
  TIME_RANGES,
} from '@/lib/range'

function device(id: string, capacityMbps = 1000): Device {
  return {
    id,
    name: id,
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
    capacityMbps,
    cpuPct: 20,
    memoryPct: 30,
    uptimeSec: 1000,
    lastSeen: 0,
  }
}

function sample(t: number, throughputMbps: number): MetricSample {
  return {
    t,
    latencyMs: 10,
    packetLossPct: 1,
    availabilityPct: 100,
    throughputMbps,
    cpuPct: 20,
    memoryPct: 30,
  }
}

describe('timeRangeById', () => {
  it('returns the matching range or a default', () => {
    expect(timeRangeById('1h').ms).toBe(3_600_000)
    expect(timeRangeById('missing').id).toBe(TIME_RANGES[1].id)
  })
})

describe('rangeStartMs', () => {
  it('subtracts finite windows and opens infinite ones', () => {
    expect(rangeStartMs(10_000, 5_000)).toBe(5_000)
    expect(rangeStartMs(10_000, Infinity)).toBe(-Infinity)
  })
})

describe('filterSamples', () => {
  it('keeps only samples inside the window', () => {
    const samples = [sample(1000, 100), sample(5000, 200), sample(9000, 300)]
    expect(filterSamples(samples, 10_000, 5_000).map((s) => s.t)).toEqual([
      5000, 9000,
    ])
    expect(filterSamples(samples, 10_000, Infinity)).toHaveLength(3)
  })
})

describe('buildMultiSeries', () => {
  it('aligns device series on shared timestamps', () => {
    const devices = [device('a'), device('b')]
    const history = {
      a: [sample(1000, 100), sample(2000, 200)],
      b: [sample(1000, 300), sample(2000, 400)],
    }
    const result = buildMultiSeries(
      devices,
      history,
      'throughput',
      2000,
      Infinity,
    )
    expect(result.keys).toEqual(['a', 'b'])
    expect(result.rows).toEqual([
      { t: 1000, a: 100, b: 300 },
      { t: 2000, a: 200, b: 400 },
    ])
  })

  it('derives utilisation from per-device capacity', () => {
    const devices = [device('a', 1000), device('b', 2000)]
    const history = {
      a: [sample(1000, 500)],
      b: [sample(1000, 1000)],
    }
    const result = buildMultiSeries(
      devices,
      history,
      'utilisation',
      1000,
      Infinity,
    )
    expect(result.rows[0]).toEqual({ t: 1000, a: 50, b: 50 })
  })

  it('omits missing points in a sparse row', () => {
    const devices = [device('a'), device('b')]
    const history = {
      a: [sample(1000, 100)],
      b: [sample(1000, 300), sample(2000, 400)],
    }
    const result = buildMultiSeries(
      devices,
      history,
      'throughput',
      2000,
      Infinity,
    )
    expect(result.rows[0]).toEqual({ t: 1000, a: 100, b: 300 })
    expect(result.rows[1]).toEqual({ t: 2000, b: 400 })
  })

  it('handles devices without history', () => {
    const result = buildMultiSeries([device('a')], {}, 'cpu', 1000, Infinity)
    expect(result.keys).toEqual(['a'])
    expect(result.rows).toEqual([])
  })
})
