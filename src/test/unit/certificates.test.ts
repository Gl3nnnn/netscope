import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  EXPIRING_SOON_DAYS,
  FINDING_LABELS,
  ISSUER_LABELS,
  KIND_LABELS,
  MIN_RSA_BITS,
  certFindings,
  certSummary,
  expiryBuckets,
  renewCertificate,
  seedCertificates,
  withOverrides,
  type Certificate,
} from '@/lib/certificates'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEED = 11

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
  makeDevice({ id: 'dev-2', name: 'fw-dc-01', type: 'firewall', site: 'DC-A' }),
  makeDevice({ id: 'dev-3', name: 'srv-app-01', type: 'server', site: 'DC-B' }),
  makeDevice({
    id: 'dev-4',
    name: 'ap-east-01',
    type: 'accessPoint',
    site: 'Branch - East',
  }),
  makeDevice({
    id: 'dev-5',
    name: 'sw-west-01',
    type: 'switch',
    site: 'Branch - West',
  }),
]

function makeCert(overrides: Partial<Certificate> = {}): Certificate {
  return {
    id: 'cert-dev-1-0',
    deviceId: 'dev-1',
    deviceName: 'rtr-hq-01',
    site: 'HQ - Floor 1',
    commonName: 'rtr-hq-01.hq-floor-1.internal',
    sans: ['rtr-hq-01.hq-floor-1.internal'],
    issuer: 'Internal-CA',
    kind: 'server',
    keyType: 'RSA',
    keyBits: 2048,
    notBeforeDaysAgo: 100,
    daysToExpiry: 200,
    autoRenew: false,
    ...overrides,
  }
}

const CERTS = seedCertificates(DEVICES, SEED)

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

describe('seedCertificates', () => {
  it('is deterministic and unique per device slot', () => {
    expect(seedCertificates(DEVICES, SEED)).toEqual(
      seedCertificates(DEVICES, SEED),
    )
    const ids = CERTS.map((cert) => cert.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('issues 1-3 certificates per device with resolvable metadata', () => {
    const devices = new Map(DEVICES.map((device) => [device.id, device]))
    const byDevice = new Map<string, number>()
    for (const cert of CERTS) {
      byDevice.set(cert.deviceId, (byDevice.get(cert.deviceId) ?? 0) + 1)
      const device = devices.get(cert.deviceId)!
      expect(cert.deviceName).toBe(device.name)
      expect(cert.site).toBe(device.site)
      expect(cert.sans[0]).toBe(cert.commonName)
      expect(cert.commonName.length).toBeGreaterThan(0)
      expect(ISSUER_LABELS[cert.issuer]).toBeTruthy()
      expect(KIND_LABELS[cert.kind]).toBeTruthy()
    }
    for (const count of byDevice.values()) {
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(3)
    }
    expect(byDevice.size).toBe(DEVICES.length)
  })

  it('always auto-renews Let’s Encrypt certificates', () => {
    for (const cert of CERTS) {
      if (cert.issuer === "Let's Encrypt") expect(cert.autoRenew).toBe(true)
    }
  })

  it('spreads expiry across expired and valid ranges', () => {
    const buckets = expiryBuckets(CERTS)
    expect(
      buckets.expired +
        buckets.week +
        buckets.month +
        buckets.quarter +
        buckets.later,
    ).toBe(CERTS.length)
    expect(
      buckets.week + buckets.month + buckets.quarter + buckets.later,
    ).toBeGreaterThan(0)
  })

  it('returns an empty inventory for an empty fleet', () => {
    expect(seedCertificates([], SEED)).toEqual([])
    expect(certSummary([])).toMatchObject({
      total: 0,
      compliancePct: 100,
      score: 100,
      grade: 'healthy',
    })
  })
})

// ---------------------------------------------------------------------------
// Overrides & renewal
// ---------------------------------------------------------------------------

describe('withOverrides / renewCertificate', () => {
  it('applies persisted overrides without mutating the inventory', () => {
    const patched = withOverrides(CERTS, {
      [CERTS[0]!.id]: { daysToExpiry: 365, notBeforeDaysAgo: 0 },
    })
    expect(CERTS[0]!.daysToExpiry).not.toBe(365)
    expect(patched[0]!.daysToExpiry).toBe(365)
    expect(patched[0]!.notBeforeDaysAgo).toBe(0)
  })

  it('reissues today for one year and enables auto-renew', () => {
    const expired = makeCert({ daysToExpiry: -12, autoRenew: false })
    const renewed = renewCertificate(expired)
    expect(renewed).toMatchObject({
      daysToExpiry: 365,
      notBeforeDaysAgo: 0,
      autoRenew: true,
    })
    expect(expired.daysToExpiry).toBe(-12)
    expect(renewed.id).toBe(expired.id)
  })

  it('ignores overrides for unknown ids', () => {
    expect(
      withOverrides(CERTS, { 'cert-nope-9': { daysToExpiry: 1 } }),
    ).toEqual(CERTS)
  })
})

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

describe('certFindings', () => {
  it('flags expired certificates as critical', () => {
    const findings = certFindings([makeCert({ daysToExpiry: -3 })])
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      kind: 'expired',
      severity: 'critical',
      id: 'cert-dev-1-0:expired',
    })
    expect(findings[0]!.message).toContain('expired 3 days ago')
  })

  it('maps expiring severity by urgency', () => {
    const soon = certFindings([makeCert({ daysToExpiry: 5 })])
    expect(soon[0]).toMatchObject({ kind: 'expiring', severity: 'high' })
    const later = certFindings([makeCert({ daysToExpiry: 21 })])
    expect(later[0]).toMatchObject({ kind: 'expiring', severity: 'medium' })
    const fine = certFindings([
      makeCert({ daysToExpiry: EXPIRING_SOON_DAYS + 1 }),
    ])
    expect(fine).toHaveLength(0)
  })

  it('flags RSA keys below the baseline only', () => {
    const weak = certFindings([makeCert({ keyType: 'RSA', keyBits: 1024 })])
    expect(weak[0]).toMatchObject({ kind: 'weak-key', severity: 'high' })
    expect(weak[0]!.message).toContain(`${MIN_RSA_BITS}-bit baseline`)
    const strong = certFindings([
      makeCert({ keyType: 'RSA', keyBits: MIN_RSA_BITS }),
    ])
    expect(strong).toHaveLength(0)
    const ecdsaWeak = certFindings([
      makeCert({ keyType: 'ECDSA', keyBits: 192 }),
    ])
    expect(ecdsaWeak[0]?.kind).toBe('weak-key')
  })

  it('flags self-signed issuers', () => {
    const findings = certFindings([makeCert({ issuer: 'Self-signed' })])
    expect(findings[0]).toMatchObject({
      kind: 'self-signed',
      severity: 'medium',
    })
  })

  it('labels every finding kind', () => {
    for (const kind of [
      'expired',
      'expiring',
      'weak-key',
      'self-signed',
    ] as const) {
      expect(FINDING_LABELS[kind].length).toBeGreaterThan(0)
    }
  })

  it('sorts worst findings first', () => {
    const findings = certFindings([
      makeCert({ id: 'cert-a', daysToExpiry: 100 }),
      makeCert({ id: 'cert-b', daysToExpiry: -1 }),
      makeCert({
        id: 'cert-c',
        daysToExpiry: 10,
        keyType: 'RSA',
        keyBits: 1024,
      }),
    ])
    const severities = findings.map((finding) => finding.severity)
    expect(severities[0]).toBe('critical')
    expect(severities).toContain('high')
    const ranks: Record<string, number> = {
      critical: 3,
      high: 2,
      medium: 1,
      low: 0,
    }
    for (let i = 1; i < findings.length; i += 1) {
      expect(ranks[findings[i]!.severity]).toBeLessThanOrEqual(
        ranks[findings[i - 1]!.severity]!,
      )
    }
  })

  it('produces stable finding ids linked back to the certificate', () => {
    const findings = certFindings(CERTS)
    expect(findings.length).toBeGreaterThan(0)
    const certIds = new Set(CERTS.map((cert) => cert.id))
    for (const finding of findings) {
      expect(finding.id).toBe(`${finding.certId}:${finding.kind}`)
      expect(certIds.has(finding.certId)).toBe(true)
      expect(finding.deviceName.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Buckets & summary
// ---------------------------------------------------------------------------

describe('expiryBuckets', () => {
  it('classifies each boundary', () => {
    const buckets = expiryBuckets([
      makeCert({ id: 'a', daysToExpiry: -5 }),
      makeCert({ id: 'b', daysToExpiry: 0 }),
      makeCert({ id: 'c', daysToExpiry: 7 }),
      makeCert({ id: 'd', daysToExpiry: 8 }),
      makeCert({ id: 'e', daysToExpiry: EXPIRING_SOON_DAYS }),
      makeCert({ id: 'f', daysToExpiry: EXPIRING_SOON_DAYS + 1 }),
      makeCert({ id: 'g', daysToExpiry: 90 }),
      makeCert({ id: 'h', daysToExpiry: 91 }),
    ])
    expect(buckets).toEqual({
      expired: 1,
      week: 2,
      month: 2,
      quarter: 2,
      later: 1,
    })
  })
})

describe('certSummary', () => {
  it('computes compliance over the healthy subset', () => {
    const summary = certSummary([
      makeCert({ id: 'a', daysToExpiry: 100 }),
      makeCert({ id: 'b', daysToExpiry: -2 }),
      makeCert({ id: 'c', daysToExpiry: 400, issuer: 'Self-signed' }),
      makeCert({ id: 'd', daysToExpiry: 400, keyType: 'RSA', keyBits: 1024 }),
    ])
    expect(summary.total).toBe(4)
    expect(summary.healthy).toBe(1)
    expect(summary.expired).toBe(1)
    expect(summary.expiring).toBe(0)
    expect(summary.weakKeys).toBe(1)
    expect(summary.selfSigned).toBe(1)
    expect(summary.compliancePct).toBe(25)
    expect(summary.urgentDays).toBe(-2)
    expect(summary.score).toBeLessThan(100)
    expect(summary.score).toBeGreaterThanOrEqual(0)
    expect(['healthy', 'degraded', 'critical']).toContain(summary.grade)
  })

  it('rewards renewal: a reissued inventory scores higher', () => {
    const inventory = CERTS.map((cert, index) =>
      index % 2 === 0 ? makeCert({ id: `x${index}`, daysToExpiry: -10 }) : cert,
    )
    const before = certSummary(inventory)
    const after = certSummary(
      inventory.map((cert) =>
        cert.daysToExpiry < 0 ? renewCertificate(cert) : cert,
      ),
    )
    expect(after.score).toBeGreaterThanOrEqual(before.score)
    expect(after.expired).toBe(0)
  })

  it('defaults urgentDays to a comfortable value when inventory is empty', () => {
    expect(certSummary([]).urgentDays).toBe(365)
  })
})
