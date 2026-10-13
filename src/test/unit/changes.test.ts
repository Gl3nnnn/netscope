import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import type { BusinessService } from '@/lib/services'
import type { DriftSummary } from '@/lib/configs'
import {
  assessRisk,
  canTransition,
  changeSummary,
  changeWindowState,
  findChangeConflicts,
  isChangeOverdue,
  nextChangeStatuses,
  pendingApprovals,
  transitionChange,
  verifyChange,
  type ChangeRequest,
} from '@/lib/changes'

function device(id: string, site = 'HQ'): Device {
  return {
    id,
    name: `dev-${id}`,
    type: 'server',
    site,
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 10,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 30,
    memoryPct: 40,
    uptimeSec: 1000,
    lastSeen: 0,
  }
}

function change(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: 'chg-1',
    title: 'Upgrade core',
    description: '',
    type: 'normal',
    status: 'draft',
    deviceIds: ['1'],
    siteNames: [],
    plannedStart: 1_000,
    plannedEnd: 2_000,
    requestedBy: 'alice',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function service(overrides: Partial<BusinessService> = {}): BusinessService {
  return {
    id: 'svc-1',
    name: 'Payments',
    description: '',
    tier: 'p1',
    impact: 'revenue',
    deviceIds: ['1'],
    siteNames: [],
    ...overrides,
  }
}

describe('canTransition', () => {
  it('allows valid workflow moves and blocks invalid ones', () => {
    expect(canTransition('draft', 'review')).toBe(true)
    expect(canTransition('review', 'approved')).toBe(true)
    expect(canTransition('draft', 'closed')).toBe(false)
    expect(canTransition('closed', 'draft')).toBe(false)
  })

  it('treats closed/rejected/cancelled/rolled-back as terminal', () => {
    expect(nextChangeStatuses('closed')).toEqual([])
    expect(nextChangeStatuses('rejected')).toEqual([])
    expect(nextChangeStatuses('implementing')).toEqual([
      'verifying',
      'rolled-back',
    ])
  })
})

describe('transitionChange', () => {
  it('applies an allowed transition and records the approver', () => {
    const result = transitionChange(change({ status: 'review' }), 'approved', {
      now: 500,
      actor: 'carol',
    })
    expect(result.ok).toBe(true)
    expect(result.change.status).toBe('approved')
    expect(result.change.approver).toBe('carol')
    expect(result.change.updatedAt).toBe(500)
  })

  it('refuses an illegal transition with a reason', () => {
    const result = transitionChange(change({ status: 'draft' }), 'closed', {
      now: 500,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('Cannot move')
    expect(result.change.status).toBe('draft')
  })
})

describe('assessRisk', () => {
  it('rates a broad emergency touching a P1 service as high', () => {
    const devices = [
      device('1'),
      device('2'),
      device('3'),
      device('4'),
      device('5'),
    ]
    const assessment = assessRisk({
      change: change({
        type: 'emergency',
        deviceIds: ['1', '2', '3', '4', '5'],
      }),
      devices,
      services: [service()],
    })
    expect(assessment.level).toBe('high')
    expect(assessment.reasons.length).toBeGreaterThan(0)
  })

  it('rates a single standard device change as low', () => {
    const assessment = assessRisk({
      change: change({ type: 'standard', deviceIds: ['1'] }),
      devices: [device('1')],
      services: [],
    })
    expect(assessment.level).toBe('low')
  })
})

describe('changeWindowState', () => {
  it('tracks upcoming, active and elapsed windows', () => {
    expect(changeWindowState(change(), 500)).toBe('upcoming')
    expect(changeWindowState(change(), 1_500)).toBe('active')
    expect(changeWindowState(change(), 2_500)).toBe('elapsed')
  })
})

describe('isChangeOverdue', () => {
  it('flags non-terminal changes past their window', () => {
    expect(isChangeOverdue(change({ status: 'scheduled' }), 3_000)).toBe(true)
    expect(isChangeOverdue(change({ status: 'closed' }), 3_000)).toBe(false)
    expect(isChangeOverdue(change({ status: 'scheduled' }), 1_500)).toBe(false)
  })
})

describe('findChangeConflicts', () => {
  it('detects overlapping windows on shared devices', () => {
    const conflicts = findChangeConflicts([
      change({ id: 'a', status: 'approved', deviceIds: ['1', '2'] }),
      change({ id: 'b', status: 'scheduled', deviceIds: ['2', '3'] }),
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].reason).toContain('shared device')
  })

  it('ignores non-overlapping and terminal changes', () => {
    const conflicts = findChangeConflicts([
      change({
        id: 'a',
        status: 'approved',
        plannedStart: 1_000,
        plannedEnd: 2_000,
      }),
      change({
        id: 'b',
        status: 'approved',
        plannedStart: 5_000,
        plannedEnd: 6_000,
        deviceIds: ['1'],
      }),
      change({
        id: 'c',
        status: 'closed',
        deviceIds: ['1'],
        plannedStart: 1_000,
        plannedEnd: 2_000,
      }),
    ])
    expect(conflicts).toEqual([])
  })
})

describe('pendingApprovals', () => {
  it('queues in-review changes by risk then start', () => {
    const devices = [device('1'), device('2'), device('3')]
    const queue = pendingApprovals(
      [
        change({
          id: 'low',
          status: 'review',
          type: 'standard',
          deviceIds: ['1'],
        }),
        change({
          id: 'high',
          status: 'review',
          type: 'emergency',
          deviceIds: ['1', '2', '3'],
          plannedStart: 9_000,
          plannedEnd: 10_000,
        }),
      ],
      devices,
      [service({ deviceIds: ['1', '2', '3'] })],
    )
    expect(queue[0].change.id).toBe('high')
  })
})

describe('verifyChange', () => {
  it('verifies when no in-scope device has drifted', () => {
    const drift: DriftSummary[] = [
      { deviceId: '9', drifted: true } as DriftSummary,
    ]
    const result = verifyChange(change({ deviceIds: ['1'] }), drift)
    expect(result.verified).toBe(true)
    expect(result.total).toBe(1)
  })

  it('fails verification when a scope device drifted', () => {
    const drift: DriftSummary[] = [
      { deviceId: '1', drifted: true } as DriftSummary,
    ]
    const result = verifyChange(change({ deviceIds: ['1'] }), drift)
    expect(result.verified).toBe(false)
    expect(result.drifted).toBe(1)
  })
})

describe('changeSummary', () => {
  it('rolls up the change portfolio', () => {
    const summary = changeSummary(
      [
        change({
          id: '1',
          status: 'review',
          plannedStart: 100,
          plannedEnd: 200,
        }),
        change({
          id: '2',
          status: 'scheduled',
          plannedStart: 5_000,
          plannedEnd: 6_000,
        }),
        change({ id: '3', status: 'closed' }),
      ],
      1_500,
    )
    expect(summary.total).toBe(3)
    expect(summary.pendingApproval).toBe(1)
    expect(summary.byStatus.closed).toBe(1)
    expect(summary.overdue).toBe(1)
  })
})
