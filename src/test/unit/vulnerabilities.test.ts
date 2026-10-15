import { describe, expect, it } from 'vitest'
import type { Device, Severity } from '@/types'
import {
  CATEGORY_LABELS,
  CVE_CATALOG,
  cvssSeverity,
  deviceRisk,
  dueInDays,
  isOverdue,
  patchQueue,
  scanFleet,
  slaDays,
  unpatchableFindings,
  vulnId,
  vulnerabilityWeight,
  vulnSummary,
  withStatus,
} from '@/lib/vulnerabilities'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEED = 7

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: 'dev-1',
    name: 'rtr-hq-01',
    type: 'router',
    site: 'HQ - Floor 1',
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
    lastSeen: 1_760_000_000_000,
    ...overrides,
  }
}

const DEVICES: Device[] = [
  makeDevice(),
  makeDevice({ id: 'dev-2', name: 'sw-hq-02', type: 'switch' }),
  makeDevice({ id: 'dev-3', name: 'fw-dc-01', type: 'firewall', site: 'DC-A' }),
  makeDevice({ id: 'dev-4', name: 'srv-app-01', type: 'server', site: 'DC-B' }),
  makeDevice({
    id: 'dev-5',
    name: 'ap-east-01',
    type: 'accessPoint',
    site: 'Branch - East',
  }),
]

// ---------------------------------------------------------------------------
// Catalogue integrity
// ---------------------------------------------------------------------------

describe('CVE_CATALOG', () => {
  it('has unique ids with plausible CVSS scores and products', () => {
    const ids = new Set(CVE_CATALOG.map((cve) => cve.id))
    expect(ids.size).toBe(CVE_CATALOG.length)
    for (const cve of CVE_CATALOG) {
      expect(cve.cvss).toBeGreaterThanOrEqual(0)
      expect(cve.cvss).toBeLessThanOrEqual(10)
      expect(cve.products.length).toBeGreaterThan(0)
      expect(cve.publishedDaysAgo).toBeGreaterThan(0)
      expect(Object.keys(CATEGORY_LABELS)).toContain(cve.category)
    }
  })
})

// ---------------------------------------------------------------------------
// Severity & SLAs
// ---------------------------------------------------------------------------

describe('cvssSeverity', () => {
  it('maps CVSS bands onto severities', () => {
    expect(cvssSeverity(9)).toBe('critical')
    expect(cvssSeverity(9.8)).toBe('critical')
    expect(cvssSeverity(8.9)).toBe('high')
    expect(cvssSeverity(7)).toBe('high')
    expect(cvssSeverity(6.9)).toBe('medium')
    expect(cvssSeverity(4)).toBe('medium')
    expect(cvssSeverity(3.9)).toBe('low')
    expect(cvssSeverity(0)).toBe('low')
  })
})

describe('slaDays', () => {
  it('gives tighter deadlines to worse severities', () => {
    expect(slaDays('critical')).toBe(7)
    expect(slaDays('high')).toBe(14)
    expect(slaDays('medium')).toBe(30)
    expect(slaDays('low')).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

describe('scanFleet', () => {
  it('is deterministic for the same fleet, seed and dispositions', () => {
    expect(scanFleet(DEVICES, SEED)).toEqual(scanFleet(DEVICES, SEED))
  })

  it('only flags device types listed in the CVE product list', () => {
    const byId = new Map(CVE_CATALOG.map((cve) => [cve.id, cve]))
    for (const vuln of scanFleet(DEVICES, SEED)) {
      const cve = byId.get(vuln.cveId)!
      expect(cve.products).toContain(vuln.deviceType)
    }
  })

  it('produces a stable id and no duplicates', () => {
    const vulns = scanFleet(DEVICES, SEED)
    expect(vulns.length).toBeGreaterThan(0)
    const ids = new Set(vulns.map((vuln) => vuln.id))
    expect(ids.size).toBe(vulns.length)
    expect(vulns[0]!.id).toBe(vulnId(vulns[0]!.deviceId, vulns[0]!.cveId))
  })

  it('derives severity from CVSS and defaults every finding to open', () => {
    for (const vuln of scanFleet(DEVICES, SEED)) {
      expect(vuln.severity).toBe(cvssSeverity(vuln.cvss))
      expect(vuln.status).toBe('open')
      expect(vuln.firstSeenDaysAgo).toBeGreaterThanOrEqual(
        vuln.publishedDaysAgo,
      )
      expect(vuln.firstSeenDaysAgo).toBeLessThanOrEqual(
        vuln.publishedDaysAgo + 20,
      )
    }
  })

  it('returns an empty scan for an empty fleet', () => {
    expect(scanFleet([], SEED)).toEqual([])
  })
})

describe('withStatus', () => {
  it('overlays persisted statuses without mutating the input', () => {
    const scan = scanFleet(DEVICES, SEED)
    const target = scan[0]!
    const overlay = withStatus(scan, { [target.id]: 'patched' })
    expect(scan[0]!.status).toBe('open')
    expect(overlay[0]!.status).toBe('patched')
    const untouched = overlay.filter((vuln) => vuln.id !== target.id)
    expect(untouched.every((vuln) => vuln.status === 'open')).toBe(true)
  })

  it('ignores unknown ids', () => {
    const scan = scanFleet(DEVICES, SEED)
    expect(withStatus(scan, { 'nope:CVE-1': 'patched' })).toEqual(scan)
  })
})

// ---------------------------------------------------------------------------
// SLA helpers
// ---------------------------------------------------------------------------

describe('isOverdue / dueInDays', () => {
  const base = scanFleet(DEVICES, SEED)[0]!

  it('flags open findings past their SLA only', () => {
    const overdue: typeof base = {
      ...base,
      status: 'open',
      severity: 'critical',
      firstSeenDaysAgo: 30,
    }
    expect(isOverdue(overdue)).toBe(true)
    expect(dueInDays(overdue)).toBe(-23)
    expect(isOverdue({ ...overdue, status: 'patched' })).toBe(false)
    expect(isOverdue({ ...overdue, firstSeenDaysAgo: 3 })).toBe(false)
    expect(dueInDays({ ...overdue, firstSeenDaysAgo: 3 })).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

describe('patchQueue', () => {
  it('contains only open findings, exploits first then CVSS desc', () => {
    const queue = patchQueue(scanFleet(DEVICES, SEED))
    expect(queue.length).toBeGreaterThan(0)
    expect(queue.every((vuln) => vuln.status === 'open')).toBe(true)
    const firstExploit = queue.findIndex((vuln) => vuln.exploitAvailable)
    const lastExploit = queue.map((v) => v.exploitAvailable).lastIndexOf(true)
    expect(firstExploit).toBeLessThanOrEqual(lastExploit)
    for (let i = 1; i <= lastExploit; i += 1) {
      expect(queue[i]!.cvss).toBeLessThanOrEqual(queue[i - 1]!.cvss)
    }
  })

  it('drops findings once they are patched', () => {
    const scan = scanFleet(DEVICES, SEED)
    const statuses = Object.fromEntries(
      scan.map((vuln) => [vuln.id, 'patched' as const]),
    )
    expect(patchQueue(withStatus(scan, statuses))).toEqual([])
  })
})

describe('vulnerabilityWeight', () => {
  it('doubles the weight of exploited findings', () => {
    const scan = scanFleet(DEVICES, SEED)
    const plain = scan.find((vuln) => !vuln.exploitAvailable)
    const exploited = scan.find((vuln) => vuln.exploitAvailable)
    if (plain && exploited) {
      expect(vulnerabilityWeight(exploited)).toBe(exploited.cvss * 2)
      expect(vulnerabilityWeight(plain)).toBe(plain.cvss)
    }
    expect(vulnerabilityWeight({ ...scan[0]!, exploitAvailable: true })).toBe(
      scan[0]!.cvss * 2,
    )
  })
})

describe('deviceRisk', () => {
  it('aggregates open findings per device and sorts by risk', () => {
    const rows = deviceRisk(scanFleet(DEVICES, SEED))
    expect(rows.length).toBeGreaterThan(0)
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.risk).toBeLessThanOrEqual(rows[i - 1]!.risk)
    }
    const totalOpen = rows.reduce((sum, row) => sum + row.open, 0)
    const summary = vulnSummary(scanFleet(DEVICES, SEED))
    expect(totalOpen).toBe(summary.open)
  })

  it('ignores findings that were patched', () => {
    const scan = scanFleet(DEVICES, SEED)
    const statuses = Object.fromEntries(
      scan.map((vuln) => [vuln.id, 'patched' as const]),
    )
    expect(deviceRisk(withStatus(scan, statuses))).toEqual([])
  })
})

describe('unpatchableFindings', () => {
  it('returns only open findings with no vendor patch', () => {
    const rows = unpatchableFindings(scanFleet(DEVICES, SEED))
    for (const row of rows) {
      expect(row.status).toBe('open')
      expect(row.patchAvailable).toBe(false)
    }
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.cvss).toBeLessThanOrEqual(rows[i - 1]!.cvss)
    }
  })
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('vulnSummary', () => {
  it('counts every status exactly once and scores in bounds', () => {
    const vulns = scanFleet(DEVICES, SEED)
    const summary = vulnSummary(vulns)
    expect(summary.total).toBe(vulns.length)
    expect(summary.open + summary.patched + summary.accepted).toBe(vulns.length)
    expect(summary.score).toBeGreaterThanOrEqual(0)
    expect(summary.score).toBeLessThanOrEqual(100)
    expect(['healthy', 'degraded', 'critical']).toContain(summary.grade)
    expect(summary.meanAgeDays).toBeGreaterThanOrEqual(0)
  })

  it('computes patch compliance over actionable findings', () => {
    const scan = scanFleet(DEVICES, SEED)
    const half = Math.floor(scan.length / 2)
    const statuses = Object.fromEntries(
      scan.map((vuln, index) => [
        vuln.id,
        index < half ? ('patched' as const) : ('open' as const),
      ]),
    )
    const summary = vulnSummary(withStatus(scan, statuses))
    expect(summary.patched).toBe(half)
    expect(summary.patchCompliancePct).toBeCloseTo(
      (half / scan.length) * 100,
      1,
    )
  })

  it('is zero-safe on empty input', () => {
    const summary = vulnSummary([])
    expect(summary).toMatchObject({
      total: 0,
      open: 0,
      patchCompliancePct: 0,
      score: 100,
      grade: 'healthy',
    })
    expect(summary.overdue).toBe(0)
    expect(summary.meanAgeDays).toBe(0)
  })

  it('rewards remediation: score rises as findings are patched', () => {
    const scan = scanFleet(DEVICES, SEED)
    const before = vulnSummary(scan)
    const statuses = Object.fromEntries(
      scan.map((vuln) => [vuln.id, 'patched' as const]),
    )
    const after = vulnSummary(withStatus(scan, statuses))
    expect(after.open).toBe(0)
    expect(after.score).toBeGreaterThan(before.score)
    expect(after.score).toBe(100)
  })
})

describe('severity helper round-trip', () => {
  it('every catalogue CVE maps to a known severity label', () => {
    for (const cve of CVE_CATALOG) {
      const severity: Severity = cvssSeverity(cve.cvss)
      expect(['critical', 'high', 'medium', 'low']).toContain(severity)
    }
  })
})
