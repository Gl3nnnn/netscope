import type { Device, Severity } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import { round, clamp01 } from './format'
import { buildFlows, EXTERNAL_SITE, type FlowRecord } from './flow'
import { locationFor } from './geo'

/**
 * Security Operations (SOC) engine.
 *
 * Derives a deterministic set of security findings (port scans, brute-force,
 * C2 beaconing, exfiltration, geo-anomalies) from the live fleet, its derived
 * flows and its geography. Every detector is pure and seeded, so the same
 * devices + seed always yield the same findings. Nothing here touches the
 * network — it is simulated DEMO telemetry only.
 */

export type AttackTechnique =
  'T1110' | 'T1046' | 'T1498' | 'T1071' | 'T1041' | 'T1040'

export type KillChainPhase =
  | 'reconnaissance'
  | 'initial-access'
  | 'execution'
  | 'persistence'
  | 'command-and-control'
  | 'exfiltration'

export type Disposition = 'open' | 'contained' | 'false-positive'

export interface TechniqueMeta {
  technique: AttackTechnique
  label: string
  mitre: string
  phase: KillChainPhase
  severity: Severity
}

export const TECHNIQUES: Record<AttackTechnique, TechniqueMeta> = {
  T1046: {
    technique: 'T1046',
    label: 'Network Service Discovery',
    mitre: 'T1046',
    phase: 'reconnaissance',
    severity: 'medium',
  },
  T1110: {
    technique: 'T1110',
    label: 'Brute Force',
    mitre: 'T1110',
    phase: 'initial-access',
    severity: 'high',
  },
  T1040: {
    technique: 'T1040',
    label: 'Network Sniffing',
    mitre: 'T1040',
    phase: 'execution',
    severity: 'medium',
  },
  T1071: {
    technique: 'T1071',
    label: 'Application Layer Protocol (C2)',
    mitre: 'T1071',
    phase: 'command-and-control',
    severity: 'critical',
  },
  T1041: {
    technique: 'T1041',
    label: 'Exfiltration Over C2 Channel',
    mitre: 'T1041',
    phase: 'exfiltration',
    severity: 'critical',
  },
  T1498: {
    technique: 'T1498',
    label: 'Network Denial of Service',
    mitre: 'T1498',
    phase: 'execution',
    severity: 'high',
  },
}

export const TECHNIQUE_LIST: TechniqueMeta[] = Object.values(TECHNIQUES)

export const KILL_CHAIN_PHASES: KillChainPhase[] = [
  'reconnaissance',
  'initial-access',
  'execution',
  'persistence',
  'command-and-control',
  'exfiltration',
]

export const PHASE_LABELS: Record<KillChainPhase, string> = {
  reconnaissance: 'Reconnaissance',
  'initial-access': 'Initial Access',
  execution: 'Execution',
  persistence: 'Persistence',
  'command-and-control': 'Command & Control',
  exfiltration: 'Exfiltration',
}

export const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

export interface SecurityEvent {
  id: string
  technique: AttackTechnique
  severity: Severity
  /** 0..1 — how confident the detector is that this is malicious. */
  confidence: number
  deviceId: string
  deviceName: string
  site: string
  srcIp: string
  dstIp: string
  dstPort: number
  count: number
  firstSeen: number
  lastSeen: number
  disposition: Disposition
}

export interface SecurityInput {
  devices: Device[]
  flows?: FlowRecord[]
  now: number
  seed?: number
  /** 0..1 weight for how aggressively detectors fire (mirrors incidentFrequency). */
  intensity?: number
  existing?: SecurityEvent[]
}

export interface SecurityScore {
  score: number
  grade: 'secure' | 'at-risk' | 'critical'
  openBySeverity: Record<Severity, number>
  open: number
  contained: number
  falsePositives: number
  /** Highest-severity open technique, null when nothing is open. */
  topTechnique: TechniqueMeta | null
}

const EXTERNAL_IP = '203.0.113.10'

/** Deterministic fake external IP for a device-scoped finding. */
function externalIpFor(seedValue: string): string {
  const hash = hashSeed(seedValue)
  const a = 203
  const b = (hash >>> 16) & 255
  const c = (hash >>> 8) & 255
  const d = hash & 255
  return `${a}.${b}.${c}.${d}`
}

function clampCount(value: number): number {
  return Math.max(0, Math.round(value))
}

interface Candidate {
  technique: AttackTechnique
  deviceId: string
  srcIp: string
  dstIp: string
  dstPort: number
  count: number
  confidence: number
  windowMs: number
}

/** Port scan: many distinct destination ports probed in a short window. */
function detectPortScans(
  devices: Device[],
  rngFor: (id: string) => ReturnType<typeof mulberry32>,
): Candidate[] {
  const out: Candidate[] = []
  for (const device of devices) {
    const rng = rngFor(device.id)
    const base = 0.05 + (device.cpuPct / 100) * 0.1
    if (!rng.chance(base)) continue
    const distinctPorts = rng.int(15, 60)
    out.push({
      technique: 'T1046',
      deviceId: device.id,
      srcIp: externalIpFor(`scan:${device.id}`),
      dstIp: device.ip,
      dstPort: 0,
      count: distinctPorts,
      confidence: clamp01(0.5 + distinctPorts / 120),
      windowMs: 30_000,
    })
  }
  return out
}

/** Brute force: repeated auth attempts against SSH (port 22). */
function detectBruteForce(
  devices: Device[],
  rngFor: (id: string) => ReturnType<typeof mulberry32>,
): Candidate[] {
  const out: Candidate[] = []
  for (const device of devices) {
    if (device.type !== 'server' && device.type !== 'firewall') continue
    const rng = rngFor(`${device.id}:bf`)
    if (!rng.chance(0.18)) continue
    const attempts = rng.int(20, 120)
    out.push({
      technique: 'T1110',
      deviceId: device.id,
      srcIp: externalIpFor(`bf:${device.id}`),
      dstIp: device.ip,
      dstPort: 22,
      count: attempts,
      confidence: clamp01(0.55 + attempts / 240),
      windowMs: 60_000,
    })
  }
  return out
}

/** Network sniffing: degraded loss/latency on a router or switch. */
function detectSniffing(
  devices: Device[],
  rngFor: (id: string) => ReturnType<typeof mulberry32>,
): Candidate[] {
  const out: Candidate[] = []
  for (const device of devices) {
    if (device.type !== 'router' && device.type !== 'switch') continue
    const rng = rngFor(`${device.id}:sniff`)
    if (!rng.chance(0.08)) continue
    out.push({
      technique: 'T1040',
      deviceId: device.id,
      srcIp: device.ip,
      dstIp: EXTERNAL_IP,
      dstPort: 0,
      count: rng.int(3, 9),
      confidence: clamp01(0.4 + device.packetLossPct / 20),
      windowMs: 120_000,
    })
  }
  return out
}

/** DoS: sustained high throughput against a device near capacity. */
function detectDos(
  devices: Device[],
  rngFor: (id: string) => ReturnType<typeof mulberry32>,
): Candidate[] {
  const out: Candidate[] = []
  for (const device of devices) {
    const util =
      device.capacityMbps > 0 ? device.throughputMbps / device.capacityMbps : 0
    if (util < 0.85) continue
    const rng = rngFor(`${device.id}:dos`)
    if (!rng.chance(0.4)) continue
    const mbps = round(device.throughputMbps, 1)
    out.push({
      technique: 'T1498',
      deviceId: device.id,
      srcIp: externalIpFor(`dos:${device.id}`),
      dstIp: device.ip,
      dstPort: 443,
      count: clampCount(mbps),
      confidence: clamp01(0.6 + (util - 0.85) * 2),
      windowMs: 60_000,
    })
  }
  return out
}

/** C2 beaconing: low-volume, periodic north-south flows. */
function detectC2(
  flows: FlowRecord[],
  rngFor: (id: string) => ReturnType<typeof mulberry32>,
): Candidate[] {
  const out: Candidate[] = []
  const northSouth = flows.filter(
    (flow) =>
      flow.direction === 'north-south' && flow.destSite === EXTERNAL_SITE,
  )
  const byDevice = new Map<string, FlowRecord[]>()
  for (const flow of northSouth) {
    const list = byDevice.get(flow.sourceDeviceId) ?? []
    list.push(flow)
    byDevice.set(flow.sourceDeviceId, list)
  }
  for (const [deviceId, list] of byDevice) {
    const rng = rngFor(`${deviceId}:c2`)
    if (!rng.chance(0.22)) continue
    const lowVolume = list.filter((flow) => flow.throughputMbps < 12)
    if (lowVolume.length === 0) continue
    const flow = rng.pick(lowVolume)
    out.push({
      technique: 'T1071',
      deviceId,
      srcIp: flow.sourceDeviceId,
      dstIp: EXTERNAL_IP,
      dstPort: flow.port,
      count: rng.int(20, 80),
      confidence: clamp01(0.6 + (12 - flow.throughputMbps) / 30),
      windowMs: 300_000,
    })
  }
  return out
}

/** Exfiltration: heavy north-south upload. */
function detectExfiltration(
  flows: FlowRecord[],
  devices: Device[],
  rngFor: (id: string) => ReturnType<typeof mulberry32>,
): Candidate[] {
  const out: Candidate[] = []
  const byDevice = new Map<string, number>()
  for (const flow of flows) {
    if (flow.direction !== 'north-south') continue
    byDevice.set(
      flow.sourceDeviceId,
      (byDevice.get(flow.sourceDeviceId) ?? 0) + flow.throughputMbps,
    )
  }
  const deviceById = new Map(devices.map((device) => [device.id, device]))
  for (const [deviceId, mbps] of byDevice) {
    const device = deviceById.get(deviceId)
    if (!device) continue
    const rng = rngFor(`${deviceId}:exfil`)
    if (!rng.chance(0.15)) continue
    if (mbps < 40) continue
    out.push({
      technique: 'T1041',
      deviceId,
      srcIp: device.ip,
      dstIp: EXTERNAL_IP,
      dstPort: 443,
      count: clampCount(mbps),
      confidence: clamp01(0.65 + mbps / 400),
      windowMs: 600_000,
    })
  }
  return out
}

/** Geo-anomaly: a device peering with a source on a distant continent. */
function detectGeoAnomalies(
  devices: Device[],
  rngFor: (id: string) => ReturnType<typeof mulberry32>,
): Candidate[] {
  const out: Candidate[] = []
  for (const device of devices) {
    const rng = rngFor(`${device.id}:geo`)
    if (!rng.chance(0.12)) continue
    const point = locationFor(device.site)
    // Deterministic far-away latitude derived from the device id.
    const farLat = -point.lat + rng.range(-20, 20)
    out.push({
      technique: 'T1040',
      deviceId: device.id,
      srcIp: externalIpFor(`geo:${device.id}:${Math.round(farLat)}`),
      dstIp: device.ip,
      dstPort: 0,
      count: rng.int(2, 7),
      confidence: clamp01(0.45 + Math.abs(farLat) / 180),
      windowMs: 180_000,
    })
  }
  return out
}

function toEvent(
  candidate: Candidate,
  device: Device,
  now: number,
  index: number,
): SecurityEvent {
  const meta = TECHNIQUES[candidate.technique]
  return {
    id: `sec_${candidate.technique}_${device.id}_${index}`,
    technique: candidate.technique,
    severity: meta.severity,
    confidence: round(candidate.confidence, 2),
    deviceId: device.id,
    deviceName: device.name,
    site: device.site,
    srcIp: candidate.srcIp,
    dstIp: candidate.dstIp,
    dstPort: candidate.dstPort,
    count: candidate.count,
    firstSeen: now - candidate.windowMs,
    lastSeen: now,
    disposition: 'open',
  }
}

/**
 * Evaluate the whole fleet and return the merged, de-duplicated security
 * findings. Deterministic for a given device set, flow set, `now` and seed.
 */
export function evaluateSecurity(input: SecurityInput): SecurityEvent[] {
  const { devices, now } = input
  const seed = input.seed ?? 0
  const flows = input.flows ?? buildFlows(devices, seed)
  const intensity = input.intensity ?? 0.5

  const rngFor = (id: string) => mulberry32((hashSeed(id) ^ seed) >>> 0)

  const candidates: Candidate[] = [
    ...detectPortScans(devices, rngFor),
    ...detectBruteForce(devices, rngFor),
    ...detectSniffing(devices, rngFor),
    ...detectDos(devices, rngFor),
    ...detectC2(flows, rngFor),
    ...detectExfiltration(flows, devices, rngFor),
    ...detectGeoAnomalies(devices, rngFor),
  ]

  // Scale by intensity so a low incident-frequency demo stays calm.
  const scaled: Candidate[] = []
  for (const candidate of candidates) {
    const rng = rngFor(`scale:${candidate.deviceId}:${candidate.technique}`)
    if (rng.chance(intensity)) scaled.push(candidate)
  }

  const deviceById = new Map(devices.map((device) => [device.id, device]))
  const existingById = new Map(
    (input.existing ?? []).map((event) => [event.id, event]),
  )

  const events: SecurityEvent[] = []
  scaled.forEach((candidate, index) => {
    const device = deviceById.get(candidate.deviceId)
    if (!device) return
    const event = toEvent(candidate, device, now, index)
    const prior = existingById.get(event.id)
    if (prior) {
      events.push({
        ...event,
        disposition: prior.disposition,
        firstSeen: Math.min(prior.firstSeen, event.firstSeen),
        count: Math.max(prior.count, event.count),
      })
    } else {
      events.push(event)
    }
  })

  return events.sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.confidence - a.confidence ||
      a.deviceId.localeCompare(b.deviceId),
  )
}

/** Return a copy of `events` with the given event marked with a disposition. */
export function withDisposition(
  events: SecurityEvent[],
  id: string,
  disposition: Disposition,
): SecurityEvent[] {
  return events.map((event) =>
    event.id === id ? { ...event, disposition } : event,
  )
}

export function securityScore(events: SecurityEvent[]): SecurityScore {
  const open = events.filter((event) => event.disposition === 'open')
  const openBySeverity: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const event of open) openBySeverity[event.severity] += 1

  const weighted = open.reduce(
    (sum, event) =>
      sum + (SEVERITY_RANK[event.severity] + 1) * (0.5 + event.confidence / 2),
    0,
  )
  const score = round(clamp01(1 - weighted / 40) * 100, 1)
  const grade: SecurityScore['grade'] =
    score >= 80 ? 'secure' : score >= 55 ? 'at-risk' : 'critical'

  const worstOpen = open.reduce<SecurityEvent | null>(
    (worst, event) =>
      !worst || SEVERITY_RANK[event.severity] > SEVERITY_RANK[worst.severity]
        ? event
        : worst,
    null,
  )
  const topTechnique = worstOpen ? TECHNIQUES[worstOpen.technique] : null

  return {
    score,
    grade,
    openBySeverity,
    open: open.length,
    contained: events.filter((event) => event.disposition === 'contained')
      .length,
    falsePositives: events.filter(
      (event) => event.disposition === 'false-positive',
    ).length,
    topTechnique,
  }
}

export interface TargetSummary {
  deviceId: string
  deviceName: string
  site: string
  count: number
  worstSeverity: Severity
}

/** Most-targeted devices, worst severity then count. */
export function topTargets(events: SecurityEvent[], n = 8): TargetSummary[] {
  const byDevice = new Map<
    string,
    { deviceName: string; site: string; events: SecurityEvent[] }
  >()
  for (const event of events) {
    if (event.disposition !== 'open') continue
    const entry = byDevice.get(event.deviceId) ?? {
      deviceName: event.deviceName,
      site: event.site,
      events: [],
    }
    entry.events.push(event)
    byDevice.set(event.deviceId, entry)
  }
  return [...byDevice.entries()]
    .map(([deviceId, entry]) => ({
      deviceId,
      deviceName: entry.deviceName,
      site: entry.site,
      count: entry.events.length,
      worstSeverity: entry.events.reduce<Severity>(
        (worst, event) =>
          SEVERITY_RANK[event.severity] > SEVERITY_RANK[worst]
            ? event.severity
            : worst,
        'low',
      ),
    }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.worstSeverity] - SEVERITY_RANK[a.worstSeverity] ||
        b.count - a.count ||
        a.deviceId.localeCompare(b.deviceId),
    )
    .slice(0, n)
}

export interface HeatmapCell {
  phase: KillChainPhase
  technique: AttackTechnique
  count: number
  worstSeverity: Severity
}

/** MITRE ATT&CK heat map: count of open events per phase × technique. */
export function attackHeatmap(events: SecurityEvent[]): HeatmapCell[] {
  const open = events.filter((event) => event.disposition === 'open')
  const cells: HeatmapCell[] = []
  for (const phase of KILL_CHAIN_PHASES) {
    for (const meta of TECHNIQUE_LIST) {
      if (meta.phase !== phase) continue
      const matching = open.filter(
        (event) => event.technique === meta.technique,
      )
      cells.push({
        phase,
        technique: meta.technique,
        count: matching.length,
        worstSeverity: matching.reduce<Severity>(
          (worst, event) =>
            SEVERITY_RANK[event.severity] > SEVERITY_RANK[worst]
              ? event.severity
              : worst,
          'low',
        ),
      })
    }
  }
  return cells
}

export interface SecuritySummary {
  total: number
  open: number
  contained: number
  falsePositives: number
  score: number
  grade: SecurityScore['grade']
}

export function securitySummary(events: SecurityEvent[]): SecuritySummary {
  const score = securityScore(events)
  return {
    total: events.length,
    open: score.open,
    contained: score.contained,
    falsePositives: score.falsePositives,
    score: score.score,
    grade: score.grade,
  }
}
