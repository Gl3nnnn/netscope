import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ESCALATION,
  channelsForSeverity,
  escalationLevel,
  severityHitsChannel,
  shouldDeliver,
  type NotificationChannel,
} from '@/lib/channels'

function channel(
  overrides: Partial<NotificationChannel> = {},
): NotificationChannel {
  return {
    id: 'c1',
    kind: 'slack',
    name: '#alerts',
    target: 'slack',
    enabled: true,
    minSeverity: 'medium',
    escalate: false,
    ...overrides,
  }
}

describe('severityHitsChannel', () => {
  it('routes an alert at or above the channel minimum', () => {
    expect(severityHitsChannel('medium', 'high')).toBe(true)
    expect(severityHitsChannel('high', 'medium')).toBe(false)
    expect(severityHitsChannel('critical', 'critical')).toBe(true)
  })
})

describe('channelsForSeverity', () => {
  it('keeps only enabled matching channels', () => {
    const channels = [
      channel({ id: 'a', minSeverity: 'low' }),
      channel({ id: 'b', minSeverity: 'critical' }),
      channel({ id: 'c', minSeverity: 'low', enabled: false }),
    ]
    expect(channelsForSeverity(channels, 'medium').map((c) => c.id)).toEqual([
      'a',
    ])
  })
})

describe('escalationLevel', () => {
  it('steps up at the configured thresholds', () => {
    expect(escalationLevel(10_000, DEFAULT_ESCALATION)).toBe(0)
    expect(escalationLevel(30_000, DEFAULT_ESCALATION)).toBe(1)
    expect(escalationLevel(90_000, DEFAULT_ESCALATION)).toBe(2)
  })
})

describe('shouldDeliver', () => {
  it('delivers matching channels at levels 0 and 1', () => {
    expect(shouldDeliver(channel(), 'high', 0)).toBe(true)
    expect(shouldDeliver(channel(), 'high', 1)).toBe(true)
  })

  it('respects minimum severity', () => {
    expect(shouldDeliver(channel({ minSeverity: 'critical' }), 'high', 0)).toBe(
      false,
    )
  })

  it('only pages escalate channels on critical alerts at level 2', () => {
    const pager = channel({ id: 'p', minSeverity: 'critical', escalate: true })
    const slack = channel({ id: 's', minSeverity: 'low' })
    expect(shouldDeliver(pager, 'critical', 2)).toBe(true)
    expect(shouldDeliver(slack, 'critical', 2)).toBe(false)
    expect(shouldDeliver(pager, 'high', 2)).toBe(false)
  })
})
