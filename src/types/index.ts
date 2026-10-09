/**
 * NetScope domain types.
 *
 * Everything in NetScope is simulated. These types describe the shape of the
 * DEMO telemetry held in memory and (partially) persisted to localStorage.
 *
 * Note: D3 topology layout coordinates are intentionally NOT part of the
 * monitoring model. Layout lives only inside the topology hook (see
 * `src/hooks/useTopologyLayout.ts`) so that visual simulation state is fully
 * decoupled from the monitoring store.
 */

export type DeviceType =
  'router' | 'switch' | 'firewall' | 'server' | 'accessPoint'

export type DeviceStatus = 'online' | 'degraded' | 'offline'

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export type HealthLevel = 'healthy' | 'degraded' | 'critical'

export type IncidentStatus = 'open' | 'acknowledged' | 'resolved'

export type EventType = 'status' | 'incident' | 'device' | 'config'

export interface Device {
  id: string
  name: string
  type: DeviceType
  site: string
  ip: string
  mac: string
  /** Current (latest simulated) status. */
  status: DeviceStatus
  tags: string[]
  /** Simulated round-trip latency in milliseconds. */
  latencyMs: number
  /** Simulated packet loss percentage (0-100). */
  packetLossPct: number
  /** Simulated availability percentage (0-100). */
  availabilityPct: number
  /** Simulated throughput in Mbps. */
  throughputMbps: number
  /** Simulated CPU utilisation percentage (0-100). */
  cpuPct: number
  /** Simulated memory utilisation percentage (0-100). */
  memoryPct: number
  /** Simulated uptime in seconds. */
  uptimeSec: number
  /** Epoch ms of the last simulated contact with the device. */
  lastSeen: number
  /** True while the DEMO engine detects rapid state oscillation (flapping). */
  flapping?: boolean
  /** True while the device is inside a simulated maintenance window. */
  inMaintenance?: boolean
}

/** Fields a user supplies when creating/editing a device. */
export interface DeviceInput {
  name: string
  type: DeviceType
  site: string
  ip: string
  mac: string
  tags: string[]
}

/** A single point of historical telemetry for a device. */
export interface MetricSample {
  t: number
  latencyMs: number
  packetLossPct: number
  availabilityPct: number
}

export interface Incident {
  id: string
  title: string
  description: string
  severity: Severity
  status: IncidentStatus
  deviceIds: string[]
  createdAt: number
  updatedAt: number
  acknowledgedAt?: number
  resolvedAt?: number
}

export interface TimelineEvent {
  id: string
  timestamp: number
  type: EventType
  severity?: Severity
  deviceId?: string
  message: string
}

export interface Thresholds {
  /** Latency at/above which a device is considered degraded. */
  latencyMs: number
  /** Packet loss at/above which a device is considered degraded. */
  packetLossPct: number
  /** Availability below which a device is considered degraded. */
  availabilityPct: number
}

export interface Settings {
  theme: 'dark' | 'light'
  /** How often the simulation advances, in milliseconds. */
  refreshIntervalMs: number
  /** Simulation speed multiplier (steps per tick). */
  simulationSpeed: number
  /** Whether the simulation is running. */
  simulationRunning: boolean
  /** 0..1 probability weight for generating new incidents. */
  incidentFrequency: number
  thresholds: Thresholds
  sidebarCollapsed: boolean
  /** Maximum number of history samples retained per device. */
  maxHistoryPoints: number
}

export interface PersistedState {
  version: number
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
  settings: Settings
}

/** Shape of a full-state backup file (devices + activity + settings). */
export interface BackupFile {
  version: number
  exportedAt: string
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
  settings: Settings
}

/** Backup payload without the file-level metadata, used when restoring. */
export type BackupPayload = Omit<BackupFile, 'version' | 'exportedAt'>
