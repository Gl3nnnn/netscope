import type { Device, MetricSample } from '@/types'
import { metricFromSample, type QueryMetric } from './query'

/** Selectable time windows for the metric explorer. */
export interface TimeRangeOption {
  id: string
  label: string
  ms: number
}

export const TIME_RANGES: TimeRangeOption[] = [
  { id: '5m', label: 'Last 5 minutes', ms: 5 * 60_000 },
  { id: '15m', label: 'Last 15 minutes', ms: 15 * 60_000 },
  { id: '1h', label: 'Last hour', ms: 60 * 60_000 },
  { id: 'all', label: 'All history', ms: Infinity },
]

export function timeRangeById(id: string): TimeRangeOption {
  return TIME_RANGES.find((range) => range.id === id) ?? TIME_RANGES[1]
}

/** Inclusive lower bound (epoch ms) for a window ending at `now`. */
export function rangeStartMs(now: number, windowMs: number): number {
  if (!Number.isFinite(windowMs)) return -Infinity
  return now - windowMs
}

/** Samples falling inside the window ending at `now`. */
export function filterSamples(
  samples: MetricSample[],
  now: number,
  windowMs: number,
): MetricSample[] {
  const start = rangeStartMs(now, windowMs)
  return samples.filter((sample) => sample.t >= start)
}

export interface MultiSeries {
  /** Device ids, in the order they were supplied. */
  keys: string[]
  /** One row per aligned timestamp; each device id maps to its value. */
  rows: Array<Record<string, number>>
}

/**
 * Build an aligned multi-series overlay for a metric across devices. Assumes
 * samples share timestamps (the simulation ticks the whole fleet together) but
 * tolerates drift by bucketing on the exact timestamp and forward-filling from
 * the most recent observation.
 */
export function buildMultiSeries(
  devices: Device[],
  history: Record<string, MetricSample[]>,
  metric: QueryMetric,
  now: number,
  windowMs: number,
): MultiSeries {
  const keys = devices.map((device) => device.id)
  const perDevice = new Map<string, Map<number, number>>()
  const timestamps = new Set<number>()

  for (const device of devices) {
    const samples = filterSamples(history[device.id] ?? [], now, windowMs)
    const points = new Map<number, number>()
    for (const sample of samples) {
      points.set(
        sample.t,
        metricFromSample(sample, metric, device.capacityMbps),
      )
      timestamps.add(sample.t)
    }
    perDevice.set(device.id, points)
  }

  const sorted = [...timestamps].sort((a, b) => a - b)
  const rows: Array<Record<string, number>> = []
  for (const t of sorted) {
    const row: Record<string, number> = { t }
    for (const key of keys) {
      const value = perDevice.get(key)?.get(t)
      if (value !== undefined) row[key] = value
    }
    rows.push(row)
  }

  return { keys, rows }
}
