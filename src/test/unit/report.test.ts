import { describe, expect, it } from 'vitest'
import type { Device, Incident, MetricSample, TimelineEvent } from '@/types'
import {
  buildIncidentReport,
  reportToJson,
  reportToMarkdown,
} from '@/lib/report'
import { RUNBOOKS } from '@/lib/runbooks'

const device = (id: string, name: string, site = 'HQ'): Device => ({
  id,
  name,
  type: 'server',
  site,
  ip: '10.0.0.1',
  mac: 'aa:bb:cc:dd:ee:ff',
  status: 'offline',
  tags: [],
  latencyMs: 240,
  packetLossPct: 12,
  availabilityPct: 85,
  throughputMbps: 100,
  capacityMbps: 1000,
  cpuPct: 40,
  memoryPct: 50,
  uptimeSec: 0,
  lastSeen: 0,
})

const sample = (t: number, patch: Partial<MetricSample>): MetricSample => ({
  t,
  latencyMs: 10,
  packetLossPct: 0,
  availabilityPct: 100,
  throughputMbps: 100,
  cpuPct: 20,
  memoryPct: 30,
  ...patch,
})

const incident: Incident = {
  id: 'inc_1',
  title: 'Core switch down',
  description: 'Offline',
  severity: 'critical',
  status: 'resolved',
  deviceIds: ['dev_1', 'dev_2'],
  createdAt: 1000,
  updatedAt: 5000,
  resolvedAt: 5000,
}

const devices = [device('dev_1', 'core-sw'), device('dev_2', 'edge-1', 'Edge')]
const events: TimelineEvent[] = [
  {
    id: 'e1',
    timestamp: 1000,
    type: 'status',
    message: 'core-sw went offline',
  },
  { id: 'e2', timestamp: 3000, type: 'incident', message: 'Incident opened' },
  {
    id: 'e3',
    timestamp: 5000,
    type: 'incident',
    deviceId: 'dev_1',
    message: 'Incident resolved',
  },
]
const history = {
  dev_1: [
    sample(500, { latencyMs: 5, availabilityPct: 100 }),
    sample(1500, { latencyMs: 300, packetLossPct: 20, availabilityPct: 60 }),
    sample(4000, { latencyMs: 180, packetLossPct: 8, availabilityPct: 80 }),
  ],
  dev_2: [
    sample(2000, { latencyMs: 120, packetLossPct: 4, availabilityPct: 90 }),
  ],
}

describe('buildIncidentReport', () => {
  it('collects affected devices and windowed metrics', () => {
    const report = buildIncidentReport({
      incident,
      devices,
      events,
      history,
      generatedAt: 6000,
    })
    expect(report.affectedDevices).toHaveLength(2)
    expect(report.metrics.deviceCount).toBe(2)
    expect(report.metrics.sampleCount).toBe(3)
    expect(report.metrics.peakLatencyMs).toBe(300)
    expect(report.metrics.peakPacketLossPct).toBe(20)
    expect(report.metrics.minAvailabilityPct).toBe(60)
  })

  it('computes duration from createdAt to resolvedAt', () => {
    const report = buildIncidentReport({
      incident,
      devices,
      events,
      history,
      generatedAt: 6000,
    })
    expect(report.durationMs).toBe(4000)
  })

  it('falls back to current device values when there is no history', () => {
    const report = buildIncidentReport({
      incident,
      devices,
      events,
      history: {},
      generatedAt: 6000,
    })
    expect(report.metrics.sampleCount).toBe(2)
    expect(report.metrics.peakLatencyMs).toBe(240)
  })

  it('carries runbook steps and probable cause through', () => {
    const report = buildIncidentReport({
      incident,
      devices,
      events,
      history,
      generatedAt: 6000,
      runbook: RUNBOOKS.offline,
      probableCause: 'core-sw',
    })
    expect(report.recommendedActions).toEqual(RUNBOOKS.offline.steps)
    expect(report.probableCause).toBe('core-sw')
  })

  it('orders the timeline chronologically', () => {
    const report = buildIncidentReport({
      incident,
      devices,
      events,
      history,
      generatedAt: 6000,
    })
    const stamps = report.timeline.map((entry) => entry.timestamp)
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b))
  })
})

describe('reportToMarkdown', () => {
  it('includes the title, impact and recommended actions', () => {
    const report = buildIncidentReport({
      incident,
      devices,
      events,
      history,
      generatedAt: 6000,
      runbook: RUNBOOKS.offline,
    })
    const markdown = reportToMarkdown(report)
    expect(markdown).toContain('# Incident postmortem: Core switch down')
    expect(markdown).toContain('## Impact')
    expect(markdown).toContain('## Recommended actions')
    expect(markdown).toContain('- [ ] ')
  })
})

describe('reportToJson', () => {
  it('round-trips to a parsable object', () => {
    const report = buildIncidentReport({
      incident,
      devices,
      events,
      history,
      generatedAt: 6000,
    })
    expect(JSON.parse(reportToJson(report)).title).toBe('Core switch down')
  })
})
