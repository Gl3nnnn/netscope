import { describe, expect, it } from 'vitest'
import type { Device, Incident, MetricSample, TimelineEvent } from '@/types'
import {
  ALL_REPORT_SECTIONS,
  REPORT_PRESETS,
  buildExecutiveReport,
  executiveToHtml,
  executiveToMarkdown,
  type ReportContext,
} from '@/lib/reports'
import type { CurrentOnCall } from '@/lib/oncall'

const HOUR = 60 * 60 * 1000
const NOW = 1_700_000_000_000

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: 'Core Router',
    type: 'router',
    site: 'HQ',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 10,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 500,
    capacityMbps: 1000,
    cpuPct: 20,
    memoryPct: 30,
    uptimeSec: 1000,
    lastSeen: NOW,
    ...overrides,
  }
}

function sample(
  t: number,
  overrides: Partial<MetricSample> = {},
): MetricSample {
  return {
    t,
    latencyMs: 10,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 400,
    cpuPct: 20,
    memoryPct: 30,
    ...overrides,
  }
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'Link flap',
    description: '',
    severity: 'high',
    status: 'open',
    deviceIds: ['d1'],
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    ...overrides,
  }
}

function context(overrides: Partial<ReportContext> = {}): ReportContext {
  const devices = overrides.devices ?? [device()]
  const history: Record<string, MetricSample[]> = overrides.history ?? {
    d1: [sample(NOW - 2 * HOUR), sample(NOW - HOUR), sample(NOW)],
  }
  return {
    devices,
    incidents: overrides.incidents ?? [],
    events: overrides.events ?? [],
    history,
    thresholds: overrides.thresholds ?? {
      latencyMs: 100,
      packetLossPct: 2,
      availabilityPct: 99,
    },
    range: overrides.range ?? { from: NOW - 24 * HOUR, to: NOW },
    generatedAt: overrides.generatedAt ?? NOW,
    sections: overrides.sections,
    onCall: overrides.onCall,
    slo: overrides.slo,
  }
}

describe('buildExecutiveReport', () => {
  it('includes all sections by default in canonical order', () => {
    const report = buildExecutiveReport(context())
    expect(report.sections.map((section) => section.id)).toEqual(
      ALL_REPORT_SECTIONS,
    )
    expect(report.headline).toContain('devices')
  })

  it('filters to requested sections in canonical order', () => {
    const report = buildExecutiveReport(
      context({ sections: ['changes', 'overview'] }),
    )
    expect(report.sections.map((section) => section.id)).toEqual([
      'overview',
      'changes',
    ])
  })

  it('summarises fleet health and status counts', () => {
    const devices = [
      device({ id: 'd1' }),
      device({ id: 'd2', status: 'degraded', availabilityPct: 95 }),
      device({ id: 'd3', status: 'offline', availabilityPct: 0 }),
    ]
    const report = buildExecutiveReport(context({ devices }))
    const overview = report.sections.find((s) => s.id === 'overview')
    expect(overview).toBeDefined()
    const health = overview?.metrics.find((m) => m.label === 'Devices')
    expect(health?.value).toBe('3')
    expect(overview?.table?.rows).toContainEqual(['Critical', '1'])
  })

  it('only counts incidents created inside the range', () => {
    const incidents = [
      incident({ id: 'a', createdAt: NOW - HOUR }),
      incident({ id: 'b', createdAt: NOW - 48 * HOUR }),
    ]
    const report = buildExecutiveReport(context({ incidents }))
    const incidentsSection = report.sections.find((s) => s.id === 'incidents')
    expect(
      incidentsSection?.metrics.find((m) => m.label === 'Total')?.value,
    ).toBe('1')
  })

  it('ranks incidents by severity then recency', () => {
    const incidents = [
      incident({
        id: 'low',
        severity: 'low',
        title: 'Low',
        createdAt: NOW - HOUR,
      }),
      incident({
        id: 'crit',
        severity: 'critical',
        title: 'Critical',
        createdAt: NOW - 2 * HOUR,
      }),
    ]
    const report = buildExecutiveReport(context({ incidents }))
    const section = report.sections.find((s) => s.id === 'incidents')
    expect(section?.table?.rows[0][1]).toBe('Critical')
  })

  it('lists configuration events as changes in range', () => {
    const events: TimelineEvent[] = [
      {
        id: 'e1',
        timestamp: NOW - HOUR,
        type: 'config',
        message: 'Config changed',
        deviceId: 'd1',
      },
      {
        id: 'e2',
        timestamp: NOW - HOUR,
        type: 'status',
        message: 'Status changed',
      },
      {
        id: 'e3',
        timestamp: NOW - 48 * HOUR,
        type: 'config',
        message: 'Old change',
      },
    ]
    const report = buildExecutiveReport(context({ events }))
    const section = report.sections.find((s) => s.id === 'changes')
    expect(section?.metrics[0].value).toBe('1')
    expect(section?.table?.rows[0]).toContain('Config changed')
    expect(section?.table?.rows[0][1]).toBe('Core Router')
  })

  it('flags saturated devices in the capacity section', () => {
    const devices = [
      device({ id: 'd1', throughputMbps: 950, capacityMbps: 1000 }),
      device({ id: 'd2', throughputMbps: 100, capacityMbps: 1000 }),
    ]
    const report = buildExecutiveReport(context({ devices }))
    const section = report.sections.find((s) => s.id === 'capacity')
    expect(section?.metrics.find((m) => m.label === 'Saturated')?.value).toBe(
      '1',
    )
  })

  it('renders on-call coverage when provided', () => {
    const onCall: CurrentOnCall[] = [
      {
        rotation: {
          id: 'r1',
          teamId: 't1',
          name: 'Primary',
          startsAt: NOW,
          intervalMs: HOUR,
          members: ['m1'],
        },
        team: {
          id: 't1',
          name: 'Platform',
          members: [{ id: 'm1', name: 'Ada' }],
        },
        member: { id: 'm1', name: 'Ada' },
        next: { at: NOW + HOUR, memberId: 'm1' },
      },
    ]
    const report = buildExecutiveReport(context({ onCall }))
    const section = report.sections.find((s) => s.id === 'oncall')
    expect(section?.table?.rows[0].slice(0, 3)).toEqual([
      'Platform',
      'Primary',
      'Ada',
    ])
  })

  it('notes when no on-call rotations exist', () => {
    const report = buildExecutiveReport(
      context({ sections: ['oncall'], onCall: [] }),
    )
    const section = report.sections.find((s) => s.id === 'oncall')
    expect(section?.summary).toContain('No rotations')
    expect(section?.table).toBeUndefined()
  })

  it('builds an availability sparkline in the overview', () => {
    const report = buildExecutiveReport(context())
    const overview = report.sections.find((s) => s.id === 'overview')
    expect(overview?.sparkline?.length).toBeGreaterThan(1)
  })
})

describe('personas', () => {
  it('every preset references valid sections', () => {
    const valid = new Set(ALL_REPORT_SECTIONS)
    for (const preset of REPORT_PRESETS) {
      expect(preset.sections.every((section) => valid.has(section))).toBe(true)
    }
  })
})

describe('executiveToMarkdown', () => {
  it('renders headings, metrics and tables', () => {
    const report = buildExecutiveReport(context({ incidents: [incident()] }))
    const markdown = executiveToMarkdown(report)
    expect(markdown).toContain('# NetScope Executive Report')
    expect(markdown).toContain('## Top incidents')
    expect(markdown).toContain(
      '| Severity | Title | Status | Duration | Devices |',
    )
    expect(markdown).toContain('**Fleet health:**')
  })
})

describe('executiveToHtml', () => {
  it('produces a self-contained document with inline styles and an svg', () => {
    const report = buildExecutiveReport(context())
    const html = executiveToHtml(report)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<style>')
    expect(html).toContain('<svg')
    expect(html).not.toContain('<script')
    expect(html).toContain('NetScope Executive Report')
  })

  it('escapes user-controlled content', () => {
    const incidents = [incident({ title: '<img src=x onerror=alert(1)>' })]
    const html = executiveToHtml(buildExecutiveReport(context({ incidents })))
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img src=x')
  })
})
