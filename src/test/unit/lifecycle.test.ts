import { describe, expect, it } from 'vitest'
import type { Device, DeviceType } from '@/types'
import {
  EOL_WARNING_DAYS,
  LIFECYCLE_STATUS_LABELS,
  MS_PER_DAY,
  SUPPORT_YEARS,
  WARRANTY_YEARS,
  WARRANTY_WARNING_DAYS,
  daysUntilExpiry,
  lifecycleFleet,
  lifecycleFor,
  lifecycleSummary,
  refreshQueue,
} from '@/lib/lifecycle'

const NOW = 1_700_000_000_000

function device(id: string, type: DeviceType = 'server'): Device {
  return {
    id,
    name: `${type} ${id}`,
    type,
    site: 'DC',
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 500,
    capacityMbps: 1000,
    cpuPct: 48,
    memoryPct: 70,
    uptimeSec: 1000,
    lastSeen: 0,
  }
}

function fleet(type: DeviceType = 'server', count = 40): Device[] {
  return Array.from({ length: count }, (_, i) => device(`${i + 1}`, type))
}

describe('daysUntilExpiry', () => {
  it('is positive in the future and negative once past', () => {
    expect(daysUntilExpiry(NOW + 10 * MS_PER_DAY, NOW)).toBe(10)
    expect(daysUntilExpiry(NOW - 5 * MS_PER_DAY, NOW)).toBe(-5)
    expect(daysUntilExpiry(NOW, NOW)).toBe(0)
  })
})

describe('lifecycleFor', () => {
  it('is deterministic for the same device, now and seed', () => {
    const a = lifecycleFor(device('7'), NOW, 3)
    const b = lifecycleFor(device('7'), NOW, 3)
    expect(a).toEqual(b)
  })

  it('derives an age within the seeded window', () => {
    const record = lifecycleFor(device('5'), NOW)
    expect(record.ageDays).toBeGreaterThanOrEqual(200)
    expect(record.ageDays).toBeLessThanOrEqual(2600)
  })

  it('anchors acquisition, warranty and EOL to the age and type windows', () => {
    const dev = device('9', 'router')
    const record = lifecycleFor(dev, NOW)
    expect(record.acquiredAt).toBe(NOW - record.ageDays * MS_PER_DAY)
    expect(record.warrantyEndsAt).toBe(
      record.acquiredAt + WARRANTY_YEARS.router * 365 * MS_PER_DAY,
    )
    expect(record.eolAt).toBe(
      record.acquiredAt + SUPPORT_YEARS.router * 365 * MS_PER_DAY,
    )
  })

  it('derives day counters consistent with daysUntilExpiry', () => {
    const record = lifecycleFor(device('3'), NOW)
    expect(record.daysToEol).toBe(daysUntilExpiry(record.eolAt, NOW))
    expect(record.daysToWarranty).toBe(
      daysUntilExpiry(record.warrantyEndsAt, NOW),
    )
  })

  it('labels status from the days-to-EOL window', () => {
    const record = lifecycleFor(device('11'), NOW)
    const expected =
      record.daysToEol <= 0
        ? 'eol'
        : record.daysToEol <= EOL_WARNING_DAYS
          ? 'approaching-eol'
          : 'active'
    expect(record.status).toBe(expected)
    expect(LIFECYCLE_STATUS_LABELS[record.status]).toBeTruthy()
  })

  it('flags refresh at EOL or when the warranty is nearly gone', () => {
    const record = lifecycleFor(device('4'), NOW)
    const expected =
      record.status !== 'active' ||
      record.daysToWarranty <= WARRANTY_WARNING_DAYS
    expect(record.refresh).toBe(expected)
  })

  it('keeps the risk score within 0-100', () => {
    for (const dev of fleet('server', 20)) {
      const record = lifecycleFor(dev, NOW)
      expect(record.riskScore).toBeGreaterThanOrEqual(0)
      expect(record.riskScore).toBeLessThanOrEqual(100)
    }
  })

  it('finds devices at every lifecycle stage across the fleet', () => {
    const records = lifecycleFleet(fleet('server', 200), NOW)
    const statuses = new Set(records.map((r) => r.status))
    expect(statuses.has('active')).toBe(true)
    expect(statuses.has('approaching-eol')).toBe(true)
    expect(statuses.has('eol')).toBe(true)
  })

  it('gives at-past-EOL devices more risk than active ones', () => {
    const records = lifecycleFleet(fleet('server', 200), NOW)
    const eol = records.find((r) => r.status === 'eol')!
    const active = records.find((r) => r.status === 'active')!
    expect(eol.riskScore).toBeGreaterThan(active.riskScore)
  })
})

describe('lifecycleSummary', () => {
  it('counts each stage and averages risk', () => {
    const records = lifecycleFleet(fleet('server', 60), NOW)
    const summary = lifecycleSummary(records)
    expect(summary.total).toBe(60)
    expect(summary.active + summary.approaching + summary.eol).toBe(60)
    expect(summary.refreshCount).toBe(records.filter((r) => r.refresh).length)
    expect(summary.avgRisk).toBeGreaterThanOrEqual(0)
    expect(summary.avgRisk).toBeLessThanOrEqual(100)
    expect(summary.oldestDays).toBe(Math.max(...records.map((r) => r.ageDays)))
  })

  it('handles an empty fleet', () => {
    const summary = lifecycleSummary([])
    expect(summary.total).toBe(0)
    expect(summary.avgRisk).toBe(0)
    expect(summary.oldestDays).toBe(0)
  })
})

describe('refreshQueue', () => {
  it('returns only refresh devices, highest risk first', () => {
    const records = lifecycleFleet(fleet('server', 80), NOW)
    const queue = refreshQueue(records)
    expect(queue.every((r) => r.refresh)).toBe(true)
    for (let i = 1; i < queue.length; i += 1) {
      expect(queue[i]!.riskScore).toBeLessThanOrEqual(queue[i - 1]!.riskScore)
    }
    expect(queue.length).toBe(records.filter((r) => r.refresh).length)
  })
})
