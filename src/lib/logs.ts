/**
 * Log Analytics engine.
 *
 * Deterministic syslog-style pipeline: synthesises log lines from the live
 * timeline event stream plus per-device application logs, clusters them into
 * message patterns (numeric/IP tokens normalised away) and answers simple
 * search queries.
 *
 * Pure and dependency-free — pass devices + timeline events + a tick and get
 * a bounded, ordered tail back.
 */
import type { Device, EventType, Severity, TimelineEvent } from '@/types'
import { clamp, round } from '@/lib/format'
import { hashSeed } from '@/simulation/random'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type LogLevel =
  'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'

export type LogFacility =
  | 'auth'
  | 'system'
  | 'network'
  | 'bgp'
  | 'ospf'
  | 'ssl'
  | 'dhcp'
  | 'config'
  | 'audit'

export interface LogEntry {
  id: string
  /** Epoch ms. */
  t: number
  deviceId: string | null
  deviceName: string
  site: string
  facility: LogFacility
  /** Syslog process tag (sshd, bgpd, …). */
  process: string
  severity: LogLevel
  message: string
  /** Pattern id: hash of the message with tokens normalised out. */
  fingerprint: string
}

export interface LogPattern {
  fingerprint: string
  template: string
  count: number
  severity: LogLevel
  lastSeen: number
  sample: string
}

export interface LogSummary {
  total: number
  byLevel: Record<LogLevel, number>
  byFacility: Record<LogFacility, number>
  /** (error + critical) / total, 0..1. */
  errorRatio: number
  errorCount: number
  warningCount: number
  windowFrom: number
  windowTo: number
}

export interface LogBucket {
  t: number
  total: number
  counts: Record<LogLevel, number>
}

export interface LogQuery {
  levels: LogLevel[]
  site: string | null
  deviceId: string | null
  facility: LogFacility | null
  /** Lower-cased free text matched against the message. */
  text: string | null
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/** Newest-first order helper (higher = more severe). */
export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
}

export const LOG_LEVELS: LogLevel[] = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
]

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'Debug',
  info: 'Info',
  notice: 'Notice',
  warning: 'Warning',
  error: 'Error',
  critical: 'Critical',
}

export const FACILITY_LABELS: Record<LogFacility, string> = {
  auth: 'Authentication',
  system: 'System',
  network: 'Network',
  bgp: 'BGP',
  ospf: 'OSPF',
  ssl: 'TLS/SSL',
  dhcp: 'DHCP',
  config: 'Config',
  audit: 'Audit',
}

export const FACILITY_PROCESS: Record<LogFacility, string> = {
  auth: 'sshd',
  system: 'systemd',
  network: 'kernel',
  bgp: 'bgpd',
  ospf: 'ospfd',
  ssl: 'nginx',
  dhcp: 'dhcpd',
  config: 'cfgd',
  audit: 'auditd',
}

/** Facilities an event type maps onto. */
const EVENT_FACILITY: Record<EventType, LogFacility> = {
  status: 'system',
  incident: 'network',
  device: 'system',
  config: 'config',
}

/** Timeline severity → log level. */
export const SEVERITY_LOG_LEVEL: Record<Severity, LogLevel> = {
  critical: 'critical',
  high: 'error',
  medium: 'warning',
  low: 'notice',
}

/** Synthetic tail window (ms) used when generating the log stream. */
export const LOG_WINDOW_MS = 30 * 60_000

/** Hard cap on generated entries; the page renders a slice of these. */
export const MAX_LOG_ENTRIES = 1200

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

const IP_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const MAC_RE = /\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\b/g
const NUM_RE = /\b\d+(?:\.\d+)?\b/g
const HEX_RE = /\b0x[0-9a-fA-F]+\b/g

/**
 * Normalise a raw message into a pattern template: addresses, MACs and
 * numbers collapse into stable tokens so variants share a fingerprint.
 */
export function patternTemplate(message: string): string {
  return message
    .replace(MAC_RE, '<MAC>')
    .replace(IP_RE, '<IP>')
    .replace(HEX_RE, '<HEX>')
    .replace(NUM_RE, '<NUM>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Stable pattern id for a raw message. */
export function fingerprintOf(message: string): string {
  return hashSeed(patternTemplate(message)).toString(36)
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateLogsInput {
  devices: Device[]
  /** Existing timeline events (status/incident/device/config). */
  events: TimelineEvent[]
  /** Tick time (typically `lastTick`). */
  now: number
  seed: number
}

const DEVICE_FACILITIES: Record<Device['type'], LogFacility[]> = {
  router: ['bgp', 'ospf', 'network', 'system'],
  firewall: ['auth', 'ssl', 'network', 'audit'],
  switch: ['network', 'system', 'dhcp'],
  server: ['auth', 'ssl', 'dhcp', 'system'],
  accessPoint: ['dhcp', 'auth', 'system'],
}

function ipFor(seedKey: string): string {
  const h = hashSeed(seedKey)
  return `10.${(h >>> 8) & 255}.${h & 255}.${(((h >>> 16) & 255) % 254) + 1}`
}

function lineFor(facility: LogFacility, seedKey: string): string {
  const h = hashSeed(seedKey)
  const ip = ipFor(`${seedKey}:ip`)
  const pid = 100 + (h % 899)
  const iface = `et${h % 4}`
  switch (facility) {
    case 'bgp':
      return h % 2 === 0
        ? `BGP neighbor ${ip} state Established -> Idle (hold timer expired)`
        : `%BGP-5-ADJCHANGE: neighbor ${ip} Down by peer, vrf default`
    case 'ospf':
      return h % 2 === 0
        ? `OSPF neighbor ${ip} on ${iface} state FULL -> 2WAY (dead timer elapsed)`
        : `OSPF-5-ADJCHG: process 1, NBR ${ip} on ${iface} to Down`
    case 'auth':
      return h % 3 === 0
        ? `Failed password for invalid user admin from ${ip} port ${40000 + (h % 20000)} ssh2`
        : `Accepted publickey for ops from ${ip} port ${40000 + (h % 20000)} ssh2`
    case 'ssl':
      return h % 2 === 0
        ? `TLS handshake failed for ${ip}: certificate verify error (unable to get local issuer)`
        : `TLSv1.3 handshake complete (cipher TLS_AES_256_GCM_SHA384, alpn h2)`
    case 'dhcp':
      return h % 2 === 0
        ? `DHCPACK on ${ip} to ${ipFor(`${seedKey}:mac`)} via ${iface}`
        : `DHCPDISCOVER from client 00:1a:2b:3c:4d:5e on ${iface}`
    case 'network':
      return h % 3 === 0
        ? `Interface ${iface} link down (carrier loss), speed 1000Mb/s full-duplex`
        : `Interface ${iface} link up, speed 1000Mb/s full-duplex, mtu 1500`
    case 'config':
      return h % 2 === 0
        ? `running-config changed by ops@${ip} (line ${1 + (h % 40)}: interface ${iface})`
        : `candidate config committed (revision ${1 + (h % 12)}, operator ops)`
    case 'audit':
      return h % 2 === 0
        ? `user "admin" updated firewall policy id ${1 + (h % 90)} (action allow)`
        : `user "audit" exported configuration snapshot (id ${1 + (h % 99)})`
    default:
      return h % 2 === 0
        ? `cpu utilization ${60 + (h % 39)}% exceeds threshold (pid ${pid})`
        : `memory pressure detected: reclaim ${1 + (h % 32)}MB (pid ${pid})`
  }
}

const LEVEL_FLOOR: Record<LogFacility, LogLevel> = {
  auth: 'info',
  system: 'info',
  network: 'notice',
  bgp: 'notice',
  ospf: 'notice',
  ssl: 'warning',
  dhcp: 'info',
  config: 'notice',
  audit: 'notice',
}

function levelFor(facility: LogFacility, seedKey: string): LogLevel {
  const h = hashSeed(seedKey)
  const floor = LOG_LEVEL_RANK[LEVEL_FLOOR[facility]]
  // Bias: mostly routine lines, a tail of warnings/errors.
  const roll = h % 100
  const rank = roll < 12 ? 4 : roll < 30 ? 3 : floor
  const level = LOG_LEVELS[clamp(rank, 0, 5)]!
  // Facilities like auth escalate to critical rarely.
  return level
}

/**
 * Build a deterministic log tail: timeline events first (authoritative),
 * then per-device application lines spread across the window.
 */
export function generateLogs(input: GenerateLogsInput): LogEntry[] {
  const { devices, events, now, seed } = input
  const byId = new Map(devices.map((device) => [device.id, device]))
  const entries: LogEntry[] = []

  for (const event of events) {
    const device = event.deviceId ? byId.get(event.deviceId) : undefined
    const severity = SEVERITY_LOG_LEVEL[event.severity ?? 'low']
    const facility = EVENT_FACILITY[event.type]
    entries.push({
      id: `log-evt-${event.id}`,
      t: event.timestamp,
      deviceId: device?.id ?? event.deviceId ?? null,
      deviceName: device?.name ?? 'netscope',
      site: device?.site ?? 'control',
      facility,
      process: FACILITY_PROCESS[facility],
      severity,
      message: event.message,
      fingerprint: fingerprintOf(event.message),
    })
  }

  for (const device of devices) {
    const facilities = DEVICE_FACILITIES[device.type]
    const deviceHash = hashSeed(`${device.id}:${seed}`)
    const lineCount = 2 + (deviceHash % 5) // 2..6 lines
    for (let i = 0; i < lineCount; i += 1) {
      const key = `${device.id}:${seed}:${i}`
      const h = hashSeed(key)
      const facility = facilities[h % facilities.length]!
      const message = lineFor(facility, key)
      // Offline devices keep logging through the window's first half only.
      const age = h % LOG_WINDOW_MS
      const offlineCut =
        device.status === 'offline' ? LOG_WINDOW_MS / 2 : LOG_WINDOW_MS
      const t = now - (age % offlineCut)
      entries.push({
        id: `log-${device.id}-${i}`,
        t,
        deviceId: device.id,
        deviceName: device.name,
        site: device.site,
        facility,
        process: FACILITY_PROCESS[facility],
        severity: levelFor(facility, `${key}:lvl`),
        message,
        fingerprint: fingerprintOf(message),
      })
    }
  }

  const capped = entries.slice(-MAX_LOG_ENTRIES)
  return capped.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
}

/** Keep only the newest `max` entries (already-ordered input assumed). */
export function trimLogs(
  entries: LogEntry[],
  max = MAX_LOG_ENTRIES,
): LogEntry[] {
  if (entries.length <= max) return entries
  return entries.slice(entries.length - max)
}

// ---------------------------------------------------------------------------
// Patterns & summaries
// ---------------------------------------------------------------------------

/** Cluster entries by fingerprint; sorted by volume (desc). */
export function topPatterns(entries: LogEntry[], n = 8): LogPattern[] {
  const map = new Map<string, LogPattern>()
  for (const entry of entries) {
    const existing = map.get(entry.fingerprint)
    if (existing) {
      existing.count += 1
      existing.lastSeen = Math.max(existing.lastSeen, entry.t)
      if (LOG_LEVEL_RANK[entry.severity] > LOG_LEVEL_RANK[existing.severity]) {
        existing.severity = entry.severity
      }
    } else {
      map.set(entry.fingerprint, {
        fingerprint: entry.fingerprint,
        template: patternTemplate(entry.message),
        count: 1,
        severity: entry.severity,
        lastSeen: entry.t,
        sample: entry.message,
      })
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.template.localeCompare(b.template))
    .slice(0, n)
}

export interface SourceCount {
  deviceId: string | null
  name: string
  count: number
}

/** Busiest log producers, sorted by volume (desc). */
export function topSources(entries: LogEntry[], n = 8): SourceCount[] {
  const map = new Map<string, SourceCount>()
  for (const entry of entries) {
    const key = entry.deviceId ?? entry.deviceName
    const existing = map.get(key)
    if (existing) existing.count += 1
    else
      map.set(key, {
        deviceId: entry.deviceId,
        name: entry.deviceName,
        count: 1,
      })
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n)
}

export function logSummary(entries: LogEntry[]): LogSummary {
  const byLevel = Object.fromEntries(
    LOG_LEVELS.map((level) => [level, 0]),
  ) as Record<LogLevel, number>
  const byFacility = Object.fromEntries(
    Object.keys(FACILITY_LABELS).map((key) => [key, 0]),
  ) as Record<LogFacility, number>

  let errorCount = 0
  let warningCount = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const entry of entries) {
    byLevel[entry.severity] += 1
    byFacility[entry.facility] += 1
    if (entry.severity === 'error' || entry.severity === 'critical')
      errorCount += 1
    if (entry.severity === 'warning') warningCount += 1
    min = Math.min(min, entry.t)
    max = Math.max(max, entry.t)
  }

  return {
    total: entries.length,
    byLevel,
    byFacility,
    errorRatio: entries.length > 0 ? round(errorCount / entries.length, 3) : 0,
    errorCount,
    warningCount,
    windowFrom: entries.length > 0 ? min : 0,
    windowTo: entries.length > 0 ? max : 0,
  }
}

/** Fixed-width severity buckets over [from, to). */
export function levelHistogram(
  entries: LogEntry[],
  from: number,
  to: number,
  bucketMs: number,
): LogBucket[] {
  if (bucketMs <= 0 || to <= from) return []
  const bucketCount = Math.max(1, Math.ceil((to - from) / bucketMs))
  const buckets: LogBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    t: from + i * bucketMs,
    total: 0,
    counts: Object.fromEntries(LOG_LEVELS.map((l) => [l, 0])) as Record<
      LogLevel,
      number
    >,
  }))
  for (const entry of entries) {
    const index = Math.floor((entry.t - from) / bucketMs)
    if (index < 0 || index >= buckets.length) continue
    const bucket = buckets[index]!
    bucket.counts[entry.severity] += 1
    bucket.total += 1
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Querying
// ---------------------------------------------------------------------------

const LEVEL_ALIASES: Record<string, LogLevel> = {
  debug: 'debug',
  info: 'info',
  notice: 'notice',
  warn: 'warning',
  warning: 'warning',
  err: 'error',
  error: 'error',
  crit: 'critical',
  critical: 'critical',
}

const FACILITY_KEYS = new Set(Object.keys(FACILITY_LABELS))

/**
 * Parse a small search string: `level:error facility:bgp site:hq device:rtr
 * free text…`. Unknown `key:value` pairs with a known key filter the field,
 * everything else joins into the free-text clause.
 */
export function parseLogQuery(raw: string): LogQuery {
  const query: LogQuery = {
    levels: [],
    site: null,
    deviceId: null,
    facility: null,
    text: null,
  }
  const textParts: string[] = []

  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const separator = token.indexOf(':')
    if (separator <= 0) {
      textParts.push(token)
      continue
    }
    const key = token.slice(0, separator).toLowerCase()
    const value = token.slice(separator + 1)
    if (key === 'level' || key === 'lvl') {
      const level = LEVEL_ALIASES[value.toLowerCase()]
      if (level && !query.levels.includes(level)) query.levels.push(level)
    } else if (key === 'site') {
      query.site = value.toLowerCase()
    } else if (key === 'device' || key === 'host') {
      query.deviceId = value.toLowerCase()
    } else if (key === 'facility' && FACILITY_KEYS.has(value.toLowerCase())) {
      query.facility = value.toLowerCase() as LogFacility
    } else {
      textParts.push(token)
    }
  }

  query.text = textParts.length > 0 ? textParts.join(' ').toLowerCase() : null
  return query
}

/** True when the query has no clauses (i.e. matches everything). */
export function isEmptyQuery(query: LogQuery): boolean {
  return (
    query.levels.length === 0 &&
    query.site === null &&
    query.deviceId === null &&
    query.facility === null &&
    query.text === null
  )
}

export function queryLogs(entries: LogEntry[], query: LogQuery): LogEntry[] {
  if (isEmptyQuery(query)) return entries
  return entries.filter((entry) => {
    if (query.levels.length > 0 && !query.levels.includes(entry.severity)) {
      return false
    }
    if (query.site !== null && !entry.site.toLowerCase().includes(query.site)) {
      return false
    }
    if (
      query.deviceId !== null &&
      !entry.deviceName.toLowerCase().includes(query.deviceId) &&
      !(entry.deviceId ?? '').toLowerCase().includes(query.deviceId)
    ) {
      return false
    }
    if (query.facility !== null && entry.facility !== query.facility) {
      return false
    }
    if (
      query.text !== null &&
      !entry.message.toLowerCase().includes(query.text)
    ) {
      return false
    }
    return true
  })
}
