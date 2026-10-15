/**
 * Vulnerability & patch-management engine.
 *
 * A fictional-but-plausible CVE catalogue is matched against the fleet by
 * device type using a deterministic per-seed roll, then ranked by exploit
 * availability, CVSS and age. Dispositions (patched / accepted risk) live in
 * the store — this module stays pure.
 */
import type { Device, DeviceType, Severity } from '@/types'
import { clamp, round } from '@/lib/format'
import { hashSeed } from '@/simulation/random'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type CveCategory =
  | 'rce'
  | 'dos'
  | 'privilege-escalation'
  | 'auth-bypass'
  | 'info-disclosure'
  | 'injection'

export type VulnStatus = 'open' | 'patched' | 'accepted'

export interface Cve {
  id: string
  title: string
  cvss: number
  vector: string
  category: CveCategory
  products: DeviceType[]
  patchAvailable: boolean
  exploitAvailable: boolean
  publishedDaysAgo: number
}

export interface Vulnerability {
  /** Stable across regenerations: `${deviceId}:${cveId}`. */
  id: string
  deviceId: string
  deviceName: string
  deviceType: DeviceType
  site: string
  cveId: string
  title: string
  cvss: number
  severity: Severity
  category: CveCategory
  patchAvailable: boolean
  exploitAvailable: boolean
  publishedDaysAgo: number
  firstSeenDaysAgo: number
  status: VulnStatus
}

export interface DeviceRisk {
  deviceId: string
  deviceName: string
  site: string
  open: number
  critical: number
  exploitable: number
  overdue: number
  /** Weighted exposure: cvss, doubled when an exploit is available. */
  risk: number
}

export interface VulnSummary {
  total: number
  open: number
  patched: number
  accepted: number
  critical: number
  exploitable: number
  overdue: number
  /** % of actionable (open + patched) findings that are patched. */
  patchCompliancePct: number
  meanAgeDays: number
  /** 0-100 exposure score; higher is worse after inversion. */
  score: number
  grade: 'healthy' | 'degraded' | 'critical'
}

// ---------------------------------------------------------------------------
// Reference data — fictional demo catalogue
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<CveCategory, string> = {
  rce: 'Remote code execution',
  dos: 'Denial of service',
  'privilege-escalation': 'Privilege escalation',
  'auth-bypass': 'Authentication bypass',
  'info-disclosure': 'Information disclosure',
  injection: 'Injection',
}

export const CVE_CATALOG: Cve[] = [
  {
    id: 'CVE-2026-10001',
    title: 'HTTP management interface buffer overflow',
    cvss: 9.8,
    vector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    category: 'rce',
    products: ['router'],
    patchAvailable: true,
    exploitAvailable: true,
    publishedDaysAgo: 46,
  },
  {
    id: 'CVE-2026-10002',
    title: 'OSPF HELLO spoofing via unauthenticated adjacency',
    cvss: 8.1,
    vector: 'AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
    category: 'auth-bypass',
    products: ['router'],
    patchAvailable: true,
    exploitAvailable: false,
    publishedDaysAgo: 73,
  },
  {
    id: 'CVE-2026-10003',
    title: 'CLI privilege escalation through crafted SNMP set',
    cvss: 8.8,
    vector: 'AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
    category: 'privilege-escalation',
    products: ['switch'],
    patchAvailable: true,
    exploitAvailable: true,
    publishedDaysAgo: 31,
  },
  {
    id: 'CVE-2026-10004',
    title: 'MAC table exhaustion denial of service',
    cvss: 7.5,
    vector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    category: 'dos',
    products: ['switch'],
    patchAvailable: true,
    exploitAvailable: false,
    publishedDaysAgo: 18,
  },
  {
    id: 'CVE-2026-10005',
    title: 'SSL inspection heap overflow in TLS parser',
    cvss: 9.6,
    vector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    category: 'rce',
    products: ['firewall'],
    patchAvailable: true,
    exploitAvailable: true,
    publishedDaysAgo: 12,
  },
  {
    id: 'CVE-2026-10006',
    title: 'VPN session table information disclosure',
    cvss: 5.3,
    vector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N',
    category: 'info-disclosure',
    products: ['firewall'],
    patchAvailable: false,
    exploitAvailable: false,
    publishedDaysAgo: 64,
  },
  {
    id: 'CVE-2026-10007',
    title: 'Predictable admin password-reset tokens',
    cvss: 8.2,
    vector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N',
    category: 'auth-bypass',
    products: ['firewall', 'server'],
    patchAvailable: true,
    exploitAvailable: true,
    publishedDaysAgo: 27,
  },
  {
    id: 'CVE-2026-10008',
    title: 'Container runtime escape via crafted image config',
    cvss: 9.9,
    vector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    category: 'rce',
    products: ['server'],
    patchAvailable: true,
    exploitAvailable: true,
    publishedDaysAgo: 9,
  },
  {
    id: 'CVE-2026-10009',
    title: 'Log ingestion SQL injection in search endpoint',
    cvss: 8.6,
    vector: 'AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H',
    category: 'injection',
    products: ['server'],
    patchAvailable: true,
    exploitAvailable: false,
    publishedDaysAgo: 41,
  },
  {
    id: 'CVE-2026-10010',
    title: 'TLS handshake memory amplification',
    cvss: 7.1,
    vector: 'AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L',
    category: 'dos',
    products: ['server'],
    patchAvailable: true,
    exploitAvailable: false,
    publishedDaysAgo: 22,
  },
  {
    id: 'CVE-2026-10011',
    title: 'Directory listing exposes session logs',
    cvss: 4.3,
    vector: 'AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N',
    category: 'info-disclosure',
    products: ['server', 'firewall'],
    patchAvailable: false,
    exploitAvailable: false,
    publishedDaysAgo: 88,
  },
  {
    id: 'CVE-2026-10012',
    title: 'Captive-portal WPA3 handshake downgrade',
    cvss: 7.8,
    vector: 'AV:A/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N',
    category: 'auth-bypass',
    products: ['accessPoint'],
    patchAvailable: true,
    exploitAvailable: false,
    publishedDaysAgo: 35,
  },
  {
    id: 'CVE-2026-10013',
    title: 'Client ARP table disclosure over mDNS',
    cvss: 5.5,
    vector: 'AV:A/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N',
    category: 'info-disclosure',
    products: ['accessPoint'],
    patchAvailable: false,
    exploitAvailable: false,
    publishedDaysAgo: 57,
  },
  {
    id: 'CVE-2026-10014',
    title: 'Beacon-flood CPU exhaustion on 2.4 GHz',
    cvss: 6.5,
    vector: 'AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H',
    category: 'dos',
    products: ['accessPoint'],
    patchAvailable: true,
    exploitAvailable: false,
    publishedDaysAgo: 15,
  },
]

/** Share of type-matching devices that report a given CVE. */
const MATCH_RATE = 62

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export function cvssSeverity(cvss: number): Severity {
  if (cvss >= 9) return 'critical'
  if (cvss >= 7) return 'high'
  if (cvss >= 4) return 'medium'
  return 'low'
}

/** Remediation SLA in days per severity. */
export function slaDays(severity: Severity): number {
  switch (severity) {
    case 'critical':
      return 7
    case 'high':
      return 14
    case 'medium':
      return 30
    default:
      return 90
  }
}

export function vulnId(deviceId: string, cveId: string): string {
  return `${deviceId}:${cveId}`
}

export function isOverdue(vuln: Vulnerability): boolean {
  return (
    vuln.status === 'open' && vuln.firstSeenDaysAgo > slaDays(vuln.severity)
  )
}

/** Days until the remediation SLA lapses (negative = overdue). */
export function dueInDays(vuln: Vulnerability): number {
  return slaDays(vuln.severity) - vuln.firstSeenDaysAgo
}

/** Overlay persisted dispositions onto freshly-scanned findings. */
export function withStatus(
  vulns: Vulnerability[],
  statuses: Record<string, VulnStatus>,
): Vulnerability[] {
  return vulns.map((vuln) => {
    const status = statuses[vuln.id]
    return status && status !== vuln.status ? { ...vuln, status } : vuln
  })
}

/**
 * Deterministically match CVEs against the fleet. A device is vulnerable to a
 * CVE when its type is in the product list and the seeded roll succeeds.
 */
export function scanFleet(
  devices: Device[],
  seed: number,
  statuses: Record<string, VulnStatus> = {},
): Vulnerability[] {
  const findings: Vulnerability[] = []

  for (const device of devices) {
    for (const cve of CVE_CATALOG) {
      if (!cve.products.includes(device.type)) continue
      const roll = hashSeed(`${device.id}:${cve.id}:${seed}`) % 100
      if (roll >= MATCH_RATE) continue

      const seenHash = hashSeed(`${device.id}:${cve.id}:age`)
      findings.push({
        id: vulnId(device.id, cve.id),
        deviceId: device.id,
        deviceName: device.name,
        deviceType: device.type,
        site: device.site,
        cveId: cve.id,
        title: cve.title,
        cvss: cve.cvss,
        severity: cvssSeverity(cve.cvss),
        category: cve.category,
        patchAvailable: cve.patchAvailable,
        exploitAvailable: cve.exploitAvailable,
        publishedDaysAgo: cve.publishedDaysAgo,
        firstSeenDaysAgo: cve.publishedDaysAgo + (seenHash % 21),
        status: 'open',
      })
    }
  }

  const overlay = withStatus(findings, statuses)
  return overlay.sort(
    (a, b) =>
      b.cvss - a.cvss ||
      a.deviceName.localeCompare(b.deviceName) ||
      a.cveId.localeCompare(b.cveId),
  )
}

// ---------------------------------------------------------------------------
// Rankings & summaries
// ---------------------------------------------------------------------------

export function patchQueue(vulns: Vulnerability[]): Vulnerability[] {
  return vulns
    .filter((vuln) => vuln.status === 'open')
    .slice()
    .sort(
      (a, b) =>
        Number(b.exploitAvailable) - Number(a.exploitAvailable) ||
        b.cvss - a.cvss ||
        b.firstSeenDaysAgo - a.firstSeenDaysAgo,
    )
}

export function vulnerabilityWeight(vuln: Vulnerability): number {
  return vuln.cvss * (vuln.exploitAvailable ? 2 : 1)
}

export function deviceRisk(vulns: Vulnerability[]): DeviceRisk[] {
  const map = new Map<string, DeviceRisk>()
  for (const vuln of vulns) {
    if (vuln.status !== 'open') continue
    const existing = map.get(vuln.deviceId)
    if (existing) {
      existing.open += 1
      if (vuln.severity === 'critical') existing.critical += 1
      if (vuln.exploitAvailable) existing.exploitable += 1
      if (isOverdue(vuln)) existing.overdue += 1
      existing.risk += vulnerabilityWeight(vuln)
    } else {
      map.set(vuln.deviceId, {
        deviceId: vuln.deviceId,
        deviceName: vuln.deviceName,
        site: vuln.site,
        open: 1,
        critical: vuln.severity === 'critical' ? 1 : 0,
        exploitable: vuln.exploitAvailable ? 1 : 0,
        overdue: isOverdue(vuln) ? 1 : 0,
        risk: vulnerabilityWeight(vuln),
      })
    }
  }
  return [...map.values()]
    .map((entry) => ({ ...entry, risk: round(entry.risk, 1) }))
    .sort(
      (a, b) =>
        b.risk - a.risk ||
        b.open - a.open ||
        a.deviceName.localeCompare(b.deviceName),
    )
}

export function vulnSummary(vulns: Vulnerability[]): VulnSummary {
  let open = 0
  let patched = 0
  let accepted = 0
  let critical = 0
  let exploitable = 0
  let overdue = 0
  let ageSum = 0

  for (const vuln of vulns) {
    if (vuln.status === 'open') open += 1
    else if (vuln.status === 'patched') patched += 1
    else accepted += 1
    if (vuln.status === 'open') {
      if (vuln.severity === 'critical') critical += 1
      if (vuln.exploitAvailable) exploitable += 1
      if (isOverdue(vuln)) overdue += 1
      ageSum += vuln.firstSeenDaysAgo
    }
  }

  const actionable = open + patched

  const score = clamp(
    Math.round(
      100 - (critical * 15 + exploitable * 8 + open * 2 + overdue * 4),
    ),
    0,
    100,
  )

  return {
    total: vulns.length,
    open,
    patched,
    accepted,
    critical,
    exploitable,
    overdue,
    patchCompliancePct:
      actionable > 0 ? round((patched / actionable) * 100, 1) : 0,
    meanAgeDays: open > 0 ? round(ageSum / open, 1) : 0,
    score,
    grade: score >= 80 ? 'healthy' : score >= 55 ? 'degraded' : 'critical',
  }
}

/** Highest-risk open findings that lack a patch — for the escalation panel. */
export function unpatchableFindings(vulns: Vulnerability[]): Vulnerability[] {
  return vulns
    .filter((vuln) => vuln.status === 'open' && !vuln.patchAvailable)
    .slice()
    .sort(
      (a, b) =>
        Number(b.exploitAvailable) - Number(a.exploitAvailable) ||
        b.cvss - a.cvss,
    )
}
