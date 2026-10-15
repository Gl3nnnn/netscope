import type { Device, Severity } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import { buildCircuits, type Circuit } from '@/lib/wan'

/**
 * Carrier billing / SLA-credit engine.
 *
 * Every circuit's measured availability below its contracted SLA earns a
 * service credit on a tiered curve (the standard carrier credit table). We
 * model what the carrier *actually* credited (often short) and what they
 * invoiced (sometimes wrong), then roll the gap into recoverable amounts and
 * dispute findings per carrier. Pure, deterministic, cross-engine with wan.ts.
 */

export interface CreditTier {
  /** Lower bound of measured availability (%). */
  minAvailabilityPct: number
  /** Credit as a percentage of the monthly fee. */
  creditPct: number
}

/** Standard carrier SLA credit table (applies when measured < contracted). */
export const CREDIT_TIERS: CreditTier[] = [
  { minAvailabilityPct: 99.9, creditPct: 0 },
  { minAvailabilityPct: 99.0, creditPct: 10 },
  { minAvailabilityPct: 95.0, creditPct: 25 },
  { minAvailabilityPct: 0, creditPct: 50 },
]

export type BillingFindingKind =
  'missing-credit' | 'under-credited' | 'invoice-mismatch'

export interface CreditEntitlement {
  circuitId: string
  site: string
  carrier: string
  monthlyCostUsd: number
  contractedUptimePct: number
  measuredUptimePct: number
  /** How far below contract (pp); 0 when in-SLA. */
  shortfallPct: number
  creditPct: number
  /** Credit the contract entitles us to this month. */
  entitledUsd: number
  /** Credit the carrier actually applied to the invoice. */
  billedCreditUsd: number
  /** Money still owed: max(0, entitled − billed). */
  recoverableUsd: number
  /** What the carrier invoiced this month (seeded discrepancy). */
  invoiceUsd: number
  /** Invoice minus contracted fee (positive = overcharged). */
  invoiceDeltaUsd: number
}

export interface CarrierRollup {
  carrier: string
  circuits: number
  entitledUsd: number
  billedCreditUsd: number
  recoverableUsd: number
  invoiceDeltaUsd: number
  disputes: number
}

export interface BillingFinding {
  id: string
  kind: BillingFindingKind
  severity: Severity
  circuitId: string
  carrier: string
  site: string
  message: string
}

export interface BillingSummary {
  circuits: number
  breachCircuits: number
  entitledUsd: number
  billedCreditUsd: number
  recoverableUsd: number
  invoiceDeltaUsd: number
  disputes: number
}

export interface BillingResult {
  entitlements: CreditEntitlement[]
  carriers: CarrierRollup[]
  findings: BillingFinding[]
  summary: BillingSummary
}

const round2 = (value: number) => Math.round(value * 100) / 100

/** Credit % from the tiered table for a measured availability. */
export function creditTierFor(measuredUptimePct: number): number {
  for (const tier of CREDIT_TIERS) {
    if (measuredUptimePct >= tier.minAvailabilityPct) return tier.creditPct
  }
  return CREDIT_TIERS[CREDIT_TIERS.length - 1]!.creditPct
}

/** One circuit's monthly credit entitlement plus seeded invoice reality. */
export function buildEntitlement(
  circuit: Circuit,
  seed: number,
): CreditEntitlement {
  const inSla = circuit.measuredUptimePct >= circuit.contractedUptimePct
  const shortfallPct = inSla
    ? 0
    : round2(circuit.contractedUptimePct - circuit.measuredUptimePct)
  const creditPct = inSla ? 0 : creditTierFor(circuit.measuredUptimePct)
  const entitledUsd = round2((circuit.monthlyCostUsd * creditPct) / 100)

  const rng = mulberry32(hashSeed(`billing:${circuit.id}:${seed}`))
  const invoiceDrift = (rng.next() - 0.5) * 0.06 // ±3%
  const invoiceUsd = round2(circuit.monthlyCostUsd * (1 + invoiceDrift))
  const invoiceDeltaUsd = round2(invoiceUsd - circuit.monthlyCostUsd)

  let billedCreditUsd = 0
  if (entitledUsd > 0) {
    const roll = rng.next()
    // Carriers honour full credit 60%, half 20%, nothing 20% of the time.
    billedCreditUsd =
      roll < 0.6 ? entitledUsd : roll < 0.8 ? round2(entitledUsd / 2) : 0
  }
  const recoverableUsd = round2(Math.max(0, entitledUsd - billedCreditUsd))

  return {
    circuitId: circuit.id,
    site: circuit.site,
    carrier: circuit.carrier,
    monthlyCostUsd: circuit.monthlyCostUsd,
    contractedUptimePct: circuit.contractedUptimePct,
    measuredUptimePct: circuit.measuredUptimePct,
    shortfallPct,
    creditPct,
    entitledUsd,
    billedCreditUsd,
    recoverableUsd,
    invoiceUsd,
    invoiceDeltaUsd,
  }
}

export function billingFindings(
  entitlements: CreditEntitlement[],
): BillingFinding[] {
  const findings: BillingFinding[] = []
  for (const item of entitlements) {
    if (item.entitledUsd > 0 && item.billedCreditUsd === 0) {
      findings.push({
        id: `${item.circuitId}:missing`,
        kind: 'missing-credit',
        severity: item.recoverableUsd >= 100 ? 'critical' : 'high',
        circuitId: item.circuitId,
        carrier: item.carrier,
        site: item.site,
        message: `No SLA credit applied for ${item.site} (${item.carrier}) — ${item.measuredUptimePct}% vs ${item.contractedUptimePct}% contracted; $${item.entitledUsd.toFixed(2)} owed.`,
      })
    } else if (item.recoverableUsd > 0) {
      findings.push({
        id: `${item.circuitId}:under`,
        kind: 'under-credited',
        severity: 'medium',
        circuitId: item.circuitId,
        carrier: item.carrier,
        site: item.site,
        message: `Carrier under-credited ${item.site} (${item.carrier}) — $${item.billedCreditUsd.toFixed(2)} applied of $${item.entitledUsd.toFixed(2)} entitled.`,
      })
    }
    if (Math.abs(item.invoiceDeltaUsd) > item.monthlyCostUsd * 0.01) {
      findings.push({
        id: `${item.circuitId}:invoice`,
        kind: 'invoice-mismatch',
        severity: item.invoiceDeltaUsd > 0 ? 'low' : 'low',
        circuitId: item.circuitId,
        carrier: item.carrier,
        site: item.site,
        message: `Invoice mismatch for ${item.site} (${item.carrier}) — billed $${item.invoiceUsd.toFixed(2)} vs $${item.monthlyCostUsd.toFixed(2)} contracted (${item.invoiceDeltaUsd > 0 ? '+' : ''}$${item.invoiceDeltaUsd.toFixed(2)}).`,
      })
    }
  }
  return findings
}

export function carrierRollups(
  entitlements: CreditEntitlement[],
): CarrierRollup[] {
  const byCarrier = new Map<string, CarrierRollup>()
  for (const item of entitlements) {
    const entry = byCarrier.get(item.carrier) ?? {
      carrier: item.carrier,
      circuits: 0,
      entitledUsd: 0,
      billedCreditUsd: 0,
      recoverableUsd: 0,
      invoiceDeltaUsd: 0,
      disputes: 0,
    }
    entry.circuits += 1
    entry.entitledUsd = round2(entry.entitledUsd + item.entitledUsd)
    entry.billedCreditUsd = round2(entry.billedCreditUsd + item.billedCreditUsd)
    entry.recoverableUsd = round2(entry.recoverableUsd + item.recoverableUsd)
    entry.invoiceDeltaUsd = round2(entry.invoiceDeltaUsd + item.invoiceDeltaUsd)
    if (item.recoverableUsd > 0) entry.disputes += 1
    byCarrier.set(item.carrier, entry)
  }
  return [...byCarrier.values()].sort(
    (a, b) => b.recoverableUsd - a.recoverableUsd,
  )
}

export function billingSummary(
  entitlements: CreditEntitlement[],
): BillingSummary {
  const sum = (pick: (item: CreditEntitlement) => number) =>
    round2(entitlements.reduce((total, item) => total + pick(item), 0))
  return {
    circuits: entitlements.length,
    breachCircuits: entitlements.filter((item) => item.shortfallPct > 0).length,
    entitledUsd: sum((item) => item.entitledUsd),
    billedCreditUsd: sum((item) => item.billedCreditUsd),
    recoverableUsd: sum((item) => item.recoverableUsd),
    invoiceDeltaUsd: sum((item) => item.invoiceDeltaUsd),
    disputes: entitlements.filter((item) => item.recoverableUsd > 0).length,
  }
}

/** Full billing view for the live fleet's circuits. */
export function runCarrierBilling(
  devices: Device[],
  seed: number,
): BillingResult {
  const circuits = buildCircuits(devices, {}, seed)
  const entitlements = circuits.map((circuit) =>
    buildEntitlement(circuit, seed),
  )
  return {
    entitlements,
    carriers: carrierRollups(entitlements),
    findings: billingFindings(entitlements),
    summary: billingSummary(entitlements),
  }
}
