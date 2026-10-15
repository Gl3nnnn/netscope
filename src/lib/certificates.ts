/**
 * Certificate & secret-expiry manager.
 *
 * Seeds a deterministic certificate inventory for the fleet (issuers, key
 * material, SANs, expiry), derives findings (expired, expiring, weak keys,
 * self-signed) and computes expiry buckets / compliance. Renewal is a pure
 * transformation — the store persists the result and files a CAB change.
 */
import type { Device, Severity } from '@/types'
import { clamp, round } from '@/lib/format'
import { hashSeed } from '@/simulation/random'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type CertIssuer =
  'Internal-CA' | "Let's Encrypt" | 'DigiCert' | 'Self-signed'
export type CertKind = 'server' | 'client' | 'mutual' | 'ca'
export type KeyType = 'RSA' | 'ECDSA'

export interface Certificate {
  /** Deterministic: `cert-<deviceId>-<n>`. */
  id: string
  deviceId: string
  deviceName: string
  site: string
  commonName: string
  sans: string[]
  issuer: CertIssuer
  kind: CertKind
  keyType: KeyType
  /** RSA: 1024/2048/4096. ECDSA: 256/384. */
  keyBits: number
  notBeforeDaysAgo: number
  /** Negative = already expired. */
  daysToExpiry: number
  autoRenew: boolean
}

export type CertFindingKind =
  'expired' | 'expiring' | 'weak-key' | 'self-signed'

export interface CertFinding {
  /** `<certId>:<kind>` — stable across regeneration. */
  id: string
  certId: string
  deviceId: string
  deviceName: string
  kind: CertFindingKind
  severity: Severity
  message: string
}

export interface CertSummary {
  total: number
  healthy: number
  expiring: number
  expired: number
  weakKeys: number
  selfSigned: number
  /** % of inventory that is healthy (expiry >30 d, strong key, trusted CA). */
  compliancePct: number
  /** Most urgent days-to-expiry (negative when something expired). */
  urgentDays: number
  score: number
  grade: 'healthy' | 'degraded' | 'critical'
}

export interface ExpiryBuckets {
  expired: number
  week: number
  month: number
  quarter: number
  later: number
}

export type CertOverrides = Record<
  string,
  Partial<Pick<Certificate, 'daysToExpiry' | 'notBeforeDaysAgo' | 'autoRenew'>>
>

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export const FINDING_LABELS: Record<CertFindingKind, string> = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  'weak-key': 'Weak key',
  'self-signed': 'Self-signed',
}

export const ISSUER_LABELS: Record<CertIssuer, string> = {
  'Internal-CA': 'Internal CA',
  "Let's Encrypt": "Let's Encrypt",
  DigiCert: 'DigiCert',
  'Self-signed': 'Self-signed',
}

export const KIND_LABELS: Record<CertKind, string> = {
  server: 'Server',
  client: 'Client',
  mutual: 'mTLS',
  ca: 'CA',
}

/** Expiry thresholds in days. */
export const EXPIRING_SOON_DAYS = 30
export const CRITICAL_EXPIRY_DAYS = 7
/** Baseline key strength. */
export const MIN_RSA_BITS = 2048
export const MIN_ECDSA_BITS = 256

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function issuerFor(roll: number): CertIssuer {
  if (roll < 45) return 'Internal-CA'
  if (roll < 78) return "Let's Encrypt"
  if (roll < 92) return 'DigiCert'
  return 'Self-signed'
}

function kindFor(roll: number): CertKind {
  if (roll < 62) return 'server'
  if (roll < 80) return 'client'
  if (roll < 95) return 'mutual'
  return 'ca'
}

/** Deterministic inventory: 1–3 certificates per device. */
export function seedCertificates(
  devices: Device[],
  seed: number,
): Certificate[] {
  const certs: Certificate[] = []

  for (const device of devices) {
    const count = 1 + (hashSeed(`${device.id}:${seed}:count`) % 3)
    const siteSlug = slug(device.site)
    for (let n = 0; n < count; n += 1) {
      const key = `${device.id}:${seed}:${n}`
      const h = hashSeed(key)
      const issuer = issuerFor(h % 100)
      const kind = kindFor((h >>> 8) % 100)
      const keyRoll = (h >>> 16) % 100
      const keyType: KeyType = keyRoll < 65 ? 'RSA' : 'ECDSA'
      const keyBits =
        keyType === 'RSA'
          ? h % 13 === 0
            ? 1024
            : (h >>> 4) % 2 === 0
              ? 2048
              : 4096
          : (h >>> 6) % 3 === 0
            ? 384
            : 256
      // A slice of the inventory is already expired; the rest spreads to 2 y.
      const expiryRoll = (h >>> 12) % 23
      const daysToExpiry =
        expiryRoll === 0 ? -(1 + (h % 45)) : 1 + ((h >>> 3) % 720)
      const notBeforeDaysAgo = 30 + (h % 500)
      const commonName =
        kind === 'ca'
          ? `${siteSlug}-root-ca`
          : `${slug(device.name)}.${siteSlug}.internal`
      const sans = [
        commonName,
        `*.${siteSlug}.internal`,
        kind === 'server' || kind === 'mutual'
          ? `www.${slug(device.name)}.net`
          : `${slug(device.name)}-svc.${siteSlug}.internal`,
      ]

      certs.push({
        id: `cert-${device.id}-${n}`,
        deviceId: device.id,
        deviceName: device.name,
        site: device.site,
        commonName,
        sans,
        issuer,
        kind,
        keyType,
        keyBits,
        notBeforeDaysAgo,
        daysToExpiry,
        autoRenew: issuer === "Let's Encrypt" || h % 3 === 0,
      })
    }
  }

  return certs.sort(
    (a, b) =>
      a.daysToExpiry - b.daysToExpiry ||
      a.deviceName.localeCompare(b.deviceName) ||
      a.id.localeCompare(b.id),
  )
}

/** Overlay persisted renewals without mutating the input. */
export function withOverrides(
  certs: Certificate[],
  overrides: CertOverrides,
): Certificate[] {
  return certs.map((cert) => {
    const patch = overrides[cert.id]
    return patch ? { ...cert, ...patch } : cert
  })
}

/** Pure renewal: reissue today with a one-year lifetime. */
export function renewCertificate(cert: Certificate): Certificate {
  return { ...cert, notBeforeDaysAgo: 0, daysToExpiry: 365, autoRenew: true }
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function keyStrengthOk(cert: Certificate): boolean {
  return cert.keyType === 'RSA'
    ? cert.keyBits >= MIN_RSA_BITS
    : cert.keyBits >= MIN_ECDSA_BITS
}

function isHealthy(cert: Certificate): boolean {
  return (
    cert.daysToExpiry > EXPIRING_SOON_DAYS &&
    keyStrengthOk(cert) &&
    cert.issuer !== 'Self-signed'
  )
}

export function certFindings(certs: Certificate[]): CertFinding[] {
  const findings: CertFinding[] = []
  const add = (
    cert: Certificate,
    kind: CertFindingKind,
    severity: Severity,
    message: string,
  ) => {
    findings.push({
      id: `${cert.id}:${kind}`,
      certId: cert.id,
      deviceId: cert.deviceId,
      deviceName: cert.deviceName,
      kind,
      severity,
      message,
    })
  }

  for (const cert of certs) {
    if (cert.daysToExpiry < 0) {
      add(
        cert,
        'expired',
        'critical',
        `${cert.commonName} expired ${Math.abs(cert.daysToExpiry)} days ago`,
      )
    } else if (cert.daysToExpiry <= CRITICAL_EXPIRY_DAYS) {
      add(
        cert,
        'expiring',
        'high',
        `${cert.commonName} expires in ${cert.daysToExpiry} days`,
      )
    } else if (cert.daysToExpiry <= EXPIRING_SOON_DAYS) {
      add(
        cert,
        'expiring',
        'medium',
        `${cert.commonName} expires in ${cert.daysToExpiry} days`,
      )
    }

    if (!keyStrengthOk(cert)) {
      add(
        cert,
        'weak-key',
        'high',
        `${cert.keyType}-${cert.keyBits} key below the ${
          cert.keyType === 'RSA' ? MIN_RSA_BITS : MIN_ECDSA_BITS
        }-bit baseline`,
      )
    }

    if (cert.issuer === 'Self-signed') {
      add(
        cert,
        'self-signed',
        'medium',
        `${cert.commonName} chains to a self-signed root`,
      )
    }
  }

  const rank: Record<Severity, number> = {
    critical: 3,
    high: 2,
    medium: 1,
    low: 0,
  }
  return findings.sort(
    (a, b) =>
      rank[b.severity] - rank[a.severity] ||
      a.deviceName.localeCompare(b.deviceName) ||
      a.id.localeCompare(b.id),
  )
}

// ---------------------------------------------------------------------------
// Buckets & summary
// ---------------------------------------------------------------------------

export function expiryBuckets(certs: Certificate[]): ExpiryBuckets {
  const buckets: ExpiryBuckets = {
    expired: 0,
    week: 0,
    month: 0,
    quarter: 0,
    later: 0,
  }
  for (const cert of certs) {
    if (cert.daysToExpiry < 0) buckets.expired += 1
    else if (cert.daysToExpiry <= 7) buckets.week += 1
    else if (cert.daysToExpiry <= EXPIRING_SOON_DAYS) buckets.month += 1
    else if (cert.daysToExpiry <= 90) buckets.quarter += 1
    else buckets.later += 1
  }
  return buckets
}

export function certSummary(certs: Certificate[]): CertSummary {
  let healthy = 0
  let expiring = 0
  let expired = 0
  let weakKeys = 0
  let selfSigned = 0
  let urgentDays = Number.POSITIVE_INFINITY

  for (const cert of certs) {
    if (isHealthy(cert)) healthy += 1
    if (cert.daysToExpiry < 0) expired += 1
    else if (cert.daysToExpiry <= EXPIRING_SOON_DAYS) expiring += 1
    if (!keyStrengthOk(cert)) weakKeys += 1
    if (cert.issuer === 'Self-signed') selfSigned += 1
    urgentDays = Math.min(urgentDays, cert.daysToExpiry)
  }

  const compliancePct =
    certs.length > 0 ? round((healthy / certs.length) * 100, 1) : 100
  const score = clamp(
    Math.round(
      100 - (expired * 18 + expiring * 5 + weakKeys * 10 + selfSigned * 6),
    ),
    0,
    100,
  )

  return {
    total: certs.length,
    healthy,
    expiring,
    expired,
    weakKeys,
    selfSigned,
    compliancePct,
    urgentDays: Number.isFinite(urgentDays) ? urgentDays : 365,
    score,
    grade: score >= 80 ? 'healthy' : score >= 55 ? 'degraded' : 'critical',
  }
}
