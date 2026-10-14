import type { Device, DeviceType } from '@/types'
import { hashSeed, mulberry32, type Rng } from '@/simulation/random'
import { round } from './format'

/**
 * Flow & application analytics (NetFlow-lite).
 *
 * Derives a deterministic set of flow records from the simulated fleet: each
 * device's throughput is split across applications, peers and directions
 * (east-west between internal devices vs north-south to the Internet) using a
 * per-device seeded RNG. Pure and reproducible — the same devices and seed always
 * produce the same flows.
 */

export type ApplicationKind =
  | 'web'
  | 'video'
  | 'database'
  | 'file'
  | 'backup'
  | 'dns'
  | 'ssh'
  | 'mail'
  | 'voip'
  | 'other'

export interface ApplicationMeta {
  kind: ApplicationKind
  label: string
  port: number
  protocol: 'TCP' | 'UDP'
  /** Relative prevalence when splitting a device's throughput. */
  weight: number
  /** Rough packets-per-Mbit used to derive a packets/sec figure. */
  packetsPerMb: number
}

export const APPLICATIONS: ApplicationMeta[] = [
  {
    kind: 'web',
    label: 'Web / HTTPS',
    port: 443,
    protocol: 'TCP',
    weight: 30,
    packetsPerMb: 140,
  },
  {
    kind: 'video',
    label: 'Video / Streaming',
    port: 1935,
    protocol: 'TCP',
    weight: 15,
    packetsPerMb: 90,
  },
  {
    kind: 'database',
    label: 'Database',
    port: 5432,
    protocol: 'TCP',
    weight: 12,
    packetsPerMb: 210,
  },
  {
    kind: 'file',
    label: 'File / SMB',
    port: 445,
    protocol: 'TCP',
    weight: 10,
    packetsPerMb: 95,
  },
  {
    kind: 'dns',
    label: 'DNS',
    port: 53,
    protocol: 'UDP',
    weight: 8,
    packetsPerMb: 800,
  },
  {
    kind: 'backup',
    label: 'Backup',
    port: 873,
    protocol: 'TCP',
    weight: 8,
    packetsPerMb: 70,
  },
  {
    kind: 'ssh',
    label: 'SSH',
    port: 22,
    protocol: 'TCP',
    weight: 6,
    packetsPerMb: 300,
  },
  {
    kind: 'mail',
    label: 'Mail',
    port: 587,
    protocol: 'TCP',
    weight: 4,
    packetsPerMb: 180,
  },
  {
    kind: 'voip',
    label: 'VoIP',
    port: 5060,
    protocol: 'UDP',
    weight: 4,
    packetsPerMb: 620,
  },
  {
    kind: 'other',
    label: 'Other',
    port: 0,
    protocol: 'TCP',
    weight: 3,
    packetsPerMb: 150,
  },
]

const APP_BY_KIND = new Map(APPLICATIONS.map((app) => [app.kind, app]))

export function applicationMeta(kind: ApplicationKind): ApplicationMeta {
  return APP_BY_KIND.get(kind) ?? APPLICATIONS[APPLICATIONS.length - 1]!
}

/** Virtual peer used for north-south (to-the-Internet) flows. */
export const EXTERNAL_SITE = 'Internet'

export type FlowDirection = 'east-west' | 'north-south'

export interface FlowRecord {
  id: string
  sourceDeviceId: string
  /** null for north-south flows whose peer is the Internet. */
  destDeviceId: string | null
  /** Site of the peer (or 'Internet' for north-south). */
  destSite: string
  application: ApplicationKind
  protocol: 'TCP' | 'UDP'
  port: number
  throughputMbps: number
  packetsPerSec: number
  direction: FlowDirection
}

/** Likelihood a device's traffic is north-south rather than east-west. */
const NORTH_SOUTH_CHANCE: Record<DeviceType, number> = {
  router: 0.6,
  firewall: 0.7,
  server: 0.5,
  switch: 0.25,
  accessPoint: 0.2,
}

function pickApplication(rng: Rng): ApplicationKind {
  const total = APPLICATIONS.reduce((sum, app) => sum + app.weight, 0)
  let roll = rng.next() * total
  for (const app of APPLICATIONS) {
    roll -= app.weight
    if (roll <= 0) return app.kind
  }
  return 'other'
}

function pickPeer(rng: Rng, device: Device, peers: Device[]): Device | null {
  const candidates = peers.filter((peer) => peer.id !== device.id)
  if (candidates.length === 0) return null
  const remote = candidates.filter((peer) => peer.site !== device.site)
  if (remote.length > 0 && rng.chance(0.5)) return rng.pick(remote)
  return rng.pick(candidates)
}

/**
 * Build the fleet's flow records. Each device's throughput is divided across a
 * deterministic set of application flows.
 */
export function buildFlows(devices: Device[], seed = 0): FlowRecord[] {
  const flows: FlowRecord[] = []
  const peers = devices.filter((device) => device.throughputMbps > 0)

  for (const device of devices) {
    if (device.throughputMbps <= 0) continue
    const rng = mulberry32((hashSeed(device.id) ^ seed) >>> 0)
    const count = rng.int(3, 6)
    const weights = Array.from({ length: count }, () => rng.range(0.4, 1.6))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

    for (let i = 0; i < count; i += 1) {
      const application = pickApplication(rng)
      const meta = applicationMeta(application)
      const throughputMbps = round(
        (device.throughputMbps * weights[i]) / totalWeight,
        2,
      )

      const northSouth = rng.chance(NORTH_SOUTH_CHANCE[device.type] ?? 0.4)
      const peer = northSouth ? null : pickPeer(rng, device, peers)
      const direction: FlowDirection = peer ? 'east-west' : 'north-south'

      flows.push({
        id: `${device.id}-f${i}`,
        sourceDeviceId: device.id,
        destDeviceId: peer?.id ?? null,
        destSite: peer?.site ?? EXTERNAL_SITE,
        application,
        protocol: meta.protocol,
        port: meta.port,
        throughputMbps,
        packetsPerSec: Math.round(throughputMbps * meta.packetsPerMb),
        direction,
      })
    }
  }

  return flows
}

export interface Talker {
  deviceId: string
  throughputMbps: number
  flowCount: number
}

/** Aggregate throughput by source device, busiest first. */
export function topTalkers(flows: FlowRecord[], n = 10): Talker[] {
  const byDevice = new Map<string, Talker>()
  for (const flow of flows) {
    const entry = byDevice.get(flow.sourceDeviceId) ?? {
      deviceId: flow.sourceDeviceId,
      throughputMbps: 0,
      flowCount: 0,
    }
    entry.throughputMbps += flow.throughputMbps
    entry.flowCount += 1
    byDevice.set(flow.sourceDeviceId, entry)
  }
  return [...byDevice.values()]
    .map((talker) => ({
      ...talker,
      throughputMbps: round(talker.throughputMbps, 2),
    }))
    .sort(
      (a, b) =>
        b.throughputMbps - a.throughputMbps ||
        a.deviceId.localeCompare(b.deviceId),
    )
    .slice(0, n)
}

export interface ApplicationShare {
  application: ApplicationKind
  label: string
  throughputMbps: number
  sharePct: number
}

/** Throughput share per application, largest first. */
export function applicationMix(flows: FlowRecord[]): ApplicationShare[] {
  const total = flows.reduce((sum, flow) => sum + flow.throughputMbps, 0)
  const byApp = new Map<ApplicationKind, number>()
  for (const flow of flows) {
    byApp.set(
      flow.application,
      (byApp.get(flow.application) ?? 0) + flow.throughputMbps,
    )
  }
  return [...byApp.entries()]
    .map(([application, throughputMbps]) => ({
      application,
      label: applicationMeta(application).label,
      throughputMbps: round(throughputMbps, 2),
      sharePct: total > 0 ? round((throughputMbps / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.throughputMbps - a.throughputMbps)
}

export interface Conversation {
  source: string
  dest: string
  throughputMbps: number
}

/** Top source→destination conversations (peer 'Internet' for north-south). */
export function conversationPairs(flows: FlowRecord[], n = 10): Conversation[] {
  const byPair = new Map<string, Conversation>()
  for (const flow of flows) {
    const dest = flow.destDeviceId ?? EXTERNAL_SITE
    const key = `${flow.sourceDeviceId}|${dest}`
    const entry = byPair.get(key) ?? {
      source: flow.sourceDeviceId,
      dest,
      throughputMbps: 0,
    }
    entry.throughputMbps += flow.throughputMbps
    byPair.set(key, entry)
  }
  return [...byPair.values()]
    .map((conversation) => ({
      ...conversation,
      throughputMbps: round(conversation.throughputMbps, 2),
    }))
    .sort(
      (a, b) =>
        b.throughputMbps - a.throughputMbps ||
        a.source.localeCompare(b.source) ||
        a.dest.localeCompare(b.dest),
    )
    .slice(0, n)
}

export interface TrafficMatrix {
  sites: string[]
  /** matrix[i][j] = east-west Mbps from sites[i] to sites[j]. */
  matrix: number[][]
}

/** Site×site east-west traffic matrix (diagonal left at 0). */
export function trafficMatrix(
  devices: Device[],
  flows: FlowRecord[],
): TrafficMatrix {
  const sites = [...new Set(devices.map((device) => device.site))].sort()
  const index = new Map(sites.map((site, i) => [site, i]))
  const deviceSite = new Map(devices.map((device) => [device.id, device.site]))
  const matrix = sites.map(() => sites.map(() => 0))

  for (const flow of flows) {
    if (flow.direction !== 'east-west' || !flow.destDeviceId) continue
    const from = deviceSite.get(flow.sourceDeviceId)
    const to = deviceSite.get(flow.destDeviceId)
    if (!from || !to || from === to) continue
    const i = index.get(from)
    const j = index.get(to)
    if (i === undefined || j === undefined) continue
    matrix[i]![j] = round(matrix[i]![j] + flow.throughputMbps, 2)
  }

  return { sites, matrix }
}

export interface DirectionSplit {
  eastWestMbps: number
  northSouthMbps: number
  eastWestPct: number
}

export function eastWestRatio(flows: FlowRecord[]): DirectionSplit {
  let eastWestMbps = 0
  let northSouthMbps = 0
  for (const flow of flows) {
    if (flow.direction === 'east-west') eastWestMbps += flow.throughputMbps
    else northSouthMbps += flow.throughputMbps
  }
  const total = eastWestMbps + northSouthMbps
  return {
    eastWestMbps: round(eastWestMbps, 2),
    northSouthMbps: round(northSouthMbps, 2),
    eastWestPct: total > 0 ? round((eastWestMbps / total) * 100, 1) : 0,
  }
}

export interface FlowSummary {
  flowCount: number
  totalMbps: number
  eastWestPct: number
  topApplication: ApplicationKind | null
}

export function flowSummary(flows: FlowRecord[]): FlowSummary {
  const totalMbps = round(
    flows.reduce((sum, flow) => sum + flow.throughputMbps, 0),
    2,
  )
  const mix = applicationMix(flows)
  return {
    flowCount: flows.length,
    totalMbps,
    eastWestPct: eastWestRatio(flows).eastWestPct,
    topApplication: mix[0]?.application ?? null,
  }
}

export interface FlowAnomaly {
  flow: FlowRecord
  appMeanMbps: number
  ratio: number
}

/**
 * Flag flows whose throughput far exceeds the mean for their application
 * (default: more than 2×). Deterministic; used to surface heavy hitters.
 */
export function flowAnomalies(flows: FlowRecord[], factor = 2): FlowAnomaly[] {
  const sums = new Map<ApplicationKind, { total: number; count: number }>()
  for (const flow of flows) {
    const entry = sums.get(flow.application) ?? { total: 0, count: 0 }
    entry.total += flow.throughputMbps
    entry.count += 1
    sums.set(flow.application, entry)
  }

  const anomalies: FlowAnomaly[] = []
  for (const flow of flows) {
    const entry = sums.get(flow.application)
    if (!entry || entry.count === 0) continue
    const appMeanMbps = entry.total / entry.count
    if (appMeanMbps <= 0) continue
    const ratio = flow.throughputMbps / appMeanMbps
    if (ratio > factor) {
      anomalies.push({
        flow,
        appMeanMbps: round(appMeanMbps, 2),
        ratio: round(ratio, 2),
      })
    }
  }
  return anomalies.sort((a, b) => b.ratio - a.ratio)
}
