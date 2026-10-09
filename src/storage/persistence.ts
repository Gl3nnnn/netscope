import type {
  BackupFile,
  BackupPayload,
  Device,
  DeviceType,
  Incident,
  MetricSample,
  PersistedState,
  Settings,
  TimelineEvent,
} from '@/types'
import { clamp, round } from '@/lib/format'
import { TYPE_PROFILES } from '@/simulation/profiles'

export const STORAGE_KEY = 'netscope'
export const STORAGE_VERSION = 2

const DEVICE_TYPES: readonly DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const MAC = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/

export function isValidIp(ip: string): boolean {
  return IPV4.test(ip.trim())
}

export function isValidMac(mac: string): boolean {
  return MAC.test(mac.trim())
}

export function isValidDeviceType(value: unknown): value is DeviceType {
  return (
    typeof value === 'string' &&
    (DEVICE_TYPES as readonly string[]).includes(value)
  )
}

export interface ImportResult {
  ok: boolean
  devices?: Device[]
  error?: string
}

function num(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback
}

/**
 * Validate and normalise a single raw imported device. Throws a descriptive
 * error when a required field is missing or malformed.
 */
function normalizeDevice(raw: unknown, index: number): Device {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`Device #${index + 1} is not an object.`)
  }
  const r = raw as Record<string, unknown>

  const name = typeof r.name === 'string' ? r.name.trim() : ''
  if (!name) throw new Error(`Device #${index + 1} is missing a "name".`)

  if (!isValidDeviceType(r.type)) {
    throw new Error(
      `Device #${index + 1} ("${name}") has an invalid "type". Expected one of: ${DEVICE_TYPES.join(', ')}.`,
    )
  }

  const ip = typeof r.ip === 'string' ? r.ip.trim() : ''
  if (!isValidIp(ip)) {
    throw new Error(
      `Device #${index + 1} ("${name}") has an invalid IPv4 "ip".`,
    )
  }

  const mac = typeof r.mac === 'string' ? r.mac.trim() : ''
  if (mac && !isValidMac(mac)) {
    throw new Error(`Device #${index + 1} ("${name}") has an invalid "mac".`)
  }

  const tags = Array.isArray(r.tags)
    ? r.tags.filter((t): t is string => typeof t === 'string')
    : [r.type]

  const now = Date.now()
  const availability = num(r.availabilityPct, 99.9, 0, 100)

  return {
    id: typeof r.id === 'string' && r.id ? r.id : `dev_import_${now}_${index}`,
    name,
    type: r.type,
    site:
      typeof r.site === 'string' && r.site.trim() ? r.site.trim() : 'Imported',
    ip,
    mac,
    status:
      r.status === 'online' || r.status === 'degraded' || r.status === 'offline'
        ? r.status
        : 'online',
    tags,
    latencyMs: round(num(r.latencyMs, 8, 0, 5000), 2),
    packetLossPct: round(num(r.packetLossPct, 0.1, 0, 100), 2),
    availabilityPct: round(availability, 3),
    throughputMbps: round(num(r.throughputMbps, 500, 0, 100000), 1),
    // Old persisted records predate the capacity field; default it by type
    // so utilisation never has to cope with a missing ceiling.
    capacityMbps: num(
      r.capacityMbps,
      TYPE_PROFILES[r.type].capacityMbps,
      10,
      400000,
    ),
    cpuPct: round(num(r.cpuPct, 40, 0, 100), 1),
    memoryPct: round(num(r.memoryPct, 45, 0, 100), 1),
    uptimeSec: num(r.uptimeSec, 3600, 0, Number.MAX_SAFE_INTEGER),
    lastSeen: num(r.lastSeen, now, 0, Number.MAX_SAFE_INTEGER),
    flapping: r.flapping === true,
    inMaintenance: r.inMaintenance === true,
  }
}

/**
 * Parse and validate a JSON import WITHOUT touching application state. Returns
 * a discriminated result so the caller can surface a friendly error.
 */
export function parseDeviceImport(text: string): ImportResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'The imported file is empty.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }

  let list: unknown
  if (Array.isArray(parsed)) {
    list = parsed
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { devices?: unknown }).devices)
  ) {
    list = (parsed as { devices: unknown[] }).devices
  } else {
    return {
      ok: false,
      error:
        'Expected a JSON array of devices or an object with a "devices" array.',
    }
  }

  const arr = list as unknown[]
  if (arr.length === 0)
    return { ok: false, error: 'No devices found to import.' }

  try {
    const devices = arr.map((raw, index) => normalizeDevice(raw, index))
    return { ok: true, devices }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : 'Import validation failed.',
    }
  }
}

export function exportDevicesJson(devices: Device[]): string {
  return JSON.stringify(
    { version: STORAGE_VERSION, exportedAt: new Date().toISOString(), devices },
    null,
    2,
  )
}

/** Basic shape validation for state loaded back from localStorage. */
export function isValidPersistedState(value: unknown): value is PersistedState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PersistedState>
  return (
    typeof v.version === 'number' &&
    Array.isArray(v.devices) &&
    Array.isArray(v.incidents) &&
    Array.isArray(v.events) &&
    typeof v.settings === 'object' &&
    v.settings !== null
  )
}

/** The slice of network state that is written to localStorage. */
export interface PersistedNetwork {
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
}

/**
 * Best-effort coercion of an unknown value into a valid device array. Invalid
 * entries are dropped rather than throwing, so a single corrupt record cannot
 * wipe an otherwise-recoverable persisted state during migration.
 */
export function coerceDevices(raw: unknown): Device[] {
  if (!Array.isArray(raw)) return []
  const devices: Device[] = []
  raw.forEach((item, index) => {
    try {
      devices.push(normalizeDevice(item, index))
    } catch {
      // Skip unrecoverable records.
    }
  })
  return devices
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * Validate and normalise a single raw history sample. Invalid fields fall back
 * to safe defaults so one corrupt record cannot poison a device's series.
 */
function normalizeSample(raw: unknown): MetricSample {
  const r =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  return {
    t: num(r.t, 0, 0, Number.MAX_SAFE_INTEGER),
    latencyMs: round(num(r.latencyMs, 0, 0, 5000), 2),
    packetLossPct: round(num(r.packetLossPct, 0, 0, 100), 2),
    availabilityPct: round(num(r.availabilityPct, 100, 0, 100), 3),
    throughputMbps: round(num(r.throughputMbps, 0, 0, 100000), 1),
    cpuPct: round(num(r.cpuPct, 0, 0, 100), 1),
    memoryPct: round(num(r.memoryPct, 0, 0, 100), 1),
  }
}

/**
 * Best-effort coercion of an unknown value into per-device history, keeping
 * the most recent `maxPoints` samples for each device. Corrupt series are
 * dropped rather than thrown.
 */
export function coerceHistory(
  raw: unknown,
  maxPoints: number,
): Record<string, MetricSample[]> {
  if (!raw || typeof raw !== 'object') return {}
  const limit = Math.max(1, Math.floor(maxPoints))
  const history: Record<string, MetricSample[]> = {}
  for (const [id, samples] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(samples)) continue
    const cleaned = samples.slice(-limit).map(normalizeSample)
    if (cleaned.length > 0) history[id] = cleaned
  }
  return history
}

/**
 * Normalise persisted network state across storage versions. Version 1 -> 2
 * only added optional `Device` flags, so the migration is defensive coercion
 * of every collection.
 */
export function migratePersistedNetwork(
  persisted: unknown,
  _fromVersion: number,
): PersistedNetwork {
  if (!persisted || typeof persisted !== 'object') {
    return { devices: [], incidents: [], events: [] }
  }
  const p = persisted as Record<string, unknown>
  return {
    devices: coerceDevices(p.devices),
    incidents: asArray<Incident>(p.incidents),
    events: asArray<TimelineEvent>(p.events),
  }
}

export function exportFullState(payload: BackupPayload): string {
  const file: BackupFile = {
    version: STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    ...payload,
  }
  return JSON.stringify(file, null, 2)
}

export interface FullStateImportResult {
  ok: boolean
  data?: BackupPayload
  error?: string
}

/** Defensive default used when a backup file omits or corrupts settings. */
const FALLBACK_SETTINGS: Settings = {
  theme: 'dark',
  refreshIntervalMs: 5000,
  simulationSpeed: 1,
  simulationRunning: true,
  incidentFrequency: 0.6,
  thresholds: { latencyMs: 60, packetLossPct: 2, availabilityPct: 99 },
  sidebarCollapsed: false,
  maxHistoryPoints: 120,
}

/** Coerce an unknown settings object into a safe `Settings`, over a fallback. */
export function normalizeSettings(
  raw: unknown,
  fallback: Settings = FALLBACK_SETTINGS,
): Settings {
  if (!raw || typeof raw !== 'object') return fallback
  const r = raw as Record<string, unknown>
  const rawThresholds =
    r.thresholds && typeof r.thresholds === 'object'
      ? (r.thresholds as Record<string, unknown>)
      : {}
  return {
    theme: r.theme === 'light' ? 'light' : 'dark',
    refreshIntervalMs: num(
      r.refreshIntervalMs,
      fallback.refreshIntervalMs,
      1000,
      60000,
    ),
    simulationSpeed: num(r.simulationSpeed, fallback.simulationSpeed, 0.5, 8),
    simulationRunning: r.simulationRunning === true,
    incidentFrequency: clamp(
      num(r.incidentFrequency, fallback.incidentFrequency, 0, 1),
      0,
      1,
    ),
    thresholds: {
      latencyMs: num(
        rawThresholds.latencyMs,
        fallback.thresholds.latencyMs,
        1,
        5000,
      ),
      packetLossPct: num(
        rawThresholds.packetLossPct,
        fallback.thresholds.packetLossPct,
        0,
        100,
      ),
      availabilityPct: num(
        rawThresholds.availabilityPct,
        fallback.thresholds.availabilityPct,
        0,
        100,
      ),
    },
    sidebarCollapsed: r.sidebarCollapsed === true,
    maxHistoryPoints: num(
      r.maxHistoryPoints,
      fallback.maxHistoryPoints,
      6,
      240,
    ),
  }
}

/**
 * Parse and validate a full-state backup WITHOUT touching application state.
 * Only the collections that are present and well-formed are accepted; a
 * malformed file is rejected so the caller can surface a friendly error.
 */
export function parseFullState(text: string): FullStateImportResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'The backup file is empty.' }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'The backup file is not valid JSON.' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'The backup file has an unexpected shape.' }
  }

  const p = parsed as Record<string, unknown>
  if (!Array.isArray(p.devices)) {
    return {
      ok: false,
      error: 'The backup is missing a "devices" array.',
    }
  }

  const devices = coerceDevices(p.devices)
  if (p.devices.length > 0 && devices.length === 0) {
    return {
      ok: false,
      error: 'None of the devices in the backup could be validated.',
    }
  }

  const settings = normalizeSettings(p.settings)
  const history = coerceHistory(p.history, settings.maxHistoryPoints)

  return {
    ok: true,
    data: {
      devices,
      incidents: asArray<Incident>(p.incidents),
      events: asArray<TimelineEvent>(p.events),
      history,
      settings,
    },
  }
}
