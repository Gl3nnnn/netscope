import type { Device } from '@/types'
import { deriveLinks, type TopoLink } from './topology'

/**
 * Dependency analysis over the inventory-derived topology.
 *
 * `deriveLinks` produces parent -> child edges (core feeds hubs, hubs feed
 * members). From that we answer two operational questions: "if this node
 * fails, what is the blast radius?" and "which single node best explains a set
 * of impacted devices?". Pure graph algorithms, unit-tested, cycle-safe.
 */

export interface DepGraph {
  /** source -> direct targets (who it feeds). */
  edges: Map<string, string[]>
  /** target -> direct sources (who feeds it). */
  reverse: Map<string, string[]>
}

export type Direction = 'downstream' | 'upstream'

function ensure(map: Map<string, string[]>, id: string): void {
  if (!map.has(id)) map.set(id, [])
}

/** Build a directed dependency graph, deriving links when none are supplied. */
export function buildGraph(devices: Device[], links?: TopoLink[]): DepGraph {
  const resolved = links ?? deriveLinks(devices)
  const edges = new Map<string, string[]>()
  const reverse = new Map<string, string[]>()

  for (const device of devices) {
    ensure(edges, device.id)
    ensure(reverse, device.id)
  }
  for (const link of resolved) {
    ensure(edges, link.source)
    ensure(reverse, link.source)
    ensure(edges, link.target)
    ensure(reverse, link.target)
    edges.get(link.source)?.push(link.target)
    reverse.get(link.target)?.push(link.source)
  }
  return { edges, reverse }
}

function reachable(map: Map<string, string[]>, start: string): string[] {
  const seen = new Set<string>([start])
  const queue: string[] = [start]
  const out: string[] = []
  while (queue.length > 0) {
    const id = queue.shift() as string
    for (const next of map.get(id) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      out.push(next)
      queue.push(next)
    }
  }
  return out
}

/** Every node reachable from `id` in the given direction (excluding `id`). */
export function blastRadius(
  graph: DepGraph,
  id: string,
  direction: Direction = 'downstream',
): string[] {
  return reachable(direction === 'downstream' ? graph.edges : graph.reverse, id)
}

/** Number of devices impacted if `id` fails. */
export function impactedDeviceCount(graph: DepGraph, id: string): number {
  return blastRadius(graph, id, 'downstream').length
}

export interface RootCause {
  deviceId: string
  score: number
  affected: string[]
  evidence: string[]
}

/**
 * Rank the impacted devices that best explain the outage. A candidate scores by
 * how much of the impacted set lies in its downstream blast radius, with a small
 * centrality tie-break so a shared upstream hub beats an isolated leaf.
 */
export function correlateRootCause(input: {
  devices: Device[]
  graph: DepGraph
  affected: string[]
  limit?: number
}): RootCause[] {
  const { devices, graph, affected } = input
  const limit = input.limit ?? 3
  const affectedSet = new Set(affected)
  if (affectedSet.size === 0) return []

  return devices
    .map((device) => {
      const downstream = blastRadius(graph, device.id, 'downstream')
      const covered = downstream.filter((id) => affectedSet.has(id))
      const coverage = covered.length / affectedSet.size
      const centrality = downstream.length
      // Prefer the highest coverage; among equals prefer the most specific
      // (smallest downstream) root so a shared hub beats the global core.
      const score = coverage - centrality / (devices.length * 10)
      return {
        deviceId: device.id,
        score,
        affected: covered,
        evidence: [
          `covers ${covered.length} of ${affectedSet.size} impacted device(s)`,
          `${centrality} device(s) in downstream blast radius`,
        ],
      }
    })
    .filter((candidate) => candidate.affected.length > 0)
    .sort((a, b) => b.score - a.score || b.affected.length - a.affected.length)
    .slice(0, limit)
}
