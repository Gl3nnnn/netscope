import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  LICENSE_BASE_USD,
  budgetFor,
  costHistory,
  costLedger,
  forecast12,
  licenseFor,
  powerMonthlyFor,
  runFinops,
  savingsFor,
  siteBreakdown,
} from '@/lib/finops'
import { buildCircuits, siteDemand } from '@/lib/wan'
import { devicePower } from '@/lib/environment'
import { lifecycleFleet, refreshQueue } from '@/lib/lifecycle'

const SEED = 23
const NOW = 1_700_000_000_000

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
  makeDevice({ id: 'r1', name: 'r1', type: 'router', site: 'HQ - Floor 1' }),
  makeDevice({
    id: 'fw1',
    name: 'fw1',
    type: 'firewall',
    site: 'HQ - Floor 1',
  }),
  makeDevice({ id: 'srv1', name: 'srv1', site: 'Data Center A' }),
  makeDevice({
    id: 'srv2',
    name: 'srv2',
    site: 'Branch - West',
    cpuPct: 5,
    status: 'offline',
  }),
  makeDevice({ id: 'sw1', name: 'sw1', type: 'switch', site: 'Branch - West' }),
  makeDevice({
    id: 'ap1',
    name: 'ap1',
    type: 'accessPoint',
    site: 'Branch - East',
  }),
]

// ---------------------------------------------------------------------------
// Unit pieces
// ---------------------------------------------------------------------------

describe('licenseFor', () => {
  it('is deterministic and bounded around the type base', () => {
    for (const device of DEVICES) {
      const a = licenseFor(device, SEED)
      const b = licenseFor(device, SEED)
      expect(a).toBe(b)
      expect(a).toBeGreaterThan(0)
      const base = LICENSE_BASE_USD[device.type]
      expect(a).toBeGreaterThanOrEqual(base * 0.75)
      expect(a).toBeLessThanOrEqual(base * 1.3)
    }
  })
})

describe('powerMonthlyFor', () => {
  it('scales the per-day cost to a month', () => {
    const device = DEVICES[0]!
    const expected =
      Math.round(devicePower(device).costPerDay * 30.4 * 100) / 100
    expect(powerMonthlyFor(device)).toBe(expected)
    expect(powerMonthlyFor(device)).toBeGreaterThan(0)
  })
})

describe('budgetFor', () => {
  it('scales with the fleet and floors at $6k', () => {
    expect(budgetFor([])).toBe(6000)
    expect(budgetFor(DEVICES)).toBe(Math.round(DEVICES.length * 1650))
  })
})

// ---------------------------------------------------------------------------
// Ledger & breakdown
// ---------------------------------------------------------------------------

describe('costLedger', () => {
  it('covers every circuit and device with unique ids', () => {
    const lines = costLedger(DEVICES, SEED, NOW)
    const circuits = buildCircuits(DEVICES, {}, SEED)
    const ids = new Set(lines.map((line) => line.id))
    expect(ids.size).toBe(lines.length)
    expect(lines.filter((line) => line.category === 'wan')).toHaveLength(
      circuits.length,
    )
    expect(lines.filter((line) => line.category === 'licenses')).toHaveLength(
      DEVICES.length,
    )
    expect(lines.filter((line) => line.category === 'power')).toHaveLength(
      DEVICES.length,
    )
    for (const line of lines) {
      expect(line.monthlyUsd).toBeGreaterThan(0)
    }
  })

  it('only reserves refresh spend for the refresh queue', () => {
    const lines = costLedger(DEVICES, SEED, NOW)
    const refreshLines = lines.filter((line) => line.category === 'refresh')
    const queued = refreshQueue(lifecycleFleet(DEVICES, NOW, SEED)).map(
      (record) => record.deviceId,
    )
    expect(refreshLines).toHaveLength(queued.length)
    for (const line of refreshLines) {
      expect(queued).toContain(line.deviceId)
    }
  })
})

describe('siteBreakdown', () => {
  it('partitions spend by site and totals the ledger', () => {
    const lines = costLedger(DEVICES, SEED, NOW)
    const sites = siteBreakdown(lines)
    const ledgerTotal = lines.reduce((sum, line) => sum + line.monthlyUsd, 0)
    const siteTotal = sites.reduce((sum, site) => sum + site.monthlyUsd, 0)
    expect(Math.round(siteTotal * 100)).toBe(Math.round(ledgerTotal * 100))
    for (let i = 1; i < sites.length; i += 1) {
      expect(sites[i]!.monthlyUsd).toBeLessThanOrEqual(sites[i - 1]!.monthlyUsd)
    }
    expect(sites.map((site) => site.site)).toContain('HQ - Floor 1')
  })
})

// ---------------------------------------------------------------------------
// Savings
// ---------------------------------------------------------------------------

describe('savingsFor', () => {
  it('recommends positive savings sorted worst-first with unique ids', () => {
    const circuits = buildCircuits(DEVICES, {}, SEED)
    const lines = costLedger(DEVICES, SEED, NOW)
    const recs = savingsFor(DEVICES, circuits, lines, SEED, NOW)
    const ids = new Set(recs.map((rec) => rec.id))
    expect(ids.size).toBe(recs.length)
    for (const rec of recs) {
      expect(rec.monthlySavingUsd).toBeGreaterThan(0)
      expect(rec.title.length).toBeGreaterThan(0)
      expect(rec.detail.length).toBeGreaterThan(0)
    }
    for (let i = 1; i < recs.length; i += 1) {
      expect(recs[i]!.monthlySavingUsd).toBeLessThanOrEqual(
        recs[i - 1]!.monthlySavingUsd,
      )
    }
  })

  it('only downsizes primary circuits that are under-utilised', () => {
    const circuits = buildCircuits(DEVICES, {}, SEED)
    const lines = costLedger(DEVICES, SEED, NOW)
    const recs = savingsFor(DEVICES, circuits, lines, SEED, NOW)
    for (const rec of recs.filter((item) => item.kind === 'downsize-circuit')) {
      const circuit = circuits.find((item) => rec.id.endsWith(item.id))!
      expect(circuit.role).toBe('primary')
      const demand = siteDemand(DEVICES, circuit.site)
      expect(demand / circuit.bandwidthMbps).toBeLessThan(0.25)
    }
  })

  it('returns nothing for an empty fleet', () => {
    expect(savingsFor([], [], [], SEED, NOW)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// History & forecast
// ---------------------------------------------------------------------------

describe('costHistory', () => {
  it('returns 12 deterministic months around the current total', () => {
    const a = costHistory(10_000, SEED)
    const b = costHistory(10_000, SEED)
    expect(a).toEqual(b)
    expect(a).toHaveLength(12)
    for (const point of a) {
      expect(point).toBeGreaterThan(8_000)
      expect(point).toBeLessThan(12_000)
    }
  })
})

describe('forecast12', () => {
  it('compounds 2% growth and is deterministic', () => {
    const a = forecast12(10_000)
    expect(a).toBe(forecast12(10_000))
    expect(a).toBeGreaterThan(10_000 * 12)
    expect(forecast12(0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

describe('runFinops', () => {
  it('is deterministic and internally consistent', () => {
    const a = runFinops(DEVICES, SEED, NOW)
    const b = runFinops(DEVICES, SEED, NOW)
    expect(a).toEqual(b)

    const { summary } = a
    const categoryTotal = Object.values(summary.byCategory).reduce(
      (sum, value) => sum + value,
      0,
    )
    expect(Math.round(categoryTotal * 100)).toBe(
      Math.round(summary.totalMonthlyUsd * 100),
    )
    expect(summary.varianceUsd).toBe(
      Math.round((summary.totalMonthlyUsd - summary.budgetUsd) * 100) / 100,
    )
    expect(summary.savingsPotentialUsd).toBe(
      Math.round(
        a.savings.reduce((sum, rec) => sum + rec.monthlySavingUsd, 0) * 100,
      ) / 100,
    )
    expect(summary.costPerDeviceUsd).toBeGreaterThan(0)
    expect(a.history).toHaveLength(12)
    expect(a.circuits.length).toBeGreaterThan(0)
    expect(summary.forecast12moUsd).toBeGreaterThan(summary.totalMonthlyUsd)
    // Seeded totals for this fixture — lock the ledger maths.
    expect(summary.totalMonthlyUsd).toBe(34_361.63)
    expect(summary.byCategory.wan).toBe(32_985)
    expect(summary.budgetUsd).toBe(9900)
    expect(summary.variancePct).toBe(247.1)
    expect(summary.savingsPotentialUsd).toBe(6795.55)
    expect(a.history[11]).toBe(37_587.28)
    expect(a.sites[0]!.site).toBe('Data Center A')
    const kinds = new Set(a.savings.map((rec) => rec.kind))
    expect(kinds.has('downsize-circuit')).toBe(true)
    expect(kinds.has('decommission')).toBe(true)
  })

  it('is safe with an empty fleet', () => {
    const result = runFinops([], SEED, NOW)
    expect(result.summary.totalMonthlyUsd).toBe(0)
    expect(result.summary.budgetUsd).toBe(6000)
    expect(result.summary.varianceUsd).toBe(-6000)
    expect(result.lines).toEqual([])
    expect(result.savings).toEqual([])
  })
})
