import { describe, expect, it } from 'vitest'
import type { AlertInstance } from '@/lib/alerts'
import type { Device } from '@/types'
import {
  CORRELATION_WINDOW_MS,
  SIGNAL_LABELS,
  correlate,
  correlationSummary,
  withAcknowledged,
  type CorrelateInput,
} from '@/lib/correlation'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = 1_760_000_000_000

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: 'dev-1',
    name: 'rtr-alpha-01',
    type: 'router',
    site: 'Site Alpha',
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

/** A, B/C (same site, B is its hub), D (own site). */
const DEVICES: Device[] = [
  makeDevice({
    id: 'dev-a',
    name: 'rtr-alpha-01',
    type: 'router',
    site: 'Site Alpha',
  }),
  makeDevice({
    id: 'dev-b',
    name: 'fw-beta-01',
    type: 'firewall',
    site: 'Site Beta',
  }),
  makeDevice({
    id: 'dev-c',
    name: 'srv-beta-01',
    type: 'server',
    site: 'Site Beta',
  }),
  makeDevice({
    id: 'dev-d',
    name: 'sw-gamma-01',
    type: 'switch',
    site: 'Site Gamma',
  }),
]

function makeAlert(
  overrides: Partial<AlertInstance> & { id: string; deviceId: string },
): AlertInstance {
  return {
    ruleId: 'rule-1',
    ruleName: 'High CPU',
    deviceName: overrides.deviceId,
    severity: 'high',
    status: 'firing',
    startedAt: NOW,
    firedAt: NOW,
    value: 92,
    ...overrides,
  }
}

type TestIncident = CorrelateInput['incidents'][number]

function makeIncident(
  overrides: Partial<TestIncident> & { id: string; deviceIds: string[] },
): TestIncident {
  return {
    title: 'Incident',
    severity: 'high',
    status: 'open',
    createdAt: NOW,
    ...overrides,
  }
}

function run(
  alerts: AlertInstance[] = [],
  incidents: TestIncident[] = [],
  services: CorrelateInput['services'] = [],
  devices: Device[] = DEVICES,
  now = NOW,
) {
  return correlate({ devices, alerts, incidents, services, now })
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

describe('correlate inputs', () => {
  it('excludes pending alerts and resolved incidents', () => {
    const result = run(
      [
        makeAlert({
          id: 'a1',
          deviceId: 'dev-a',
          status: 'pending',
          firedAt: null,
        }),
        makeAlert({ id: 'a2', deviceId: 'dev-a' }),
      ],
      [
        makeIncident({ id: 'i1', deviceIds: ['dev-a'], status: 'resolved' }),
        makeIncident({ id: 'i2', deviceIds: ['dev-a'] }),
      ],
    )
    expect(result.inputs).toBe(2)
  })

  it('is zero-safe with no signals', () => {
    expect(run()).toEqual({ problems: [], singles: [], inputs: 0 })
    expect(correlationSummary(run())).toMatchObject({
      inputs: 0,
      problems: 0,
      singles: 0,
      reductionPct: 0,
      absorbedPct: 0,
      meanMembers: 0,
    })
  })

  it('is deterministic for identical inputs', () => {
    const alerts = [
      makeAlert({ id: 'a1', deviceId: 'dev-a' }),
      makeAlert({ id: 'a2', deviceId: 'dev-a', firedAt: NOW - 60_000 }),
    ]
    expect(run(alerts)).toEqual(run(alerts))
  })
})

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

describe('grouping signals', () => {
  it('groups alerts on the same device inside the window', () => {
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a', deviceName: 'rtr-alpha-01' }),
      makeAlert({
        id: 'a2',
        deviceId: 'dev-a',
        deviceName: 'rtr-alpha-01',
        ruleName: 'Packet loss',
        firedAt: NOW - 90_000,
      }),
    ])
    expect(result.problems).toHaveLength(1)
    expect(result.singles).toHaveLength(0)
    const [problem] = result.problems
    expect(problem!.kind).toBe('device')
    expect(problem!.signals).toEqual(['device'])
    expect(problem!.members).toHaveLength(2)
    expect(problem!.title).toContain('rtr-alpha-01')
    expect(problem!.rootCause).toMatchObject({
      deviceId: 'dev-a',
      deviceName: 'rtr-alpha-01',
      score: 1,
    })
  })

  it('keeps same-device alerts outside the window apart', () => {
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a' }),
      makeAlert({
        id: 'a2',
        deviceId: 'dev-a',
        firedAt: NOW - CORRELATION_WINDOW_MS - 1,
      }),
    ])
    expect(result.problems).toHaveLength(0)
    expect(result.singles).toHaveLength(2)
  })

  it('groups distinct sites through the derived topology within 2 hops', () => {
    // dev-a (core) ↔ dev-b (Site Beta hub) = 1 hop, different sites.
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a', deviceName: 'rtr-alpha-01' }),
      makeAlert({ id: 'a2', deviceId: 'dev-b', deviceName: 'fw-beta-01' }),
    ])
    expect(result.problems).toHaveLength(1)
    const [problem] = result.problems
    expect(problem!.signals).toContain('topology')
    expect(problem!.kind).toBe('topology')
    expect(problem!.deviceIds.sort()).toEqual(['dev-a', 'dev-b'])
    expect(problem!.rootCause).not.toBeNull()
    expect(problem!.rootCause!.evidence.length).toBeGreaterThan(0)
    expect(problem!.site).toBeNull()
  })

  it('records the site signal when members share a site', () => {
    // dev-b and dev-c are both at Site Beta (the star topology keeps them
    // within 2 hops, so topology co-occurs — site must still be recorded).
    const result = run(
      [makeAlert({ id: 'a1', deviceId: 'dev-b', deviceName: 'fw-beta-01' })],
      [makeIncident({ id: 'i1', deviceIds: ['dev-c'], title: 'Site issue' })],
    )
    expect(result.problems).toHaveLength(1)
    const [problem] = result.problems
    expect(problem!.signals).toContain('site')
    expect(problem!.signals).toContain('topology')
    expect(problem!.site).toBe('Site Beta')
    expect(problem!.deviceIds.sort()).toEqual(['dev-b', 'dev-c'])
  })

  it('groups members that share an explicit business service', () => {
    const services: NonNullable<CorrelateInput['services']> = [
      {
        id: 'svc-1',
        name: 'Checkout',
        description: 'Checkout and payment flow',
        tier: 'p1',
        impact: 'revenue',
        deviceIds: ['dev-c', 'dev-d'],
        siteNames: [],
      },
    ]
    const result = run(
      [
        makeAlert({ id: 'a1', deviceId: 'dev-c', deviceName: 'srv-beta-01' }),
        makeAlert({ id: 'a2', deviceId: 'dev-d', deviceName: 'sw-gamma-01' }),
      ],
      [],
      services,
    )
    expect(result.problems).toHaveLength(1)
    const [problem] = result.problems
    expect(problem!.signals).toEqual(['service'])
    expect(problem!.kind).toBe('service')
  })

  it('leaves unrelated devices as singles', () => {
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-c' }),
      makeAlert({ id: 'a2', deviceId: 'dev-d' }),
    ])
    expect(result.problems).toHaveLength(0)
    expect(result.singles).toHaveLength(2)
  })

  it('transitively unions chains of signals', () => {
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-b', deviceName: 'fw-beta-01' }),
      makeAlert({
        id: 'a2',
        deviceId: 'dev-b',
        ruleName: 'Latency',
        deviceName: 'fw-beta-01',
      }),
      makeAlert({
        id: 'a3',
        deviceId: 'dev-c',
        ruleName: 'Disk',
        deviceName: 'srv-beta-01',
      }),
    ])
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]!.members).toHaveLength(3)
    expect(result.problems[0]!.deviceIds.sort()).toEqual(['dev-b', 'dev-c'])
  })
})

// ---------------------------------------------------------------------------
// Problem shape
// ---------------------------------------------------------------------------

describe('problem shape', () => {
  it('takes the worst severity and earliest start', () => {
    const result = run([
      makeAlert({
        id: 'a1',
        deviceId: 'dev-a',
        severity: 'low',
        firedAt: NOW - 120_000,
      }),
      makeAlert({
        id: 'a2',
        deviceId: 'dev-a',
        severity: 'critical',
        firedAt: NOW - 30_000,
      }),
    ])
    const [problem] = result.problems
    expect(problem!.severity).toBe('critical')
    expect(problem!.startedAt).toBe(NOW - 120_000)
    expect(problem!.members[0]!.severity).toBe('critical')
  })

  it('produces stable ids that differ across member sets', () => {
    const first = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a' }),
      makeAlert({ id: 'a2', deviceId: 'dev-a' }),
    ])
    const again = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a' }),
      makeAlert({ id: 'a2', deviceId: 'dev-a' }),
    ])
    const other = run([
      makeAlert({ id: 'a1', deviceId: 'dev-b' }),
      makeAlert({ id: 'a2', deviceId: 'dev-b' }),
    ])
    expect(first.problems[0]!.id).toBe(again.problems[0]!.id)
    expect(first.problems[0]!.id).not.toBe(other.problems[0]!.id)
    expect(first.problems[0]!.id.startsWith('prob_')).toBe(true)
  })

  it('raises confidence with more members and signals', () => {
    const two = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a' }),
      makeAlert({ id: 'a2', deviceId: 'dev-a' }),
    ])
    const three = run([
      makeAlert({ id: 'a1', deviceId: 'dev-b' }),
      makeAlert({ id: 'a2', deviceId: 'dev-b' }),
      makeAlert({ id: 'a3', deviceId: 'dev-c' }),
    ])
    const low = two.problems[0]!.confidence
    const high = three.problems[0]!.confidence
    expect(low).toBeGreaterThanOrEqual(0)
    expect(low).toBeLessThanOrEqual(1)
    expect(high).toBeGreaterThanOrEqual(low)
    expect(three.problems[0]!.signals.length).toBeGreaterThanOrEqual(
      two.problems[0]!.signals.length,
    )
  })

  it('sorts problems by severity then member count', () => {
    // Two groups separated in time so topology cannot bridge them.
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a', severity: 'medium' }),
      makeAlert({ id: 'a2', deviceId: 'dev-a', severity: 'medium' }),
      makeAlert({
        id: 'a3',
        deviceId: 'dev-b',
        severity: 'critical',
        firedAt: NOW - 20 * 60_000,
      }),
      makeAlert({
        id: 'a4',
        deviceId: 'dev-b',
        severity: 'critical',
        firedAt: NOW - 20 * 60_000,
      }),
      makeAlert({
        id: 'a5',
        deviceId: 'dev-c',
        severity: 'critical',
        firedAt: NOW - 20 * 60_000,
      }),
    ])
    const severities = result.problems.map((problem) => problem.severity)
    expect(severities).toEqual(['critical', 'medium'])
    expect(result.problems[0]!.members).toHaveLength(3)
    expect(result.problems[1]!.members).toHaveLength(2)
  })

  it('labels every signal kind', () => {
    for (const kind of ['device', 'topology', 'site', 'service'] as const) {
      expect(SIGNAL_LABELS[kind].length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('correlationSummary', () => {
  it('measures reduction over grouped inputs', () => {
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-b' }),
      makeAlert({ id: 'a2', deviceId: 'dev-b' }),
      makeAlert({ id: 'a3', deviceId: 'dev-c' }),
      // Far outside the window: stays an uncorrelated single.
      makeAlert({ id: 'a4', deviceId: 'dev-a', firedAt: NOW - 20 * 60_000 }),
    ])
    const summary = correlationSummary(result)
    expect(summary.inputs).toBe(4)
    expect(summary.problems).toBe(1)
    expect(summary.singles).toBe(1)
    expect(summary.grouped).toBe(3)
    expect(summary.reductionPct).toBe(75)
    expect(summary.absorbedPct).toBe(75)
    expect(summary.meanMembers).toBe(3)
    expect(summary.signalCounts.device).toBe(1)
  })

  it('reports zero reduction when nothing grouped', () => {
    const summary = correlationSummary(
      run([
        makeAlert({ id: 'a1', deviceId: 'dev-c' }),
        makeAlert({ id: 'a2', deviceId: 'dev-d' }),
      ]),
    )
    expect(summary.problems).toBe(0)
    expect(summary.reductionPct).toBe(0)
    expect(summary.absorbedPct).toBe(0)
    expect(summary.critical).toBe(0)
  })

  it('counts critical problems separately', () => {
    const summary = correlationSummary(
      run([
        makeAlert({ id: 'a1', deviceId: 'dev-a', severity: 'critical' }),
        makeAlert({ id: 'a2', deviceId: 'dev-a', severity: 'low' }),
      ]),
    )
    expect(summary.critical).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Acknowledgements
// ---------------------------------------------------------------------------

describe('withAcknowledged', () => {
  it('overlays ack timestamps without mutating problems', () => {
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-a' }),
      makeAlert({ id: 'a2', deviceId: 'dev-a' }),
    ])
    const [problem] = result.problems
    const acked = withAcknowledged(result.problems, { [problem!.id]: 42 })
    expect(acked[0]!.acknowledgedAt).toBe(42)
    expect('acknowledgedAt' in problem!).toBe(false)
    expect(withAcknowledged(result.problems, {})[0]!.acknowledgedAt).toBeNull()
  })

  it('sorts singles like problems by severity', () => {
    // dev-c (Beta) ↔ dev-d (Gamma) is 3 hops — far enough to stay uncorrelated.
    const result = run([
      makeAlert({ id: 'a1', deviceId: 'dev-c', severity: 'low' }),
      makeAlert({ id: 'a2', deviceId: 'dev-d', severity: 'critical' }),
    ])
    expect(result.problems).toHaveLength(0)
    expect(result.singles).toHaveLength(2)
    expect(result.singles[0]!.severity).toBe('critical')
  })
})
