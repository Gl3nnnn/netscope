import type { Device, MetricSample } from '@/types'
import { utilizationPct } from './capacity'

/**
 * A tiny, dependency-free query language for the metric explorer.
 *
 * Supported tokens (whitespace separated, implicitly AND-ed):
 *   - free text            `core`
 *   - field match          `site:HQ` `type:router` `status:degraded` `tag:edge`
 *   - metric comparison    `latency>50` `loss<=2` `cpu>=80` `util>90`
 *
 * Kept deliberately small so it is predictable and easy to unit test.
 */

export type QueryMetric =
  | 'latency'
  | 'loss'
  | 'availability'
  | 'throughput'
  | 'cpu'
  | 'memory'
  | 'utilisation'

export interface QueryMetricMeta {
  key: QueryMetric
  label: string
  unit: string
}

export const QUERY_METRICS: QueryMetricMeta[] = [
  { key: 'latency', label: 'Latency', unit: 'ms' },
  { key: 'loss', label: 'Packet loss', unit: '%' },
  { key: 'availability', label: 'Availability', unit: '%' },
  { key: 'throughput', label: 'Throughput', unit: 'Mbps' },
  { key: 'cpu', label: 'CPU', unit: '%' },
  { key: 'memory', label: 'Memory', unit: '%' },
  { key: 'utilisation', label: 'Link utilisation', unit: '%' },
]

export function queryMetricMeta(metric: QueryMetric): QueryMetricMeta {
  return QUERY_METRICS.find((meta) => meta.key === metric) ?? QUERY_METRICS[0]
}

const METRIC_ALIASES: Record<string, QueryMetric> = {
  latency: 'latency',
  lat: 'latency',
  loss: 'loss',
  packetloss: 'loss',
  availability: 'availability',
  avail: 'availability',
  uptime: 'availability',
  throughput: 'throughput',
  through: 'throughput',
  traffic: 'throughput',
  cpu: 'cpu',
  mem: 'memory',
  memory: 'memory',
  util: 'utilisation',
  utilisation: 'utilisation',
  utilization: 'utilisation',
}

export type CompareOp = '>' | '>=' | '<' | '<=' | '='

export interface QueryTextTerm {
  kind: 'text'
  value: string
}

export interface QueryFieldTerm {
  kind: 'field'
  field: 'site' | 'type' | 'status' | 'tag' | 'name' | 'ip'
  value: string
}

export interface QueryComparisonTerm {
  kind: 'comparison'
  metric: QueryMetric
  op: CompareOp
  value: number
}

export type QueryTerm = QueryTextTerm | QueryFieldTerm | QueryComparisonTerm

export interface Query {
  raw: string
  terms: QueryTerm[]
}

const FIELD_NAMES = new Set(['site', 'type', 'status', 'tag', 'name', 'ip'])

const COMPARISON_RE = /^([a-z]+)\s*(>=|<=|>|<|=)\s*(-?[0-9.]+)$/i
const FIELD_RE = /^([a-z]+):(.+)$/i

export function parseQuery(raw: string): Query {
  const terms: QueryTerm[] = []
  for (const token of raw.trim().split(/\s+/)) {
    if (!token) continue
    const comparison = token.match(COMPARISON_RE)
    if (comparison) {
      const metric = METRIC_ALIASES[comparison[1].toLowerCase()]
      const value = Number(comparison[3])
      if (metric && Number.isFinite(value)) {
        terms.push({
          kind: 'comparison',
          metric,
          op: comparison[2] as CompareOp,
          value,
        })
        continue
      }
    }
    const field = token.match(FIELD_RE)
    if (field) {
      const name = field[1].toLowerCase()
      if (FIELD_NAMES.has(name)) {
        terms.push({
          kind: 'field',
          field: name as QueryFieldTerm['field'],
          value: field[2],
        })
        continue
      }
    }
    terms.push({ kind: 'text', value: token })
  }
  return { raw, terms }
}

export function metricFromDevice(device: Device, metric: QueryMetric): number {
  switch (metric) {
    case 'latency':
      return device.latencyMs
    case 'loss':
      return device.packetLossPct
    case 'availability':
      return device.availabilityPct
    case 'throughput':
      return device.throughputMbps
    case 'cpu':
      return device.cpuPct
    case 'memory':
      return device.memoryPct
    case 'utilisation':
      return utilizationPct(device.throughputMbps, device.capacityMbps)
  }
}

export function metricFromSample(
  sample: MetricSample,
  metric: QueryMetric,
  capacityMbps = 0,
): number {
  switch (metric) {
    case 'latency':
      return sample.latencyMs
    case 'loss':
      return sample.packetLossPct
    case 'availability':
      return sample.availabilityPct
    case 'throughput':
      return sample.throughputMbps
    case 'cpu':
      return sample.cpuPct
    case 'memory':
      return sample.memoryPct
    case 'utilisation':
      return utilizationPct(sample.throughputMbps, capacityMbps)
  }
}

export function compareMetric(
  value: number,
  op: CompareOp,
  target: number,
): boolean {
  switch (op) {
    case '>':
      return value > target
    case '>=':
      return value >= target
    case '<':
      return value < target
    case '<=':
      return value <= target
    case '=':
      return value === target
  }
}

function matchesField(
  device: Device,
  field: QueryFieldTerm['field'],
  value: string,
): boolean {
  const needle = value.toLowerCase()
  switch (field) {
    case 'site':
      return device.site.toLowerCase() === needle
    case 'type':
      return device.type.toLowerCase() === needle
    case 'status':
      return device.status === needle
    case 'tag':
      return device.tags.some((tag) => tag.toLowerCase() === needle)
    case 'name':
      return device.name.toLowerCase().includes(needle)
    case 'ip':
      return device.ip.includes(value)
  }
}

export function matchesQuery(device: Device, query: Query): boolean {
  for (const term of query.terms) {
    if (term.kind === 'text') {
      const needle = term.value.toLowerCase()
      const haystack = [device.name, device.site, device.ip, ...device.tags]
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(needle)) return false
    } else if (term.kind === 'field') {
      if (!matchesField(device, term.field, term.value)) return false
    } else if (
      !compareMetric(metricFromDevice(device, term.metric), term.op, term.value)
    ) {
      return false
    }
  }
  return true
}

/** Filter a fleet by a query string. Empty query returns all devices. */
export function applyQuery(devices: Device[], raw: string): Device[] {
  const query = parseQuery(raw)
  if (query.terms.length === 0) return devices
  return devices.filter((device) => matchesQuery(device, query))
}

export const QUERY_EXAMPLES: string[] = [
  'site:DC-A',
  'type:router latency>50',
  'status:degraded',
  'util>80',
  'cpu>=85 loss>1',
]
