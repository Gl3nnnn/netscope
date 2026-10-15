import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import type { BusinessService } from '@/lib/services'
import {
  BACKUP_KIND_LABELS,
  RPO_TARGET_HRS,
  RTO_TARGET_HRS,
  recoveryFindings,
  recoverySummary,
  restoreTestsFor,
  runDrill,
  runRecovery,
  seedJobs,
  tierForDevice,
  withJobResults,
  type BackupJob,
} from '@/lib/recovery'

const SEED = 11

function makeDevice(overrides: Partial<Device> & { id: string }): Device {
  return {
    name: overrides.id,
    type: 'server',
    site: 'HQ - Floor 1',
    ip: '10.0.0.1',
    mac: '00:00:00:00:00:00',
    status: 'online',
    tags: [],
    latencyMs: 8,
    packetLossPct: 0,
    availabilityPct: 99.9,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 30,
    memoryPct: 45,
    uptimeSec: 900_000,
    lastSeen: 0,
    ...overrides,
  }
}

const DEVICES: Device[] = [
  makeDevice({ id: 'r1', name: 'r1', type: 'router' }),
  makeDevice({ id: 'fw1', name: 'fw1', type: 'firewall' }),
  makeDevice({ id: 'srv1', name: 'srv1', site: 'Data Center A' }),
  makeDevice({ id: 'srv2', name: 'srv2', site: 'Branch - West' }),
  makeDevice({ id: 'sw1', name: 'sw1', type: 'switch', site: 'Branch - West' }),
]

const SERVICES: BusinessService[] = [
  {
    id: 'svc-p1',
    name: 'Checkout',
    description: 'Checkout flow',
    tier: 'p1',
    impact: 'revenue',
    deviceIds: ['srv1', 'r1'],
    siteNames: [],
  },
  {
    id: 'svc-p3',
    name: 'Wiki',
    description: 'Internal wiki',
    tier: 'p3',
    impact: 'internal',
    deviceIds: ['srv2'],
    siteNames: [],
  },
]

// ---------------------------------------------------------------------------
// Tier & seeding
// ---------------------------------------------------------------------------

describe('tierForDevice', () => {
  it('returns the lowest (most critical) tier among owning services', () => {
    expect(tierForDevice('srv1', SERVICES)).toBe('p1')
    expect(tierForDevice('srv2', SERVICES)).toBe('p3')
  })

  it('defaults to p4 for unowned devices', () => {
    expect(tierForDevice('unknown', SERVICES)).toBe('p4')
    expect(tierForDevice('r1', [])).toBe('p4')
  })
})

describe('seedJobs', () => {
  it('creates one job per device with unique ids and kind-appropriate RPOs', () => {
    const jobs = seedJobs(DEVICES, SERVICES, SEED)
    expect(jobs).toHaveLength(DEVICES.length)
    const ids = new Set(jobs.map((job) => job.id))
    expect(ids.size).toBe(jobs.length)
    for (const job of jobs) {
      expect(BACKUP_KIND_LABELS[job.kind]).toBeTruthy()
      expect(job.targetRpoHrs).toBe(RPO_TARGET_HRS[job.kind])
      expect(job.sizeGb).toBeGreaterThanOrEqual(1)
      expect(job.storageMonthlyUsd).toBeGreaterThan(0)
    }
  })

  it('backs up config on network gear and data/app/image on servers', () => {
    const jobs = seedJobs(DEVICES, SERVICES, SEED)
    const kindOf = (id: string) => jobs.find((job) => job.deviceId === id)!.kind
    expect(kindOf('r1')).toBe('config')
    expect(kindOf('fw1')).toBe('config')
    expect(kindOf('sw1')).toBe('config')
    expect(['database', 'app', 'image']).toContain(kindOf('srv1'))
  })

  it('derives retention from the device tier', () => {
    const jobs = seedJobs(DEVICES, SERVICES, SEED)
    const retentionOf = (id: string) =>
      jobs.find((job) => job.deviceId === id)!.retentionDays
    expect(retentionOf('srv1')).toBe(35)
    expect(retentionOf('srv2')).toBeGreaterThanOrEqual(7)
    expect(retentionOf('r1')).toBe(35)
  })
})

// ---------------------------------------------------------------------------
// Tick simulation
// ---------------------------------------------------------------------------

describe('withJobResults', () => {
  const jobs = seedJobs(DEVICES, SERVICES, SEED)

  it('is deterministic for the same tick and seed', () => {
    const a = withJobResults(jobs, SEED, 3)
    const b = withJobResults(jobs, SEED, 3)
    expect(a).toEqual(b)
  })

  it('changes across ticks and keeps statuses in the enum', () => {
    const at3 = withJobResults(jobs, SEED, 3)
    const at9 = withJobResults(jobs, SEED, 9)
    const statuses = new Set(at3.map((job) => job.status))
    for (const status of statuses) {
      expect(['ok', 'warning', 'failed', 'stale']).toContain(status)
    }
    expect(JSON.stringify(at3)).not.toBe(JSON.stringify(at9))
  })

  it('keeps ok jobs within their RPO and stale jobs well past it', () => {
    const results = withJobResults(jobs, SEED, 5)
    for (const job of results) {
      if (job.status === 'ok') {
        expect(job.actualRpoHrs).toBeLessThanOrEqual(job.targetRpoHrs)
      }
      if (job.status === 'stale') {
        expect(job.lastRunHoursAgo).toBeGreaterThan(48)
      }
      expect(job.successRatePct).toBeGreaterThanOrEqual(0)
      expect(job.successRatePct).toBeLessThanOrEqual(100)
    }
  })

  it('applies operator overrides last', () => {
    const target = jobs[0]!
    const results = withJobResults(jobs, SEED, 2, {
      [target.id]: { status: 'failed' },
    })
    expect(results.find((job) => job.id === target.id)!.status).toBe('failed')
  })
})

describe('restoreTestsFor', () => {
  const jobs = seedJobs(DEVICES, SERVICES, SEED)

  it('is deterministic and targets RTO by tier', () => {
    const a = restoreTestsFor(jobs, SEED, 4)
    const b = restoreTestsFor(jobs, SEED, 4)
    expect(a).toEqual(b)
    for (const test of a) {
      expect(test.targetRtoHrs).toBe(RTO_TARGET_HRS[test.tier])
      expect(['pass', 'fail']).toContain(test.result)
      if (test.result === 'pass') {
        expect(test.actualRtoHrs).toBeLessThanOrEqual(test.targetRtoHrs)
      } else {
        expect(test.actualRtoHrs).toBeGreaterThan(test.targetRtoHrs)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Drill, findings, summary
// ---------------------------------------------------------------------------

describe('runDrill', () => {
  it('scopes to P1/P2 jobs and reports RTO breaches', () => {
    const jobs = seedJobs(DEVICES, SERVICES, SEED)
    const tests = restoreTestsFor(jobs, SEED, 6)
    const record = runDrill(jobs, tests, 6)
    const critical = jobs.filter(
      (job) => job.tier === 'p1' || job.tier === 'p2',
    )
    expect(record.jobsTested).toBe(critical.length)
    expect(record.jobsPassed + record.rtoBreaches).toBe(record.jobsTested)
    expect(record.id).toBe('drill-6')
    expect(record.note.length).toBeGreaterThan(0)
  })
})

describe('recoveryFindings', () => {
  it('flags failed, stale, RPO-miss and RTO-miss jobs', () => {
    const jobs: BackupJob[] = [
      {
        id: 'bk-failed',
        deviceId: 'd1',
        deviceName: 'd1',
        site: 'HQ',
        kind: 'database',
        tier: 'p1',
        targetRpoHrs: 1,
        lastRunHoursAgo: 30,
        actualRpoHrs: 30,
        status: 'failed',
        sizeGb: 50,
        retentionDays: 35,
        storageMonthlyUsd: 1,
        successRatePct: 70,
      },
      {
        id: 'bk-stale',
        deviceId: 'd2',
        deviceName: 'd2',
        site: 'HQ',
        kind: 'config',
        tier: 'p3',
        targetRpoHrs: 24,
        lastRunHoursAgo: 72,
        actualRpoHrs: 72,
        status: 'stale',
        sizeGb: 2,
        retentionDays: 14,
        storageMonthlyUsd: 0.1,
        successRatePct: 80,
      },
      {
        id: 'bk-ok',
        deviceId: 'd3',
        deviceName: 'd3',
        site: 'HQ',
        kind: 'config',
        tier: 'p4',
        targetRpoHrs: 24,
        lastRunHoursAgo: 4,
        actualRpoHrs: 4,
        status: 'ok',
        sizeGb: 2,
        retentionDays: 7,
        storageMonthlyUsd: 0.1,
        successRatePct: 99,
      },
    ]
    const tests = [
      {
        id: 'rt-bk-ok',
        jobId: 'bk-ok',
        jobName: 'ok',
        deviceId: 'd3',
        deviceName: 'd3',
        tier: 'p4' as const,
        targetRtoHrs: 48,
        actualRtoHrs: 60,
        result: 'fail' as const,
        testedHoursAgo: 12,
      },
    ]
    const findings = recoveryFindings(jobs, tests)
    const kinds = findings.map((finding) => finding.kind).sort()
    expect(kinds).toEqual([
      'failed-backup',
      'rpo-miss',
      'rpo-miss',
      'rto-miss',
      'stale-backup',
    ])
    // Failed P1 backup is critical; stale p3 is medium; rto miss on p4 is high.
    const byKind = Object.fromEntries(
      findings.map((finding) => [finding.kind, finding.severity]),
    )
    expect(byKind['failed-backup']).toBe('critical')
    expect(byKind['stale-backup']).toBe('medium')
    expect(byKind['rto-miss']).toBe('high')
    // Healthy job with no failing test emits nothing extra.
    expect(
      findings.filter((finding) => finding.jobId === 'bk-ok'),
    ).toHaveLength(1)
  })
})

describe('recoverySummary', () => {
  it('partitions jobs and totals cost', () => {
    const jobs = seedJobs(DEVICES, SERVICES, SEED)
    const tests = restoreTestsFor(jobs, SEED, 7)
    const summary = recoverySummary(jobs, tests)
    expect(summary.jobs).toBe(jobs.length)
    expect(summary.ok + summary.warning + summary.failed + summary.stale).toBe(
      jobs.length,
    )
    expect(summary.restoreTests).toBe(tests.length)
    expect(summary.restorePassed + summary.rtoBreaches).toBe(tests.length)
    expect(summary.monthlyCostUsd).toBeGreaterThanOrEqual(0)
    expect(summary.avgSuccessPct).toBeGreaterThan(0)
  })

  it('returns a safe empty summary', () => {
    const summary = recoverySummary([], [])
    expect(summary.jobs).toBe(0)
    expect(summary.avgSuccessPct).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

describe('runRecovery', () => {
  it('wires jobs, tests, findings and summary deterministically', () => {
    const a = runRecovery(DEVICES, SERVICES, SEED, 8)
    const b = runRecovery(DEVICES, SERVICES, SEED, 8)
    expect(a).toEqual(b)
    expect(a.jobs).toHaveLength(DEVICES.length)
    expect(a.tests).toHaveLength(a.jobs.length)
    expect(a.summary.jobs).toBe(a.jobs.length)
    expect(a.summary.monthlyCostUsd).toBe(1.29)
    expect(a.summary.restorePassed).toBe(2)
    expect(a.summary.rtoBreaches).toBe(3)
    expect(a.findings).toHaveLength(3)
    for (const finding of a.findings) {
      expect(finding.kind).toBe('rto-miss')
    }
  })

  it('is safe with an empty fleet', () => {
    const result = runRecovery([], [], SEED, 1)
    expect(result.jobs).toEqual([])
    expect(result.summary.jobs).toBe(0)
  })
})
