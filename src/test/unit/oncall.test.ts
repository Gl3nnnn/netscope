import { describe, expect, it } from 'vitest'
import {
  currentOnCall,
  escalationChain,
  handoffSchedule,
  memberIdAt,
  nextHandoff,
  onCallAt,
  resolveMember,
  slotIndex,
  slotStart,
  WEEK_MS,
  type Rotation,
  type Team,
} from '@/lib/oncall'

const TEAM: Team = {
  id: 't1',
  name: 'Platform',
  members: [
    { id: 'm1', name: 'Ada' },
    { id: 'm2', name: 'Grace' },
    { id: 'm3', name: 'Linus' },
  ],
}

const ROTATION: Rotation = {
  id: 'r1',
  teamId: 't1',
  name: 'Primary',
  startsAt: 0,
  intervalMs: WEEK_MS,
  members: ['m1', 'm2', 'm3'],
}

describe('slotIndex / slotStart', () => {
  it('cycles members by interval', () => {
    expect(slotIndex(ROTATION, 0)).toBe(0)
    expect(slotIndex(ROTATION, WEEK_MS)).toBe(1)
    expect(slotIndex(ROTATION, 2 * WEEK_MS)).toBe(2)
    expect(slotIndex(ROTATION, 3 * WEEK_MS)).toBe(0)
  })

  it('handles times before the anchor without going negative', () => {
    expect(slotIndex(ROTATION, -WEEK_MS)).toBe(2)
    expect(slotIndex(ROTATION, -1)).toBe(2)
  })

  it('computes the slot start', () => {
    expect(slotStart(ROTATION, WEEK_MS + 5000)).toBe(WEEK_MS)
  })

  it('returns -1 for an empty rotation', () => {
    expect(slotIndex({ ...ROTATION, members: [] }, 0)).toBe(-1)
    expect(memberIdAt({ ...ROTATION, members: [] }, 0)).toBeNull()
  })
})

describe('resolveMember / onCallAt', () => {
  it('resolves members across teams', () => {
    expect(resolveMember([TEAM], 'm2')?.name).toBe('Grace')
    expect(resolveMember([TEAM], 'nope')).toBeNull()
  })

  it('returns the on-call member at a time', () => {
    expect(onCallAt(ROTATION, [TEAM], WEEK_MS)?.name).toBe('Grace')
  })
})

describe('handoffSchedule / nextHandoff', () => {
  it('starts at the current slot and lists subsequent slots', () => {
    const slots = handoffSchedule(ROTATION, WEEK_MS + 10, 2)
    expect(slots).toHaveLength(2)
    expect(slots[0].start).toBe(WEEK_MS)
    expect(slots[0].memberId).toBe('m2')
    expect(slots[1].memberId).toBe('m3')
    expect(slots[1].start - slots[0].end).toBe(0)
  })

  it('finds the next handoff', () => {
    const next = nextHandoff(ROTATION, 0)
    expect(next?.at).toBe(WEEK_MS)
    expect(next?.memberId).toBe('m2')
  })
})

describe('currentOnCall', () => {
  it('omits rotations whose team is missing', () => {
    const result = currentOnCall([], [ROTATION], 0)
    expect(result).toHaveLength(0)
  })

  it('resolves member, team and next handoff', () => {
    const result = currentOnCall([TEAM], [ROTATION], 0)
    expect(result[0].member?.name).toBe('Ada')
    expect(result[0].team.name).toBe('Platform')
    expect(result[0].next?.memberId).toBe('m2')
  })
})

describe('escalationChain', () => {
  it('starts with the current member and wraps around', () => {
    const chain = escalationChain(ROTATION, [TEAM], 2 * WEEK_MS, 3)
    expect(chain.map((member) => member.name)).toEqual([
      'Linus',
      'Ada',
      'Grace',
    ])
  })

  it('caps at the roster size', () => {
    expect(escalationChain(ROTATION, [TEAM], 0, 10)).toHaveLength(3)
  })
})
