import { describe, expect, it } from 'vitest'
import { aggregateHistory } from '@/lib/aggregate'
import { buildSeedDevices } from '@/simulation/seed'
import { mulberry32 } from '@/simulation/random'
import type { MetricSample } from '@/types'

const devices = buildSeedDevices(mulberry32(1), 0)
const [a, b] = devices

const sample = (
  overrides: Partial<MetricSample> & Pick<MetricSample, 't'>,
): MetricSample => ({
  latencyMs: 10,
  packetLossPct: 1,
  availabilityPct: 99,
  throughputMbps: 100,
  cpuPct: 20,
  memoryPct: 40,
  ...overrides,
})

describe('aggregateHistory', () => {
  it('averages every metric across devices at the same timestamp', () => {
    const history = {
      [a.id]: [
        sample({
          t: 100,
          latencyMs: 10,
          packetLossPct: 1,
          availabilityPct: 99,
          throughputMbps: 100,
          cpuPct: 20,
          memoryPct: 40,
        }),
      ],
      [b.id]: [
        sample({
          t: 100,
          latencyMs: 20,
          packetLossPct: 3,
          availabilityPct: 98,
          throughputMbps: 300,
          cpuPct: 60,
          memoryPct: 80,
        }),
      ],
    }

    const series = aggregateHistory(devices, history)
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({
      t: 100,
      latencyMs: 15,
      packetLossPct: 2,
      availabilityPct: 98.5,
      throughputMbps: 200,
      cpuPct: 40,
      memoryPct: 60,
    })
  })

  it('sorts the aggregated series by timestamp ascending', () => {
    const history = {
      [a.id]: [sample({ t: 200 }), sample({ t: 100 })],
    }
    const series = aggregateHistory(devices, history)
    expect(series.map((point) => point.t)).toEqual([100, 200])
  })

  it('returns an empty series when no device has history', () => {
    expect(aggregateHistory(devices, {})).toEqual([])
  })
})
