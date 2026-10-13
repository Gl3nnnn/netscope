import type { Device, DeviceStatus } from '@/types'
import { deriveLinks, type TopoLink } from './topology'
import {
  evaluatePolicy,
  selectorMatches,
  type PolicyDecision,
  type PolicyProto,
  type PolicyRule,
} from './policy'

/**
 * Reachability analysis: combine the physical topology with the L3/L4 policy.
 * A flow can only reach its destination when a physical path exists *and* the
 * policy allows it. Pure graph + policy maths, unit-tested.
 */

export type ReachReason = 'allowed' | 'no-path' | 'denied'

export interface ReachResult {
  reachable: boolean
  reason: ReachReason
  decision: PolicyDecision
  /** Device ids along the physical path, inclusive, or [] when unreachable. */
  path: string[]
}

export interface ReachOptions {
  port: number
  proto: Exclude<PolicyProto, 'any'>
}

export const DEFAULT_REACH_OPTIONS: ReachOptions = {
  port: 443,
  proto: 'tcp',
}

function adjacency(
  devices: Device[],
  links?: TopoLink[],
): Map<string, string[]> {
  const resolved = links ?? deriveLinks(devices)
  const map = new Map<string, string[]>()
  for (const device of devices) map.set(device.id, [])
  for (const link of resolved) {
    if (!map.has(link.source)) map.set(link.source, [])
    if (!map.has(link.target)) map.set(link.target, [])
    map.get(link.source)?.push(link.target)
    map.get(link.target)?.push(link.source)
  }
  return map
}

/** Undirected BFS shortest path (inclusive of endpoints), or null. */
export function physicalPath(
  devices: Device[],
  srcId: string,
  dstId: string,
  links?: TopoLink[],
): string[] | null {
  if (srcId === dstId) return [srcId]
  const map = adjacency(devices, links)
  const prev = new Map<string, string>()
  const seen = new Set<string>([srcId])
  const queue: string[] = [srcId]
  while (queue.length > 0) {
    const id = queue.shift() as string
    for (const next of map.get(id) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      prev.set(next, id)
      if (next === dstId) {
        const path = [dstId]
        let cursor = dstId
        while (prev.has(cursor)) {
          cursor = prev.get(cursor) as string
          path.unshift(cursor)
        }
        return path
      }
      queue.push(next)
    }
  }
  return null
}

export function reachability(
  devices: Device[],
  rules: PolicyRule[],
  srcId: string,
  dstId: string,
  options: ReachOptions = DEFAULT_REACH_OPTIONS,
  links?: TopoLink[],
): ReachResult {
  const src = devices.find((device) => device.id === srcId)
  const dst = devices.find((device) => device.id === dstId)
  if (!src || !dst) {
    return {
      reachable: false,
      reason: 'no-path',
      decision: { action: 'deny', rule: null },
      path: [],
    }
  }

  const path = physicalPath(devices, srcId, dstId, links)
  if (!path || path.length === 0) {
    return {
      reachable: false,
      reason: 'no-path',
      decision: evaluatePolicy(rules, { src, dst, ...options }),
      path: [],
    }
  }

  const decision = evaluatePolicy(rules, { src, dst, ...options })
  if (decision.action !== 'allow') {
    return { reachable: false, reason: 'denied', decision, path }
  }
  return { reachable: true, reason: 'allowed', decision, path }
}

export interface ReachabilityMatrix {
  ids: string[]
  /** cells[i][j] = flow reachable from ids[i] to ids[j] (i !== j). */
  cells: boolean[][]
  allowed: number
  denied: number
  noPath: number
}

/** All-pairs reachability under a fixed port/proto. */
export function reachabilityMatrix(
  devices: Device[],
  rules: PolicyRule[],
  options: ReachOptions = DEFAULT_REACH_OPTIONS,
  links?: TopoLink[],
): ReachabilityMatrix {
  const ids = devices.map((device) => device.id)
  let allowed = 0
  let denied = 0
  let noPath = 0
  const cells = ids.map((srcId) =>
    ids.map((dstId) => {
      if (srcId === dstId) return false
      const result = reachability(devices, rules, srcId, dstId, options, links)
      if (result.reachable) allowed += 1
      else if (result.reason === 'denied') denied += 1
      else noPath += 1
      return result.reachable
    }),
  )
  return { ids, cells, allowed, denied, noPath }
}

export interface PathHop {
  deviceId: string
  name: string
  status: DeviceStatus
}

export interface PathExplanation {
  found: boolean
  hops: PathHop[]
  decision: PolicyDecision
  allowed: boolean
  reason: ReachReason | 'offline'
  /** Device ids of offline hops that break the path. */
  downHops: string[]
}

/**
 * Explain the end-to-end decision for a flow: the physical route, which hops are
 * down, and the policy verdict.
 */
export function explainPath(
  devices: Device[],
  rules: PolicyRule[],
  srcId: string,
  dstId: string,
  options: ReachOptions = DEFAULT_REACH_OPTIONS,
  links?: TopoLink[],
): PathExplanation {
  const result = reachability(devices, rules, srcId, dstId, options, links)
  const byId = new Map(devices.map((device) => [device.id, device]))
  const hops: PathHop[] = result.path
    .map((id) => byId.get(id))
    .filter((device): device is Device => Boolean(device))
    .map((device) => ({
      deviceId: device.id,
      name: device.name,
      status: device.status,
    }))
  const downHops = hops
    .filter((hop) => hop.status === 'offline')
    .map((hop) => hop.deviceId)

  return {
    found: result.path.length > 0,
    hops,
    decision: result.decision,
    allowed: result.reachable && downHops.length === 0,
    reason: result.reachable
      ? downHops.length > 0
        ? 'offline'
        : 'allowed'
      : result.reason,
    downHops,
  }
}

export interface PolicyPair {
  src: string
  dst: string
}

export interface PolicyImpact {
  opened: PolicyPair[]
  closed: PolicyPair[]
}

/**
 * Compare the current policy against a single proposed rule (evaluated at the
 * top of the list). Reports which flows would be newly opened or closed.
 */
export function whatIfPolicy(
  devices: Device[],
  rules: PolicyRule[],
  proposed: Omit<PolicyRule, 'id'>,
  options: ReachOptions = DEFAULT_REACH_OPTIONS,
  links?: TopoLink[],
): PolicyImpact {
  const candidate: PolicyRule = { ...proposed, id: '__proposed__' }
  const before = reachabilityMatrix(devices, rules, options, links)
  const after = reachabilityMatrix(
    devices,
    [candidate, ...rules],
    options,
    links,
  )

  const opened: PolicyPair[] = []
  const closed: PolicyPair[] = []
  for (let i = 0; i < before.ids.length; i += 1) {
    for (let j = 0; j < before.ids.length; j += 1) {
      if (before.cells[i][j] === after.cells[i][j]) continue
      const pair = { src: before.ids[i], dst: before.ids[j] }
      if (after.cells[i][j]) opened.push(pair)
      else closed.push(pair)
    }
  }
  return { opened, closed }
}

/** True when a selector matches at least one device (used by the rule builder). */
export function selectorHasTargets(
  selector: string,
  devices: Device[],
): boolean {
  return devices.some((device) => selectorMatches(selector, device))
}
