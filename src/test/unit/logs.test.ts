import { describe, expect, it } from 'vitest'
import type { Device, TimelineEvent } from '@/types'
import {
  FACILITY_LABELS,
  FACILITY_PROCESS,
  LOG_LEVELS,
  LOG_WINDOW_MS,
  MAX_LOG_ENTRIES,
  SEVERITY_LOG_LEVEL,
  fingerprintOf,
  generateLogs,
  isEmptyQuery,
  levelHistogram,
  logSummary,
  parseLogQuery,
  patternTemplate,
  queryLogs,
  topPatterns,
  topSources,
  trimLogs,
} from '@/lib/logs'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1_760_000_000_000
const SEED = 42

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: 'dev-1',
    name: 'rtr-hq-01',
    type: 'router',
    site: 'HQ - Floor 1',
    ip: '10.0.1.1',
    mac: '00:1a:2b:3c:4d:5e',
    status: 'online',
    tags: [],
    latencyMs: 8,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 120,
    capacityMbps: 1000,
    cpuPct: 34,
    memoryPct: 41,
    uptimeSec: 86_400,
    lastSeen: NOW,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    timestamp: NOW - 60_000,
    type: 'status',
    severity: 'medium',
    deviceId: 'dev-1',
    message: 'Device rtr-hq-01 degraded',
    ...overrides,
  }
}

const DEVICES: Device[] = [
  makeDevice(),
  makeDevice({ id: 'dev-2', name: 'fw-dc-01', type: 'firewall', site: 'DC-A' }),
  makeDevice({ id: 'dev-3', name: 'srv-app-01', type: 'server', site: 'DC-B' }),
  makeDevice({
    id: 'dev-4',
    name: 'ap-east-01',
    type: 'accessPoint',
    site: 'Branch - East',
    status: 'offline',
  }),
]

function makeLogs(
  overrides: Partial<{
    devices: Device[]
    events: TimelineEvent[]
    now: number
    seed: number
  }> = {},
) {
  return generateLogs({
    devices: overrides.devices ?? DEVICES,
    events: overrides.events ?? [],
    now: overrides.now ?? NOW,
    seed: overrides.seed ?? SEED,
  })
}

// ---------------------------------------------------------------------------
// patternTemplate / fingerprintOf
// ---------------------------------------------------------------------------

describe('patternTemplate', () => {
  it('normalises IPs, MACs, hex and numbers into stable tokens', () => {
    const template = patternTemplate(
      'Failed password from 10.2.3.4 mac 00:1a:2b:3c:4d:5e cpu 87% pid 0x1f',
    )
    expect(template).toContain('<IP>')
    expect(template).toContain('<MAC>')
    expect(template).toContain('<NUM>')
    expect(template).toContain('<HEX>')
    expect(template).not.toContain('10.2.3.4')
  })

  it('maps variant messages to the same fingerprint', () => {
    const a = fingerprintOf('BGP neighbor 10.0.1.1 state Established -> Idle')
    const b = fingerprintOf('BGP neighbor 10.9.7.2 state Established -> Idle')
    expect(a).toBe(b)
  })

  it('gives distinct templates distinct fingerprints', () => {
    const a = fingerprintOf('BGP neighbor 10.0.1.1 down')
    const b = fingerprintOf('DHCPACK on 10.0.1.9 to client')
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// generateLogs
// ---------------------------------------------------------------------------

describe('generateLogs', () => {
  it('is deterministic for identical inputs', () => {
    expect(makeLogs()).toEqual(makeLogs())
  })

  it('produces entries in ascending time order', () => {
    const logs = makeLogs({
      events: [makeEvent(), makeEvent({ id: 'evt-2', timestamp: NOW - 5_000 })],
    })
    for (let i = 1; i < logs.length; i += 1) {
      expect(logs[i]!.t).toBeGreaterThanOrEqual(logs[i - 1]!.t)
    }
  })

  it('keeps synthetic entries inside the tail window', () => {
    const logs = makeLogs()
    for (const entry of logs) {
      expect(entry.t).toBeLessThanOrEqual(NOW)
      expect(entry.t).toBeGreaterThanOrEqual(NOW - LOG_WINDOW_MS)
    }
  })

  it('emits a bounded tail not exceeding MAX_LOG_ENTRIES', () => {
    const devices = Array.from({ length: 60 }, (_, i) =>
      makeDevice({ id: `dev-${i}`, name: `host-${i}` }),
    )
    const logs = makeLogs({ devices })
    expect(logs.length).toBeLessThanOrEqual(MAX_LOG_ENTRIES)
    expect(logs.length).toBeGreaterThan(0)
  })

  it('maps every timeline event into a log line with its message', () => {
    const events = [
      makeEvent({
        id: 'evt-1',
        message: 'BGP session to edge reset',
        type: 'config',
      }),
      makeEvent({
        id: 'evt-2',
        message: 'Interface Gi0/1 down',
        type: 'incident',
      }),
    ]
    const logs = makeLogs({ events })
    const messages = new Set(logs.map((entry) => entry.message))
    expect(messages.has('BGP session to edge reset')).toBe(true)
    expect(messages.has('Interface Gi0/1 down')).toBe(true)
  })

  it('converts timeline severities into log levels', () => {
    const events = (['critical', 'high', 'medium', 'low'] as const).map(
      (severity, i) =>
        makeEvent({
          id: `evt-${i}`,
          severity,
          message: `sev event ${severity}`,
        }),
    )
    const logs = makeLogs({ events })
    for (const event of events) {
      const entry = logs.find((log) => log.message === event.message)
      expect(entry?.severity).toBe(SEVERITY_LOG_LEVEL[event.severity!])
    }
    expect(SEVERITY_LOG_LEVEL.critical).toBe('critical')
    expect(SEVERITY_LOG_LEVEL.high).toBe('error')
  })

  it('tags every entry with a valid level, facility, process and fingerprint', () => {
    for (const entry of makeLogs()) {
      expect(LOG_LEVELS).toContain(entry.severity)
      expect(Object.keys(FACILITY_LABELS)).toContain(entry.facility)
      expect(entry.process).toBe(FACILITY_PROCESS[entry.facility])
      expect(entry.fingerprint.length).toBeGreaterThan(0)
      expect(entry.id.length).toBeGreaterThan(0)
    }
  })

  it('resolves device name and site from the event device id', () => {
    const logs = makeLogs({
      events: [makeEvent({ deviceId: 'dev-2', type: 'device' })],
    })
    const entry = logs.find((log) => log.id === 'log-evt-evt-1')
    expect(entry?.deviceName).toBe('fw-dc-01')
    expect(entry?.site).toBe('DC-A')
  })

  it('falls back to control plane identity for device-less events', () => {
    const logs = makeLogs({
      events: [makeEvent({ deviceId: undefined, type: 'status' })],
    })
    const entry = logs.find((log) => log.id === 'log-evt-evt-1')
    expect(entry?.deviceId).toBeNull()
    expect(entry?.deviceName).toBe('netscope')
    expect(entry?.site).toBe('control')
  })

  it('spreads offline device lines into the first half of the window only', () => {
    const logs = makeLogs({
      devices: [
        makeDevice({ id: 'dev-off', name: 'ap-down', status: 'offline' }),
      ],
    })
    const offline = logs.filter((entry) => entry.deviceId === 'dev-off')
    expect(offline.length).toBeGreaterThan(0)
    for (const entry of offline) {
      expect(entry.t).toBeGreaterThanOrEqual(NOW - LOG_WINDOW_MS / 2)
    }
  })

  it('logs both routers and servers with device-type facilities', () => {
    const logs = makeLogs()
    const facilities = new Set(logs.map((entry) => entry.facility))
    expect(facilities.has('bgp') || facilities.has('ospf')).toBe(true)
    expect(
      facilities.has('auth') || facilities.has('ssl') || facilities.has('dhcp'),
    ).toBe(true)
  })

  it('returns an empty tail for an empty fleet', () => {
    expect(makeLogs({ devices: [] })).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// trimLogs
// ---------------------------------------------------------------------------

describe('trimLogs', () => {
  it('keeps short lists untouched', () => {
    const logs = makeLogs()
    expect(trimLogs(logs, MAX_LOG_ENTRIES)).toBe(logs)
  })

  it('caps long lists to the newest entries', () => {
    const logs = makeLogs({ devices: DEVICES })
    const capped = trimLogs(logs, 5)
    expect(capped).toHaveLength(5)
    expect(capped).toEqual(logs.slice(-5))
  })
})

// ---------------------------------------------------------------------------
// Patterns / sources / summary
// ---------------------------------------------------------------------------

describe('topPatterns', () => {
  it('clusters variants under one template and sorts by volume', () => {
    const logs = makeLogs()
    const patterns = topPatterns(logs, 5)
    expect(patterns.length).toBeGreaterThan(0)
    const total = patterns.reduce((sum, pattern) => sum + pattern.count, 0)
    expect(total).toBeGreaterThanOrEqual(patterns.length)
    for (let i = 1; i < patterns.length; i += 1) {
      expect(patterns[i]!.count).toBeLessThanOrEqual(patterns[i - 1]!.count)
    }
    expect(patterns[0]!.template).toMatch(/<IP>|<NUM>|<MAC>|<HEX>|./)
  })

  it('tracks the highest severity and last-seen time per pattern', () => {
    const logs = [
      {
        id: 'a',
        t: 100,
        deviceId: 'd',
        deviceName: 'd',
        site: 's',
        facility: 'bgp' as const,
        process: 'bgpd',
        severity: 'notice' as const,
        message: 'BGP neighbor 10.0.0.1 down',
        fingerprint: 'fp1',
      },
      {
        id: 'b',
        t: 400,
        deviceId: 'd',
        deviceName: 'd',
        site: 's',
        facility: 'bgp' as const,
        process: 'bgpd',
        severity: 'critical' as const,
        message: 'BGP neighbor 10.0.0.9 down',
        fingerprint: 'fp1',
      },
    ]
    const [pattern] = topPatterns(logs)
    expect(pattern).toMatchObject({
      count: 2,
      severity: 'critical',
      lastSeen: 400,
    })
  })

  it('returns an empty list for no entries', () => {
    expect(topPatterns([])).toEqual([])
  })
})

describe('topSources', () => {
  it('ranks the busiest producers', () => {
    const sources = topSources(makeLogs())
    expect(sources.length).toBeGreaterThan(0)
    for (let i = 1; i < sources.length; i += 1) {
      expect(sources[i]!.count).toBeLessThanOrEqual(sources[i - 1]!.count)
    }
    expect(sources[0]!.count).toBeGreaterThanOrEqual(
      sources[sources.length - 1]!.count,
    )
  })
})

describe('logSummary', () => {
  it('counts levels, facilities and errors consistently', () => {
    const logs = makeLogs()
    const summary = logSummary(logs)
    expect(summary.total).toBe(logs.length)
    const levelSum = LOG_LEVELS.reduce(
      (sum, level) => sum + summary.byLevel[level],
      0,
    )
    expect(levelSum).toBe(logs.length)
    const facilitySum = Object.values(summary.byFacility).reduce(
      (a, b) => a + b,
      0,
    )
    expect(facilitySum).toBe(logs.length)
    expect(summary.errorCount).toBe(
      summary.byLevel.error + summary.byLevel.critical,
    )
    expect(summary.errorRatio).toBeGreaterThanOrEqual(0)
    expect(summary.errorRatio).toBeLessThanOrEqual(1)
    expect(summary.windowFrom).toBeLessThanOrEqual(summary.windowTo)
  })

  it('is zero-safe on empty input', () => {
    const summary = logSummary([])
    expect(summary).toMatchObject({ total: 0, errorRatio: 0, errorCount: 0 })
    expect(summary.windowFrom).toBe(0)
  })
})

describe('levelHistogram', () => {
  it('aligns buckets and preserves counts inside the window', () => {
    const logs = makeLogs()
    const from = NOW - LOG_WINDOW_MS
    const buckets = levelHistogram(logs, from, NOW, 5 * 60_000)
    expect(buckets).toHaveLength(6)
    expect(buckets[0]!.t).toBe(from)
    const bucketTotal = buckets.reduce((sum, bucket) => sum + bucket.total, 0)
    const inWindow = logs.filter((entry) => entry.t >= from && entry.t < NOW)
    expect(bucketTotal).toBe(inWindow.length)
    for (const bucket of buckets) {
      const sum = LOG_LEVELS.reduce(
        (acc, level) => acc + bucket.counts[level],
        0,
      )
      expect(sum).toBe(bucket.total)
    }
  })

  it('rejects invalid ranges and non-positive buckets', () => {
    expect(levelHistogram([], NOW, NOW, 1000)).toEqual([])
    expect(levelHistogram([], NOW, NOW + 1000, 0)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

describe('parseLogQuery', () => {
  it('parses level aliases and field clauses', () => {
    const query = parseLogQuery('level:err facility:bgp site:hq')
    expect(query.levels).toEqual(['error'])
    expect(query.facility).toBe('bgp')
    expect(query.site).toBe('hq')
    expect(query.text).toBeNull()
  })

  it('collects unknown tokens into free text', () => {
    const query = parseLogQuery('neighbor reset timeout')
    expect(query.text).toBe('neighbor reset timeout')
    expect(query.levels).toEqual([])
    expect(isEmptyQuery(query)).toBe(false)
  })

  it('keeps device filters and dedupes repeated levels', () => {
    const query = parseLogQuery('device:rtr level:warn level:warn')
    expect(query.deviceId).toBe('rtr')
    expect(query.levels).toEqual(['warning'])
  })

  it('treats an empty string as an empty query', () => {
    expect(isEmptyQuery(parseLogQuery('   '))).toBe(true)
  })

  it('ignores unknown facility values', () => {
    const query = parseLogQuery('facility:telepathy')
    expect(query.facility).toBeNull()
    expect(query.text).toBe('facility:telepathy')
  })
})

describe('queryLogs', () => {
  const logs = makeLogs()

  it('returns everything for an empty query', () => {
    expect(queryLogs(logs, parseLogQuery(''))).toBe(logs)
  })

  it('filters by level', () => {
    const result = queryLogs(logs, parseLogQuery('level:error'))
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result) expect(entry.severity).toBe('error')
  })

  it('filters by site substring (case-insensitive)', () => {
    const result = queryLogs(logs, parseLogQuery('site:hq'))
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result) expect(entry.site.toLowerCase()).toContain('hq')
  })

  it('filters by free text against the message', () => {
    const result = queryLogs(logs, parseLogQuery('BGP'))
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result) expect(entry.message).toContain('BGP')
  })

  it('combines facility and free text clauses', () => {
    const result = queryLogs(logs, parseLogQuery('facility:bgp BGP'))
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result) {
      expect(entry.facility).toBe('bgp')
      expect(entry.message).toContain('BGP')
    }
  })

  it('filters by device name fragment', () => {
    const result = queryLogs(logs, parseLogQuery('device:rtr-hq'))
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result)
      expect(entry.deviceName.toLowerCase()).toContain('rtr-hq')
  })
})
