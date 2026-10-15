import { describe, expect, it } from 'vitest'
import type { Device, DeviceStatus } from '@/types'
import {
  CARRIERS,
  CAPACITY_THRESHOLD,
  CIRCUIT_KIND_LABELS,
  CIRCUIT_KIND_SLA,
  buildCircuits,
  carrierScorecards,
  costPerMbps,
  formatRedundancy,
  measuredUptime,
  siteDemand,
  wanFindings,
  wanSites,
  wanSummary,
  type Circuit,
} from '@/lib/wan'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATUSES: DeviceStatus[] = ['online', 'degraded', 'offline']

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

function wanFleet(): Device[] {
  return [
    makeDevice({ id: 'd1', site: 'HQ - Floor 1', throughputMbps: 200 }),
    makeDevice({ id: 'd2', site: 'HQ - Floor 1', throughputMbps: 150 }),
    makeDevice({ id: 'd3', site: 'Branch - West', throughputMbps: 80 }),
    makeDevice({ id: 'd4', site: 'Data Center A', throughputMbps: 400 }),
    makeDevice({ id: 'd5', site: 'HQ - Floor 2', throughputMbps: 60 }),
  ]
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

describe('circuit reference data', () => {
  it('labels and SLAs cover every circuit kind', () => {
    expect(Object.keys(CIRCUIT_KIND_LABELS).sort()).toEqual(
      ['broadband', 'dia', 'lte', 'mpls'].sort(),
    )
    expect(Object.keys(CIRCUIT_KIND_SLA).sort()).toEqual(
      Object.keys(CIRCUIT_KIND_LABELS).sort(),
    )
  })

  it('contracts are plausible (98–100%) and ordered', () => {
    for (const kind of Object.keys(
      CIRCUIT_KIND_SLA,
    ) as (keyof typeof CIRCUIT_KIND_SLA)[]) {
      const sla = CIRCUIT_KIND_SLA[kind]
      expect(sla).toBeGreaterThanOrEqual(98)
      expect(sla).toBeLessThanOrEqual(100)
    }
    expect(CIRCUIT_KIND_SLA.mpls).toBeGreaterThanOrEqual(CIRCUIT_KIND_SLA.dia)
  })

  it('exposes at least three carriers', () => {
    expect(CARRIERS.length).toBeGreaterThanOrEqual(3)
    expect(new Set(CARRIERS).size).toBe(CARRIERS.length)
  })

  it('capacity threshold sits below utilisation', () => {
    expect(CAPACITY_THRESHOLD).toBeGreaterThan(0.5)
    expect(CAPACITY_THRESHOLD).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// Availability maths
// ---------------------------------------------------------------------------

describe('measuredUptime', () => {
  it('is deterministic', () => {
    expect(measuredUptime(99.9, 99.8, 'k1')).toBe(
      measuredUptime(99.9, 99.8, 'k1'),
    )
    expect(measuredUptime(99.9, 99.8, 'k1')).not.toBe(
      measuredUptime(99.9, 99.8, 'k2'),
    )
  })

  it('stays within a realistic band around the contract', () => {
    for (const key of ['a', 'b', 'c', 'd', 'e']) {
      const measured = measuredUptime(99.9, 99.75, key)
      expect(measured).toBeGreaterThanOrEqual(99.5)
      expect(measured).toBeLessThanOrEqual(100)
      expect(Math.abs(measured - 99.9)).toBeLessThanOrEqual(0.4)
    }
  })

  it('clamps into 90..100 for absurd inputs', () => {
    expect(measuredUptime(50, 0, 'low')).toBeGreaterThanOrEqual(90)
    expect(measuredUptime(150, 100, 'high')).toBeLessThanOrEqual(100)
  })

  it('correlates with the site experience', () => {
    const goodSite = measuredUptime(99.9, 99.99, 'same-key')
    const badSite = measuredUptime(99.9, 99.0, 'same-key')
    expect(goodSite).toBeGreaterThan(badSite)
  })
})

describe('costPerMbps', () => {
  it('divides monthly cost by bandwidth', () => {
    expect(costPerMbps({ monthlyCostUsd: 1000, bandwidthMbps: 200 })).toBe(5)
  })

  it('returns 0 for zero bandwidth', () => {
    expect(costPerMbps({ monthlyCostUsd: 100, bandwidthMbps: 0 })).toBe(0)
  })
})

describe('siteDemand', () => {
  it('applies a 20% WAN factor to site throughput', () => {
    expect(siteDemand(wanFleet(), 'HQ - Floor 1')).toBeCloseTo(420, 1) // (200+150)*1.2
  })

  it('is 0 for a site that does not exist', () => {
    expect(siteDemand(wanFleet(), 'Nowhere')).toBe(0)
  })
})

describe('wanSites', () => {
  it('returns sorted unique sites', () => {
    const sites = wanSites(wanFleet())
    expect(sites).toEqual([...sites].sort((a, b) => a.localeCompare(b)))
    expect(sites).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// Circuits
// ---------------------------------------------------------------------------

describe('buildCircuits', () => {
  const devices = wanFleet()
  const siteUptimes = {
    'HQ - Floor 1': 99.95,
    'Branch - West': 99.6,
    'Data Center A': 99.99,
    'HQ - Floor 2': 99.7,
  }
  const circuits = buildCircuits(devices, siteUptimes, 7)

  it('is deterministic for the same inputs', () => {
    expect(buildCircuits(devices, siteUptimes, 7)).toEqual(
      buildCircuits(devices, siteUptimes, 7),
    )
  })

  it('varies across seeds', () => {
    expect(JSON.stringify(buildCircuits(devices, siteUptimes, 1))).not.toBe(
      JSON.stringify(buildCircuits(devices, siteUptimes, 2)),
    )
  })

  it('gives every site exactly one primary circuit', () => {
    for (const site of wanSites(devices)) {
      const primaries = circuits.filter(
        (c) => c.site === site && c.role === 'primary',
      )
      expect(primaries).toHaveLength(1)
    }
  })

  it('never plans more than one backup per site', () => {
    for (const site of wanSites(devices)) {
      const backups = circuits.filter(
        (c) => c.site === site && c.role === 'backup',
      )
      expect(backups.length).toBeLessThanOrEqual(1)
    }
  })

  it('keeps backup carriers diverse from the primary', () => {
    for (const site of wanSites(devices)) {
      const primary = circuits.find(
        (c) => c.site === site && c.role === 'primary',
      )!
      const backup = circuits.find(
        (c) => c.site === site && c.role === 'backup',
      )
      if (backup) expect(backup.carrier).not.toBe(primary.carrier)
    }
  })

  it('uses only known carriers', () => {
    for (const circuit of circuits) {
      expect(CARRIERS).toContain(circuit.carrier as never)
    }
  })

  it('produces positive bandwidth, cost and latency', () => {
    for (const circuit of circuits) {
      expect(circuit.bandwidthMbps).toBeGreaterThan(0)
      expect(circuit.monthlyCostUsd).toBeGreaterThan(0)
      expect(circuit.latencyMs).toBeGreaterThan(0)
      expect(circuit.jitterMs).toBeGreaterThan(0)
      expect(circuit.lossPct).toBeGreaterThanOrEqual(0)
    }
  })

  it('measured availability stays in 90..100', () => {
    for (const circuit of circuits) {
      expect(circuit.measuredUptimePct).toBeGreaterThanOrEqual(90)
      expect(circuit.measuredUptimePct).toBeLessThanOrEqual(100)
    }
  })

  it('contracts match the circuit kind table', () => {
    for (const circuit of circuits) {
      expect(circuit.contractedUptimePct).toBe(CIRCUIT_KIND_SLA[circuit.kind])
    }
  })

  it('carries a valid status and role', () => {
    for (const circuit of circuits) {
      expect(['up', 'degraded', 'down']).toContain(circuit.status)
      expect(['primary', 'backup']).toContain(circuit.role)
    }
  })

  it('has unique circuit ids', () => {
    const ids = circuits.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('returns nothing for an empty fleet', () => {
    expect(buildCircuits([], {}, 0)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Carrier scorecard
// ---------------------------------------------------------------------------

describe('carrierScorecards', () => {
  const devices = wanFleet()
  const circuits = buildCircuits(devices, {}, 7)
  const cards = carrierScorecards(circuits)

  it('covers every carrier that has circuits', () => {
    const carriers = new Set(circuits.map((c) => c.carrier))
    expect(new Set(cards.map((c) => c.carrier))).toEqual(carriers)
  })

  it('accounts for every circuit', () => {
    expect(cards.reduce((sum, c) => sum + c.circuits, 0)).toBe(circuits.length)
  })

  it('scores land in 0..100', () => {
    for (const card of cards) {
      expect(card.score).toBeGreaterThanOrEqual(0)
      expect(card.score).toBeLessThanOrEqual(100)
    }
  })

  it('is sorted best-first and deterministic', () => {
    const scores = cards.map((c) => c.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(carrierScorecards(circuits)).toEqual(cards)
  })

  it('breach counts never exceed circuit counts', () => {
    for (const card of cards) {
      expect(card.breaches).toBeLessThanOrEqual(card.circuits)
      expect(card.tickets).toBeGreaterThanOrEqual(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Findings & summary
// ---------------------------------------------------------------------------

describe('wanFindings', () => {
  const devices = wanFleet()
  const circuits = buildCircuits(devices, {}, 7)
  const findings = wanFindings(devices, circuits)

  it('produces unique ids', () => {
    const ids = findings.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sorts by severity (critical first)', () => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const
    const severities = findings.map((f) => rank[f.severity])
    expect(severities).toEqual([...severities].sort((a, b) => a - b))
  })

  it('references only fleet sites', () => {
    const sites = new Set(wanSites(devices))
    for (const finding of findings) expect(sites.has(finding.site)).toBe(true)
  })

  it('SLA breaches carry a negative delta in the message', () => {
    for (const finding of findings.filter((f) => f.kind === 'sla-breach')) {
      expect(finding.message).toContain('vs')
      expect(finding.message).toContain('−')
    }
  })

  it('returns nothing for a clean empty estate', () => {
    expect(wanFindings([], [])).toEqual([])
  })
})

describe('wanSummary', () => {
  const devices = wanFleet()
  const circuits = buildCircuits(devices, {}, 7)
  const findings = wanFindings(devices, circuits)
  const summary = wanSummary(circuits, findings)

  it('counts circuits and sites consistently', () => {
    expect(summary.circuits).toBe(circuits.length)
    expect(summary.sites).toBe(wanSites(devices).length)
    expect(summary.sitesWithBackup).toBeLessThanOrEqual(summary.sites)
    expect(summary.findings).toBe(findings.length)
  })

  it('redundancy sits in 0..100', () => {
    expect(summary.redundancyPct).toBeGreaterThanOrEqual(0)
    expect(summary.redundancyPct).toBeLessThanOrEqual(100)
    expect(formatRedundancy(summary)).toMatch(/%$/)
  })

  it('money maths add up', () => {
    const expected = circuits.reduce((sum, c) => sum + c.monthlyCostUsd, 0)
    expect(summary.monthlyCostUsd).toBe(expected)
    expect(summary.costPerMbps).toBeCloseTo(
      expected / summary.totalBandwidthMbps,
      1,
    )
  })

  it('grade matches the score thresholds', () => {
    expect(summary.score).toBeGreaterThanOrEqual(0)
    expect(summary.score).toBeLessThanOrEqual(100)
    if (summary.score >= 85) expect(summary.grade).toBe('healthy')
    else if (summary.score >= 60) expect(summary.grade).toBe('degraded')
    else expect(summary.grade).toBe('critical')
  })

  it('an empty estate scores perfectly', () => {
    const empty = wanSummary([], [])
    expect(empty.circuits).toBe(0)
    expect(empty.redundancyPct).toBe(0)
    expect(empty.costPerMbps).toBe(0)
    expect(empty.score).toBe(100)
    expect(empty.grade).toBe('healthy')
  })
})

describe('fixture sanity', () => {
  it('uses every status value at least in the type domain', () => {
    // Guards against drift between fixture helpers and the domain types.
    expect(STATUSES).toContain('offline')
    const sample = buildCircuits(wanFleet(), {}, 3)
    expect(sample.every((c: Circuit) => c.id.startsWith('ckt-'))).toBe(true)
  })
})
