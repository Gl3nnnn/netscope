import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import type { Circuit } from '@/lib/wan'
import {
  CREDIT_TIERS,
  billingFindings,
  billingSummary,
  buildEntitlement,
  carrierRollups,
  creditTierFor,
  runCarrierBilling,
} from '@/lib/carrierbilling'

const SEED = 31

function makeDevice(overrides: Partial<Device> & { id: string }): Device {
  return {
    name: overrides.id,
    type: 'router',
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
  makeDevice({ id: 'r1', name: 'r1' }),
  makeDevice({ id: 'fw1', name: 'fw1', type: 'firewall' }),
  makeDevice({ id: 'r2', name: 'r2', site: 'Data Center A' }),
  makeDevice({ id: 'r3', name: 'r3', site: 'Branch - West' }),
]

function makeCircuit(overrides: Partial<Circuit> = {}): Circuit {
  return {
    id: 'c1',
    site: 'HQ - Floor 1',
    kind: 'dia',
    carrier: 'Lumen',
    role: 'primary',
    bandwidthMbps: 500,
    monthlyCostUsd: 2000,
    contractedUptimePct: 99.9,
    measuredUptimePct: 99.95,
    latencyMs: 12,
    jitterMs: 3,
    lossPct: 0.1,
    status: 'up',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Credit table
// ---------------------------------------------------------------------------

describe('creditTierFor', () => {
  it('maps measured availability to the standard credit curve', () => {
    expect(creditTierFor(99.95)).toBe(0)
    expect(creditTierFor(99.9)).toBe(0)
    expect(creditTierFor(99.5)).toBe(10)
    expect(creditTierFor(99.0)).toBe(10)
    expect(creditTierFor(97.0)).toBe(25)
    expect(creditTierFor(95.0)).toBe(25)
    expect(creditTierFor(94.9)).toBe(50)
    expect(creditTierFor(0)).toBe(50)
  })

  it('tiers are sorted descending and non-negative', () => {
    for (let i = 1; i < CREDIT_TIERS.length; i += 1) {
      expect(CREDIT_TIERS[i]!.minAvailabilityPct).toBeLessThan(
        CREDIT_TIERS[i - 1]!.minAvailabilityPct,
      )
      expect(CREDIT_TIERS[i]!.creditPct).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Entitlements
// ---------------------------------------------------------------------------

describe('buildEntitlement', () => {
  it('entitles nothing when the circuit is in-SLA', () => {
    const item = buildEntitlement(makeCircuit(), SEED)
    expect(item.shortfallPct).toBe(0)
    expect(item.creditPct).toBe(0)
    expect(item.entitledUsd).toBe(0)
    expect(item.billedCreditUsd).toBe(0)
    expect(item.recoverableUsd).toBe(0)
  })

  it('entitles the tiered credit when below contract', () => {
    const item = buildEntitlement(
      makeCircuit({
        contractedUptimePct: 99.9,
        measuredUptimePct: 99.5,
        monthlyCostUsd: 2000,
      }),
      SEED,
    )
    expect(item.shortfallPct).toBeCloseTo(0.4, 5)
    expect(item.creditPct).toBe(10)
    expect(item.entitledUsd).toBe(200)
  })

  it('uses the deep-outage tier for severe breaches', () => {
    const item = buildEntitlement(
      makeCircuit({
        contractedUptimePct: 99.95,
        measuredUptimePct: 90,
        monthlyCostUsd: 1000,
      }),
      SEED,
    )
    expect(item.creditPct).toBe(50)
    expect(item.entitledUsd).toBe(500)
    expect(item.recoverableUsd).toBeGreaterThan(0)
  })

  it('is deterministic and keeps invoice drift within ±3%', () => {
    const circuit = makeCircuit({ measuredUptimePct: 98.5 })
    const a = buildEntitlement(circuit, SEED)
    const b = buildEntitlement(circuit, SEED)
    expect(a).toEqual(b)
    expect(Math.abs(a.invoiceDeltaUsd)).toBeLessThanOrEqual(
      circuit.monthlyCostUsd * 0.03 + 0.01,
    )
    expect(a.recoverableUsd).toBe(
      Math.round(Math.max(0, a.entitledUsd - a.billedCreditUsd) * 100) / 100,
    )
  })
})

// ---------------------------------------------------------------------------
// Findings, rollups, summary
// ---------------------------------------------------------------------------

describe('billingFindings', () => {
  it('flags missing credits, under-credits and invoice mismatches', () => {
    const entitlements = [
      buildEntitlement(
        makeCircuit({
          id: 'c-missing',
          measuredUptimePct: 98.0,
          monthlyCostUsd: 1000,
        }),
        SEED,
      ),
      buildEntitlement(
        makeCircuit({
          id: 'c-ok',
          measuredUptimePct: 99.99,
          monthlyCostUsd: 500,
        }),
        SEED,
      ),
    ]
    // Force one into the "missing credit" bucket for a deterministic finding.
    entitlements[0] = {
      ...entitlements[0]!,
      billedCreditUsd: 0,
      recoverableUsd: entitlements[0]!.entitledUsd,
    }
    const findings = billingFindings(entitlements)
    const missing = findings.filter((f) => f.kind === 'missing-credit')
    expect(missing.length).toBeGreaterThanOrEqual(1)
    for (const finding of findings) {
      expect(finding.message.length).toBeGreaterThan(0)
      expect(['critical', 'high', 'medium', 'low']).toContain(finding.severity)
    }
    // In-SLA circuit with a clean invoice emits nothing.
    expect(
      findings.filter(
        (f) => f.circuitId === 'c-ok' && f.kind === 'missing-credit',
      ),
    ).toHaveLength(0)
  })

  it('emits nothing for a clean in-SLA entitlement', () => {
    const clean = buildEntitlement(
      makeCircuit({ measuredUptimePct: 99.99, monthlyCostUsd: 500 }),
      SEED,
    )
    const tuned = {
      ...clean,
      invoiceUsd: clean.monthlyCostUsd,
      invoiceDeltaUsd: 0,
      billedCreditUsd: 0,
      entitledUsd: 0,
      recoverableUsd: 0,
    }
    expect(billingFindings([tuned])).toEqual([])
  })
})

describe('carrierRollups', () => {
  it('aggregates per carrier and ranks by recoverable', () => {
    const entitlements = [
      buildEntitlement(
        makeCircuit({ id: 'a', carrier: 'Lumen', measuredUptimePct: 98 }),
        SEED,
      ),
      buildEntitlement(
        makeCircuit({ id: 'b', carrier: 'Zayo', measuredUptimePct: 99.99 }),
        SEED,
      ),
      buildEntitlement(
        makeCircuit({ id: 'c', carrier: 'Lumen', measuredUptimePct: 99.99 }),
        SEED,
      ),
    ]
    const rollups = carrierRollups(entitlements)
    const lumen = rollups.find((r) => r.carrier === 'Lumen')!
    expect(lumen.circuits).toBe(2)
    expect(rollups.find((r) => r.carrier === 'Zayo')!.recoverableUsd).toBe(0)
    for (let i = 1; i < rollups.length; i += 1) {
      expect(rollups[i]!.recoverableUsd).toBeLessThanOrEqual(
        rollups[i - 1]!.recoverableUsd,
      )
    }
  })
})

describe('billingSummary', () => {
  it('totals credits, recoverables and disputes', () => {
    const entitlements = [
      buildEntitlement(
        makeCircuit({ id: 'x', measuredUptimePct: 98.5, monthlyCostUsd: 1000 }),
        SEED,
      ),
      buildEntitlement(
        makeCircuit({ id: 'y', measuredUptimePct: 99.99, monthlyCostUsd: 500 }),
        SEED,
      ),
    ]
    const summary = billingSummary(entitlements)
    expect(summary.circuits).toBe(2)
    expect(summary.breachCircuits).toBe(1)
    expect(summary.entitledUsd).toBeGreaterThanOrEqual(0)
    expect(summary.recoverableUsd).toBeGreaterThanOrEqual(0)
    expect(summary.disputes).toBe(
      entitlements.filter((e) => e.recoverableUsd > 0).length,
    )
  })

  it('returns zeroes for an empty set', () => {
    expect(billingSummary([])).toEqual({
      circuits: 0,
      breachCircuits: 0,
      entitledUsd: 0,
      billedCreditUsd: 0,
      recoverableUsd: 0,
      invoiceDeltaUsd: 0,
      disputes: 0,
    })
  })
})

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

describe('runCarrierBilling', () => {
  it('wires the live WAN engine deterministically', () => {
    const a = runCarrierBilling(DEVICES, SEED)
    const b = runCarrierBilling(DEVICES, SEED)
    expect(a).toEqual(b)
    expect(a.entitlements.length).toBeGreaterThan(0)
    expect(a.summary.circuits).toBe(a.entitlements.length)
    const ids = new Set(a.entitlements.map((e) => e.circuitId))
    expect(ids.size).toBe(a.entitlements.length)
    for (const item of a.entitlements) {
      expect(item.recoverableUsd).toBe(
        Math.round(Math.max(0, item.entitledUsd - item.billedCreditUsd) * 100) /
          100,
      )
    }
  })

  it('is safe on an empty fleet', () => {
    const result = runCarrierBilling([], SEED)
    expect(result.entitlements).toEqual([])
    expect(result.summary.circuits).toBe(0)
  })
})
