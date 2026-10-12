import type { Device, DeviceStatus } from '@/types'
import { deriveLinks, type TopoLink } from './topology'

/**
 * Path tracing over the inventory-derived topology.
 *
 * Given a source and destination device, find the hop-by-hop path, score each
 * hop's contribution to end-to-end latency and loss, surface the bottleneck
 * ("critical hop") and suggest a healthy detour. Pure graph algorithms derived
 * from `deriveLinks`, so the results are deterministic and unit-testable.
 */

export interface TopoGraph {
  /** device id -> adjacent device ids (undirected). */
  adjacency: Map<string, string[]>
  links: TopoLink[]
}

/** Build an undirected adjacency map, deriving links when none are supplied. */
export function buildAdjacency(
  devices: Device[],
  links?: TopoLink[],
): TopoGraph {
  const resolved = links ?? deriveLinks(devices)
  const adjacency = new Map<string, string[]>()
  for (const device of devices) adjacency.set(device.id, [])
  for (const link of resolved) {
    if (!adjacency.has(link.source)) adjacency.set(link.source, [])
    if (!adjacency.has(link.target)) adjacency.set(link.target, [])
    adjacency.get(link.source)?.push(link.target)
    adjacency.get(link.target)?.push(link.source)
  }
  return { adjacency, links: resolved }
}

/**
 * Shortest path (fewest hops) between two devices via breadth-first search.
 * Returns the inclusive node id list, or null when no route exists. When
 * `avoid` is given those nodes (and, implicitly, their links) are skipped.
 */
export function shortestPath(
  graph: TopoGraph,
  from: string,
  to: string,
  avoid: Set<string> = new Set(),
): string[] | null {
  if (from === to) return [from]
  if (avoid.has(from) || avoid.has(to)) return null
  if (!graph.adjacency.has(from) || !graph.adjacency.has(to)) return null

  const prev = new Map<string, string | null>([[from, null]])
  const queue: string[] = [from]

  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of graph.adjacency.get(current) ?? []) {
      if (avoid.has(next) || prev.has(next)) continue
      prev.set(next, current)
      if (next === to) {
        const path: string[] = []
        let node: string | null = to
        while (node !== null) {
          path.push(node)
          node = prev.get(node) ?? null
        }
        return path.reverse()
      }
      queue.push(next)
    }
  }
  return null
}

/**
 * Enumerate up to `limit` simple paths from `from` to `to`, skipping `avoid`
 * nodes, ordered by hop count. Bounded DFS keeps this safe on the small fleet.
 */
export function alternatePaths(
  graph: TopoGraph,
  from: string,
  to: string,
  avoid: Set<string> = new Set(),
  limit = 3,
): string[][] {
  if (from === to || avoid.has(from) || avoid.has(to)) return []
  const results: string[][] = []
  const path: string[] = [from]
  const onPath = new Set<string>([from])

  const walk = (node: string) => {
    if (results.length >= limit) return
    if (node === to) {
      results.push([...path])
      return
    }
    for (const next of graph.adjacency.get(node) ?? []) {
      if (results.length >= limit) return
      if (avoid.has(next) || onPath.has(next)) continue
      path.push(next)
      onPath.add(next)
      walk(next)
      path.pop()
      onPath.delete(next)
    }
  }
  walk(from)
  return results.sort((a, b) => a.length - b.length).slice(0, limit)
}

export interface HopMetric {
  deviceId: string
  device: Device
  latencyMs: number
  packetLossPct: number
  utilizationPct: number
  status: DeviceStatus
  /** Share of the path's total latency, in percent. */
  contribution: number
}

export type PathStatus = 'healthy' | 'degraded' | 'broken'

export interface PathResult {
  path: string[]
  hops: HopMetric[]
  /** Sum of per-hop latency in milliseconds. */
  totalLatencyMs: number
  /** End-to-end loss derived from the per-hop survival product, in percent. */
  totalLossPct: number
  worstLatencyMs: number
  worstLossPct: number
  /** Device id with the largest latency-plus-loss penalty, or null. */
  criticalHopId: string | null
  status: PathStatus
}

export const TRACER_DEGRADED_LOSS_PCT = 2

function utilizationOf(device: Device): number {
  if (!Number.isFinite(device.capacityMbps) || device.capacityMbps <= 0)
    return 0
  return Math.min(
    100,
    Math.max(0, (device.throughputMbps / device.capacityMbps) * 100),
  )
}

/**
 * Score a hop list. Latency is treated as additive end-to-end, packet loss
 * combines as a survival product (`1 - Π(1 - loss)`) which is how loss actually
 * accumulates across serial links.
 */
export function pathMetrics(path: string[], devices: Device[]): PathResult {
  const byId = new Map(devices.map((device) => [device.id, device]))
  const hops: HopMetric[] = []
  let totalLatencyMs = 0
  let survival = 1
  let worstLatencyMs = 0
  let worstLossPct = 0

  for (const id of path) {
    const device = byId.get(id)
    if (!device) continue
    totalLatencyMs += device.latencyMs
    survival *= 1 - device.packetLossPct / 100
    worstLatencyMs = Math.max(worstLatencyMs, device.latencyMs)
    worstLossPct = Math.max(worstLossPct, device.packetLossPct)
    hops.push({
      deviceId: id,
      device,
      latencyMs: device.latencyMs,
      packetLossPct: device.packetLossPct,
      utilizationPct: utilizationOf(device),
      status: device.status,
      contribution: 0,
    })
  }

  for (const hop of hops) {
    hop.contribution =
      totalLatencyMs > 0 ? (hop.latencyMs / totalLatencyMs) * 100 : 0
  }

  const totalLossPct = (1 - survival) * 100
  const criticalHop = hops.reduce<HopMetric | null>((worst, hop) => {
    if (!worst) return hop
    const hopPenalty = hop.latencyMs + hop.packetLossPct * 10
    const worstPenalty = worst.latencyMs + worst.packetLossPct * 10
    return hopPenalty > worstPenalty ? hop : worst
  }, null)

  const anyOffline = hops.some((hop) => hop.status === 'offline')
  const anyDegraded = hops.some((hop) => hop.status === 'degraded')

  let status: PathStatus = 'healthy'
  if (anyOffline) status = 'broken'
  else if (anyDegraded || totalLossPct >= TRACER_DEGRADED_LOSS_PCT) {
    status = 'degraded'
  }

  return {
    path,
    hops,
    totalLatencyMs,
    totalLossPct,
    worstLatencyMs,
    worstLossPct,
    criticalHopId: criticalHop?.deviceId ?? null,
    status,
  }
}

export interface TraceResult {
  fromId: string
  toId: string
  found: boolean
  primary: PathResult | null
  /** A route that avoids any offline node on the primary path, if one exists. */
  healthyDetour: PathResult | null
}

/** Full trace between two devices, including a detour around broken hops. */
export function trace(
  devices: Device[],
  fromId: string,
  toId: string,
  graph: TopoGraph = buildAdjacency(devices),
): TraceResult {
  const primaryPath = shortestPath(graph, fromId, toId)
  if (!primaryPath) {
    return { fromId, toId, found: false, primary: null, healthyDetour: null }
  }
  const primary = pathMetrics(primaryPath, devices)

  let healthyDetour: PathResult | null = null
  const offlineOnPath = new Set(
    primary.hops
      .filter((hop) => hop.status === 'offline')
      .map((h) => h.deviceId),
  )
  if (offlineOnPath.size > 0) {
    const detourPath = shortestPath(graph, fromId, toId, offlineOnPath)
    if (detourPath) healthyDetour = pathMetrics(detourPath, devices)
  }

  return { fromId, toId, found: true, primary, healthyDetour }
}

/** Longest single hop by latency, used to label the bottleneck. */
export function slowestHop(result: PathResult): HopMetric | null {
  return result.hops.reduce<HopMetric | null>((worst, hop) => {
    if (!worst || hop.latencyMs > worst.latencyMs) return hop
    return worst
  }, null)
}

export const PATH_STATUS_LABELS: Record<PathStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  broken: 'Broken',
}

export const PATH_STATUS_HEX: Record<PathStatus, string> = {
  healthy: '#34d399',
  degraded: '#fbbf24',
  broken: '#f43f5e',
}
