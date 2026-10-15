import type { Device, DeviceType, Severity } from '@/types'
import { hashSeed } from '@/simulation/random'

export type AuthMethod = 'eap-tls' | 'peap' | 'mab' | 'guest'
export type EndpointKind =
  'laptop' | 'phone' | 'printer' | 'camera' | 'iot' | 'server'
export type PostureStatus =
  'compliant' | 'noncompliant' | 'quarantined' | 'guest'
export type NacFindingKind =
  'auth-storm' | 'posture-fail' | 'mab-only' | 'guest-overstay'

export const METHOD_LABELS: Record<AuthMethod, string> = {
  'eap-tls': 'EAP-TLS',
  peap: 'PEAP (password)',
  mab: 'MAB (MAC bypass)',
  guest: 'Guest portal',
}

export const KIND_LABELS: Record<EndpointKind, string> = {
  laptop: 'Laptop',
  phone: 'IP phone',
  printer: 'Printer',
  camera: 'Camera',
  iot: 'IoT sensor',
  server: 'Server',
}

export const POSTURE_LABELS: Record<PostureStatus, string> = {
  compliant: 'Compliant',
  noncompliant: 'Noncompliant',
  quarantined: 'Quarantined',
  guest: 'Guest',
}

export interface PostureCheck {
  key: 'disk-encryption' | 'os-patch' | 'av-agent' | 'host-firewall'
  label: string
  passed: boolean
}

export interface Endpoint {
  id: string
  deviceId: string
  deviceName: string
  site: string
  kind: EndpointKind
  method: AuthMethod
  mac: string
  checks: PostureCheck[]
  posture: PostureStatus
  authFailures: number
  quarantined: boolean
}

export interface NacFinding {
  id: string
  kind: NacFindingKind
  site: string
  severity: Severity
  message: string
}

export interface NacSummary {
  endpoints: number
  compliant: number
  compliancePct: number
  quarantined: number
  authFailures: number
  eapTlsPct: number
  byMethod: Record<AuthMethod, number>
  byKind: Record<EndpointKind, number>
}

export interface NacResult {
  endpoints: Endpoint[]
  findings: NacFinding[]
  summary: NacSummary
}

const CHECKS: Array<PostureCheck['key']> = [
  'disk-encryption',
  'os-patch',
  'av-agent',
  'host-firewall',
]

const CHECK_LABELS: Record<PostureCheck['key'], string> = {
  'disk-encryption': 'Disk encryption',
  'os-patch': 'OS patch level',
  'av-agent': 'AV agent',
  'host-firewall': 'Host firewall',
}

const KINDS_BY_DEVICE: Partial<Record<DeviceType, EndpointKind[]>> = {
  server: ['server', 'laptop'],
  accessPoint: ['phone', 'laptop', 'iot'],
}

const ALL_KINDS: EndpointKind[] = [
  'laptop',
  'phone',
  'printer',
  'camera',
  'iot',
  'server',
]

const PORTABLE_KINDS: EndpointKind[] = ['laptop', 'phone']

function pick<T>(items: readonly T[], h: number): T {
  return items[h % items.length]!
}

function methodFor(kind: EndpointKind, h: number): AuthMethod {
  if (kind === 'printer' || kind === 'camera' || kind === 'iot') {
    return h % 10 < 8 ? 'mab' : 'eap-tls'
  }
  const roll = h % 10
  if (roll < 5) return 'eap-tls'
  if (roll < 8) return 'peap'
  if (roll < 9) return 'mab'
  return 'guest'
}

function checksFor(
  kind: EndpointKind,
  id: string,
  seed: number,
): PostureCheck[] {
  return CHECKS.map((key) => {
    let passed = hashSeed(`${seed}|nac|${id}|${key}`) % 100 >= 25
    if (
      (key === 'av-agent' || key === 'disk-encryption') &&
      (kind === 'iot' || kind === 'printer' || kind === 'camera')
    ) {
      passed = false
    }
    if (key === 'disk-encryption' && kind === 'server') passed = true
    return { key, label: CHECK_LABELS[key], passed }
  })
}

function postureOf(
  method: AuthMethod,
  kind: EndpointKind,
  checks: PostureCheck[],
): PostureStatus {
  if (method === 'guest') return 'guest'
  if (kind === 'server') return 'compliant'
  return checks.every((check) => check.passed) ? 'compliant' : 'noncompliant'
}

function macFor(id: string, seed: number): string {
  const h = hashSeed(`${seed}|mac|${id}`)
  const bytes: string[] = []
  for (let i = 0; i < 6; i += 1) {
    bytes.push(
      (((h >>> (i * 4)) & 0xff) ^ (i * 37 + (seed & 0xff)))
        .toString(16)
        .padStart(2, '0'),
    )
  }
  return bytes.join(':')
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Seed the endpoint estate from the live fleet plus shared guest devices. */
export function generateEndpoints(
  devices: Device[],
  sites: readonly string[],
  seed: number,
): Endpoint[] {
  const endpoints: Endpoint[] = []

  for (const device of devices) {
    const count = 1 + (hashSeed(`nac:${device.id}:${seed}`) % 3)
    for (let n = 0; n < count; n += 1) {
      const id = `ep-${device.id}-${n + 1}`
      const h = hashSeed(`${id}|${seed}`)
      const pool = KINDS_BY_DEVICE[device.type] ?? ALL_KINDS
      const kind = pick(n === 0 && pool !== ALL_KINDS ? pool : ALL_KINDS, h)
      const method = methodFor(kind, h >>> 4)
      const checks = checksFor(kind, id, seed)
      endpoints.push({
        id,
        deviceId: device.id,
        deviceName: device.name,
        site: device.site,
        kind,
        method,
        mac: macFor(id, seed),
        checks,
        posture: postureOf(method, kind, checks),
        authFailures: (h >>> 9) % 8,
        quarantined: false,
      })
    }
  }

  for (const site of sites) {
    const guests = 2 + (hashSeed(`guest:${site}:${seed}`) % 4)
    for (let n = 0; n < guests; n += 1) {
      const id = `ep-guest-${slug(site)}-${n + 1}`
      const h = hashSeed(`${id}|${seed}`)
      const kind: EndpointKind = pick(PORTABLE_KINDS, h)
      const checks = checksFor(kind, id, seed)
      endpoints.push({
        id,
        deviceId: '',
        deviceName: 'Guest portal',
        site,
        kind,
        method: 'guest',
        mac: macFor(id, seed),
        checks,
        posture: 'guest',
        authFailures: (h >>> 9) % 3,
        quarantined: false,
      })
    }
  }

  return endpoints
}

/** Apply persisted quarantine state on top of a freshly generated estate. */
export function withQuarantine(
  endpoints: Endpoint[],
  quarantined: readonly string[],
): Endpoint[] {
  if (quarantined.length === 0) return endpoints
  const set = new Set(quarantined)
  return endpoints.map((endpoint) =>
    set.has(endpoint.id)
      ? { ...endpoint, quarantined: true, posture: 'quarantined' }
      : endpoint,
  )
}

export function nacFindings(
  endpoints: Endpoint[],
  sites: readonly string[],
): NacFinding[] {
  const findings: NacFinding[] = []

  for (const endpoint of endpoints) {
    if (endpoint.quarantined) continue
    if (endpoint.authFailures >= 5 && endpoint.method !== 'guest') {
      findings.push({
        id: `${endpoint.id}:auth-storm`,
        kind: 'auth-storm',
        site: endpoint.site,
        severity: 'high',
        message: `${endpoint.mac} (${endpoint.deviceName}) has ${endpoint.authFailures} consecutive auth failures`,
      })
    }
    if (
      endpoint.posture === 'noncompliant' &&
      PORTABLE_KINDS.includes(endpoint.kind)
    ) {
      const failed = endpoint.checks.filter((check) => !check.passed)
      findings.push({
        id: `${endpoint.id}:posture-fail`,
        kind: 'posture-fail',
        site: endpoint.site,
        severity: failed.length >= 3 ? 'high' : 'medium',
        message: `${endpoint.mac} failed ${failed.length} posture check(s) on ${endpoint.site}`,
      })
    }
    if (endpoint.method === 'mab' && endpoint.kind === 'server') {
      findings.push({
        id: `${endpoint.id}:mab-only`,
        kind: 'mab-only',
        site: endpoint.site,
        severity: 'critical',
        message: `${endpoint.deviceName} on ${endpoint.site} authenticates with MAB only (no 802.1X)`,
      })
    }
  }

  for (const site of sites) {
    const guestCount = endpoints.filter(
      (endpoint) => endpoint.site === site && endpoint.method === 'guest',
    ).length
    if (guestCount > 4) {
      findings.push({
        id: `guest:${site}:overstay`,
        kind: 'guest-overstay',
        site,
        severity: 'low',
        message: `${site}: ${guestCount} active guest sessions to expire`,
      })
    }
  }

  return findings
}

export function nacSummary(endpoints: Endpoint[]): NacSummary {
  const byMethod: Record<AuthMethod, number> = {
    'eap-tls': 0,
    peap: 0,
    mab: 0,
    guest: 0,
  }
  const byKind: Record<EndpointKind, number> = {
    laptop: 0,
    phone: 0,
    printer: 0,
    camera: 0,
    iot: 0,
    server: 0,
  }
  let compliant = 0
  let quarantined = 0
  let authFailures = 0
  let eapTls = 0
  for (const endpoint of endpoints) {
    byMethod[endpoint.method] += 1
    byKind[endpoint.kind] += 1
    if (endpoint.posture === 'compliant') compliant += 1
    if (endpoint.quarantined) quarantined += 1
    authFailures += endpoint.authFailures
    if (endpoint.method === 'eap-tls') eapTls += 1
  }
  const assessable = endpoints.filter(
    (endpoint) => endpoint.method !== 'guest',
  ).length
  return {
    endpoints: endpoints.length,
    compliant,
    compliancePct:
      assessable === 0 ? 100 : Math.round((compliant / assessable) * 1000) / 10,
    quarantined,
    authFailures,
    eapTlsPct:
      endpoints.length === 0
        ? 0
        : Math.round((eapTls / endpoints.length) * 1000) / 10,
    byMethod,
    byKind,
  }
}

export function postureBreakdown(
  endpoints: Endpoint[],
): Array<{ key: PostureCheck['key']; label: string; passPct: number }> {
  return CHECKS.map((key) => {
    const withCheck = endpoints.filter(
      (endpoint) => endpoint.method !== 'guest',
    )
    const passed = withCheck.filter(
      (endpoint) => endpoint.checks.find((check) => check.key === key)?.passed,
    ).length
    return {
      key,
      label: CHECK_LABELS[key],
      passPct:
        withCheck.length === 0
          ? 100
          : Math.round((passed / withCheck.length) * 1000) / 10,
    }
  })
}

/** Full NAC view for a seed: estate, findings and rollups. */
export function runNac(
  devices: Device[],
  sites: readonly string[],
  seed: number,
  quarantined: readonly string[] = [],
): NacResult {
  const endpoints = withQuarantine(
    generateEndpoints(devices, sites, seed),
    quarantined,
  )
  return {
    endpoints,
    findings: nacFindings(endpoints, sites),
    summary: nacSummary(endpoints),
  }
}
