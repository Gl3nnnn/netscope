import { describe, expect, it } from 'vitest'
import { buildDevicesCsv, buildHistoryCsv, toCsv } from '@/lib/csv'
import type { Device, MetricSample } from '@/types'

const device = (overrides: Partial<Device> = {}): Device => ({
  id: 'dev_1',
  name: 'edge-router',
  type: 'router',
  site: 'HQ',
  ip: '10.1.0.1',
  mac: 'AA:BB:CC:DD:EE:01',
  status: 'online',
  tags: ['edge', 'dmz'],
  latencyMs: 2.5,
  packetLossPct: 0,
  availabilityPct: 99.999,
  throughputMbps: 1250.5,
  cpuPct: 42,
  memoryPct: 60,
  uptimeSec: 86400,
  lastSeen: 1700000000000,
  ...overrides,
})

describe('toCsv', () => {
  it('escapes commas, quotes and newlines', () => {
    const csv = toCsv(['name', 'note'], [['a,b', 'say "hi"\nnext']])
    expect(csv).toBe('name,note\r\n"a,b","say ""hi""\nnext"\r\n')
  })

  it('writes the header only for empty rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n')
  })
})

describe('buildDevicesCsv', () => {
  it('writes a header plus one row per device', () => {
    const csv = buildDevicesCsv([device()])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('throughputMbps')
    expect(lines[1]).toContain('edge-router')
    expect(lines[1]).toContain('1250.5')
  })

  it('joins tags with semicolons', () => {
    expect(buildDevicesCsv([device()])).toContain('edge; dmz')
  })
})

describe('buildHistoryCsv', () => {
  const sample: MetricSample = {
    t: 1700000000000,
    latencyMs: 3,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 800,
    cpuPct: 40,
    memoryPct: 50,
  }

  it('flattens one row per sample with device metadata', () => {
    const csv = buildHistoryCsv([device()], { dev_1: [sample] })
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('HQ')
    expect(lines[1]).toContain('edge-router')
  })

  it('emits headers even when there is no history', () => {
    const lines = buildHistoryCsv([device()], {}).trim().split('\r\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('timestamp')
  })
})
