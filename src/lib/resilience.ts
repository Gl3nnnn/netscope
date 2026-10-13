import type {
  Device,
  DeviceType,
  FaultInjection,
  Incident,
  Thresholds,
} from '@/types'
import { mulberry32 } from '@/simulation/random'
import { runTick } from '@/simulation/engine'
import { buildAdjacency, type TopoGraph } from './tracer'
import {
  serviceHealthAll,
  type BusinessService,
  type ServiceStatus,
} from './services'

/**
 * Resilience & chaos engineering.
 *
 * Two complementary analyses over the inventory-derived topology:
 *
 * 1. **Static resilience** — find single points of failure (articulation points
 *    whose removal cuts devices off from the core), measure path redundancy and
 *    roll it into a 0-100 resilience score.
 * 2. **Chaos simulation** — inject combined faults (device/site outages,
 *    saturation, traffic surges) on a *clone* of the fleet, run the real
 *    deterministic engine in a sandbox and measure the resulting service
 *    outages. Nothing here mutates live state or the live RNG.
 */

const CORE_PRIORITY: DeviceType[] = [
  'router',
  'firewall',
  'switch',
  'server',
  'accessPoint',
]

/**
 * Tarjan articulation points over the undirected topology. A node is an
 * articulation point when removing it increases the number of components —
 * i.e. a single point of failure.
 */
export function articulationPoints(graph: TopoGraph): string[] {
  const { adjacency } = graph
  const discovery = new Map<string, number>()
  const low = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const points = new Set<string>()
  let time = 0

  for (const start of adjacency.keys()) {
    if (discovery.has(start)) continue
    const stack: Array<{ node: string; index: number }> = [
      { node: start, index: 0 },
    ]
    discovery.set(start, time)
    low.set(start, time)
    time += 1
    parent.set(start, null)
    let rootChildren = 0

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const neighbors = adjacency.get(frame.node) ?? []
      if (frame.index < neighbors.length) {
        const next = neighbors[frame.index]
        frame.index += 1
        if (!discovery.has(next)) {
          parent.set(next, frame.node)
          discovery.set(next, time)
          low.set(next, time)
          time += 1
          if (frame.node === start) rootChildren += 1
          stack.push({ node: next, index: 0 })
        } else if (next !== parent.get(frame.node)) {
          low.set(
            frame.node,
            Math.min(low.get(frame.node) ?? 0, discovery.get(next) ?? 0),
          )
        }
      } else {
        stack.pop()
        const upstream = parent.get(frame.node)
        if (upstream !== null && upstream !== undefined) {
          low.set(
            upstream,
            Math.min(low.get(upstream) ?? 0, low.get(frame.node) ?? 0),
          )
          if (
            upstream !== start &&
            (low.get(frame.node) ?? 0) >= (discovery.get(upstream) ?? 0)
          ) {
            points.add(upstream)
          }
        }
      }
    }
    if (rootChildren > 1) points.add(start)
  }

  return [...points].sort()
}

/** The core node: highest degree, tie-broken by device type then id. */
export function pickCore(
  devices: Device[],
  adjacency: Map<string, string[]>,
): Device | null {
  if (devices.length === 0) return null
  const degree = (device: Device) => adjacency.get(device.id)?.length ?? 0
  return [...devices].sort(
    (a, b) =>
      degree(b) - degree(a) ||
      CORE_PRIORITY.indexOf(a.type) - CORE_PRIORITY.indexOf(b.type) ||
      a.id.localeCompare(b.id),
  )[0]
}

/** Nodes reachable from `start` while skipping every node in `avoid`. */
function reachableFrom(
  adjacency: Map<string, string[]>,
  start: string,
  avoid: Set<string>,
): Set<string> {
  const seen = new Set<string>([start])
  if (avoid.has(start)) return seen
  const queue: string[] = [start]
  while (queue.length > 0) {
    const id = queue.shift() as string
    for (const next of adjacency.get(id) ?? []) {
      if (avoid.has(next) || seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

export type SpofSeverity = 'critical' | 'high' | 'medium'

export interface Spof {
  deviceId: string
  name: string
  site: string
  type: DeviceType
  isCore: boolean
  /** Ids that lose their route to the core if this device fails. */
  isolated: string[]
  isolatedCount: number
  severity: SpofSeverity
}

export interface SpofReport {
  coreId: string | null
  spofs: Spof[]
  /** Devices that are not articulation points (redundant members/leaves). */
  redundantCount: number
  score: number
}

/**
 * Identify single points of failure. For each articulation point, compute which
 * devices lose their uplink to the core when it fails, and grade the severity.
 */
export function detectSpofs(input: {
  devices: Device[]
  coreId?: string | null
  graph?: TopoGraph
}): SpofReport {
  const { devices } = input
  const graph = input.graph ?? buildAdjacency(devices)
  const core =
    input.coreId != null
      ? (devices.find((device) => device.id === input.coreId) ?? null)
      : pickCore(devices, graph.adjacency)
  const coreId = core?.id ?? null
  const allIds = devices.map((device) => device.id)
  const fleet = devices.length

  if (devices.length < 2 || coreId === null) {
    return { coreId, spofs: [], redundantCount: devices.length, score: 100 }
  }

  const points = new Set(articulationPoints(graph))
  const spofs: Spof[] = []
  for (const id of points) {
    const device = devices.find((item) => item.id === id)
    if (!device) continue
    let isolated: string[]
    if (id === coreId) {
      isolated = allIds.filter((other) => other !== id)
    } else {
      const reached = reachableFrom(graph.adjacency, coreId, new Set([id]))
      isolated = allIds.filter((other) => other !== id && !reached.has(other))
    }
    if (isolated.length === 0) continue
    const severity: SpofSeverity =
      id === coreId || isolated.length >= Math.ceil(fleet / 2)
        ? 'critical'
        : isolated.length >= 3
          ? 'high'
          : 'medium'
    spofs.push({
      deviceId: id,
      name: device.name,
      site: device.site,
      type: device.type,
      isCore: id === coreId,
      isolated,
      isolatedCount: isolated.length,
      severity,
    })
  }

  spofs.sort(
    (a, b) =>
      b.isolatedCount - a.isolatedCount || a.deviceId.localeCompare(b.deviceId),
  )
  const redundantCount = devices.filter(
    (device) => !points.has(device.id),
  ).length

  return {
    coreId,
    spofs,
    redundantCount,
    score: resilienceScoreFromSpofs(devices.length, redundantCount),
  }
}

function resilienceScoreFromSpofs(
  fleet: number,
  redundantCount: number,
): number {
  if (fleet === 0) return 100
  return Math.round((redundantCount / fleet) * 100)
}

export const SPOF_SEVERITY_LABELS: Record<SpofSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
}

/** Share of nodes with degree >= 2 (i.e. more than one physical neighbour). */
export function redundancyScore(graph: TopoGraph): number {
  const ids = [...graph.adjacency.keys()]
  if (ids.length === 0) return 1
  const redundant = ids.filter(
    (id) => (graph.adjacency.get(id)?.length ?? 0) >= 2,
  ).length
  return redundant / ids.length
}

export interface ResilienceScoreInput {
  devices: Device[]
  services: BusinessService[]
  incidents: Incident[]
  thresholds: Thresholds
  graph?: TopoGraph
}

export type ResilienceGrade = 'strong' | 'fair' | 'fragile' | 'critical'

export const RESILIENCE_GRADE_LABELS: Record<ResilienceGrade, string> = {
  strong: 'Strong',
  fair: 'Fair',
  fragile: 'Fragile',
  critical: 'Critical',
}

export const RESILIENCE_GRADE_HEX: Record<ResilienceGrade, string> = {
  strong: '#34d399',
  fair: '#fbbf24',
  fragile: '#fb923c',
  critical: '#f43f5e',
}

export function resilienceGrade(score: number): ResilienceGrade {
  if (score >= 75) return 'strong'
  if (score >= 55) return 'fair'
  if (score >= 35) return 'fragile'
  return 'critical'
}

/**
 * Live resilience score, 0-100. Blends device availability, topology
 * redundancy and the share of business services that are operational.
 */
export function resilienceScore(input: ResilienceScoreInput): number {
  const { devices } = input
  if (devices.length === 0) return 100
  const graph = input.graph ?? buildAdjacency(devices)
  const onlineRatio =
    devices.filter((device) => device.status === 'online').length /
    devices.length
  const redundancy = redundancyScore(graph)
  const healths =
    input.services.length > 0
      ? serviceHealthAll({
          services: input.services,
          devices: input.devices,
          incidents: input.incidents,
          thresholds: input.thresholds,
        })
      : []
  const operationalRatio =
    healths.length > 0
      ? healths.filter((health) => health.status === 'operational').length /
        healths.length
      : 1
  const score =
    100 * (0.4 * onlineRatio + 0.3 * redundancy + 0.3 * operationalRatio)
  return Math.round(score)
}

// --- Chaos simulation -------------------------------------------------------

export interface ChaosFaultSpec {
  kind: FaultInjection['kind']
  /** Device id (device-offline / saturate) or site name (site-outage). */
  target: string
}

export const CHAOS_DEFAULT_STEPS = 8
export const CHAOS_DEFAULT_SEED = 0x85ebca6b

export interface ChaosInput {
  devices: Device[]
  services: BusinessService[]
  incidents: Incident[]
  thresholds: Thresholds
  incidentFrequency: number
  now: number
  faults: ChaosFaultSpec[]
  /** Fractional traffic change applied to every device, e.g. 0.5 = +50%. */
  trafficScale?: number
  steps?: number
  seed?: number
}

export interface ChaosServiceOutcome {
  serviceId: string
  serviceName: string
  before: ServiceStatus
  after: ServiceStatus
  worsened: boolean
}

export interface ChaosPhase {
  online: number
  offline: number
  total: number
  score: number
}

export interface ChaosResult {
  before: ChaosPhase
  after: ChaosPhase
  offlineDeviceIds: string[]
  saturatedDeviceIds: string[]
  services: ChaosServiceOutcome[]
  degradedServices: number
  outageServices: number
  /** Post-chaos minus pre-chaos resilience score (negative when worse). */
  scoreDrop: number
}

const STATUS_RANK: Record<ServiceStatus, number> = {
  operational: 0,
  degraded: 1,
  partial: 2,
  outage: 3,
}

function phaseOf(
  devices: Device[],
  input: Omit<ChaosInput, 'faults' | 'trafficScale' | 'steps' | 'seed'>,
  incidents: Incident[],
): ChaosPhase {
  return {
    online: devices.filter((device) => device.status === 'online').length,
    offline: devices.filter((device) => device.status === 'offline').length,
    total: devices.length,
    score: resilienceScore({
      devices,
      services: input.services,
      incidents,
      thresholds: input.thresholds,
    }),
  }
}

/**
 * Run a combined-fault chaos experiment on a clone of the fleet. Returns the
 * before/after resilience phase, the devices knocked offline or saturated and
 * how each business service fared.
 */
export function simulateChaos(input: ChaosInput): ChaosResult {
  const steps = Math.max(1, input.steps ?? CHAOS_DEFAULT_STEPS)
  const rng = mulberry32(input.seed ?? CHAOS_DEFAULT_SEED)
  const trafficScale = input.trafficScale ?? 0
  const stepMs = 5000

  const before = phaseOf(input.devices, input, input.incidents)

  const faults: FaultInjection[] = input.faults.map((fault, index) => ({
    id: `chaos-${index}`,
    kind: fault.kind,
    target: fault.target,
    appliedAt: input.now,
    expiresAt: null,
  }))

  const clone = input.devices.map((device) => ({
    ...device,
    tags: [...device.tags],
    throughputMbps: device.throughputMbps * (1 + trafficScale),
  }))

  const beforeHealths =
    input.services.length > 0
      ? serviceHealthAll({
          services: input.services,
          devices: input.devices,
          incidents: input.incidents,
          thresholds: input.thresholds,
        })
      : []

  let working = clone
  let incidents = input.incidents
  for (let step = 0; step < steps; step += 1) {
    const result = runTick({
      devices: working,
      incidents,
      thresholds: input.thresholds,
      steps: 1,
      incidentFrequency: input.incidentFrequency,
      now: input.now + step * stepMs,
      rng,
      stepMs,
      faults,
    })
    working = result.devices
    incidents = result.incidents
  }

  const after = phaseOf(working, input, incidents)
  const afterHealths =
    input.services.length > 0
      ? serviceHealthAll({
          services: input.services,
          devices: working,
          incidents,
          thresholds: input.thresholds,
        })
      : []

  const byId = new Map(afterHealths.map((health) => [health.serviceId, health]))
  const services: ChaosServiceOutcome[] = beforeHealths.map((health) => {
    const afterHealth = byId.get(health.serviceId)
    const afterStatus = afterHealth?.status ?? health.status
    return {
      serviceId: health.serviceId,
      serviceName:
        input.services.find((service) => service.id === health.serviceId)
          ?.name ?? health.serviceId,
      before: health.status,
      after: afterStatus,
      worsened: STATUS_RANK[afterStatus] > STATUS_RANK[health.status],
    }
  })

  return {
    before,
    after,
    offlineDeviceIds: working
      .filter((device) => device.status === 'offline')
      .map((device) => device.id),
    saturatedDeviceIds: working
      .filter((device) => device.status === 'degraded')
      .map((device) => device.id),
    services,
    degradedServices: services.filter((entry) => entry.worsened).length,
    outageServices: services.filter((entry) => entry.after === 'outage').length,
    scoreDrop: after.score - before.score,
  }
}

export interface ChaosPreset {
  id: string
  name: string
  description: string
  faults: ChaosFaultSpec[]
  trafficScale: number
}

/** Ready-made chaos experiments derived from the current inventory. */
export function chaosPresets(input: {
  devices: Device[]
  coreId?: string | null
}): ChaosPreset[] {
  const { devices } = input
  const graph = buildAdjacency(devices)
  const core =
    input.coreId != null
      ? (devices.find((device) => device.id === input.coreId) ?? null)
      : pickCore(devices, graph.adjacency)

  const sites = new Map<string, number>()
  for (const device of devices) {
    sites.set(device.site, (sites.get(device.site) ?? 0) + 1)
  }
  const busiestSite = [...sites.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]?.[0]
  const busiestDevice = [...devices].sort(
    (a, b) => b.throughputMbps - a.throughputMbps || a.id.localeCompare(b.id),
  )[0]

  const presets: ChaosPreset[] = []
  if (core) {
    presets.push({
      id: 'core-outage',
      name: 'Lose the core',
      description: `Take ${core.name} offline — the fleet's most connected node.`,
      faults: [{ kind: 'device-offline', target: core.id }],
      trafficScale: 0,
    })
  }
  if (busiestSite) {
    presets.push({
      id: 'site-outage',
      name: `Lose ${busiestSite}`,
      description: `Sever the largest site and watch the services it backs fail.`,
      faults: [{ kind: 'site-outage', target: busiestSite }],
      trafficScale: 0,
    })
  }
  if (busiestDevice) {
    presets.push({
      id: 'saturate-busiest',
      name: 'Saturate busiest link',
      description: `Pin ${busiestDevice.name} to its capacity ceiling.`,
      faults: [{ kind: 'saturate', target: busiestDevice.id }],
      trafficScale: 0,
    })
  }
  presets.push({
    id: 'traffic-spike',
    name: 'Double traffic',
    description: 'Apply a +100% traffic surge across the whole fleet.',
    faults: [],
    trafficScale: 1,
  })
  if (core && busiestSite) {
    presets.push({
      id: 'worst-case',
      name: 'Worst case',
      description: 'Lose the core during a +50% traffic surge.',
      faults: [{ kind: 'device-offline', target: core.id }],
      trafficScale: 0.5,
    })
  }
  return presets
}

export function describeChaos(preset: ChaosPreset): string {
  const parts = preset.faults.map(
    (fault) =>
      `${fault.kind === 'site-outage' ? 'site' : 'device'} ${fault.target}`,
  )
  if (preset.trafficScale !== 0) {
    parts.push(
      `${preset.trafficScale > 0 ? '+' : ''}${Math.round(preset.trafficScale * 100)}% traffic`,
    )
  }
  return parts.length > 0 ? parts.join(' · ') : 'No faults'
}
