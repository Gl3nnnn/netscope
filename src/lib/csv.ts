import type { Device, MetricSample } from '@/types'
import { round } from '@/lib/format'

function escape(value: string | number | boolean): string {
  const text = String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** Serialise headers + rows as RFC-4180-ish CSV. */
export function toCsv(
  headers: string[],
  rows: (string | number | boolean)[][],
): string {
  const encode = (line: (string | number | boolean)[]) =>
    line.map(escape).join(',')
  return [encode(headers), ...rows.map(encode)].join('\r\n') + '\r\n'
}

const DEVICE_HEADERS = [
  'id',
  'name',
  'type',
  'site',
  'ip',
  'mac',
  'status',
  'latencyMs',
  'packetLossPct',
  'availabilityPct',
  'throughputMbps',
  'cpuPct',
  'memoryPct',
  'uptimeSec',
  'lastSeen',
  'flapping',
  'inMaintenance',
  'tags',
] as const

export function buildDevicesCsv(devices: Device[]): string {
  const rows = devices.map((device) => [
    device.id,
    device.name,
    device.type,
    device.site,
    device.ip,
    device.mac,
    device.status,
    round(device.latencyMs, 2),
    round(device.packetLossPct, 2),
    round(device.availabilityPct, 3),
    round(device.throughputMbps, 1),
    round(device.cpuPct, 1),
    round(device.memoryPct, 1),
    device.uptimeSec,
    device.lastSeen,
    device.flapping === true,
    device.inMaintenance === true,
    device.tags.join('; '),
  ])
  return toCsv([...DEVICE_HEADERS] as string[], rows)
}

const HISTORY_HEADERS = [
  'device',
  'site',
  'type',
  'timestamp',
  'latencyMs',
  'packetLossPct',
  'availabilityPct',
  'throughputMbps',
  'cpuPct',
  'memoryPct',
] as const

/** Flatten rolling per-device history into one CSV with device metadata. */
export function buildHistoryCsv(
  devices: Device[],
  history: Record<string, MetricSample[]>,
): string {
  const rows: (string | number | boolean)[][] = []
  for (const device of devices) {
    const samples = history[device.id] ?? []
    for (const sample of samples) {
      rows.push([
        device.name,
        device.site,
        device.type,
        sample.t,
        round(sample.latencyMs, 2),
        round(sample.packetLossPct, 2),
        round(sample.availabilityPct, 3),
        round(sample.throughputMbps, 1),
        round(sample.cpuPct, 1),
        round(sample.memoryPct, 1),
      ])
    }
  }
  return toCsv([...HISTORY_HEADERS] as string[], rows)
}
