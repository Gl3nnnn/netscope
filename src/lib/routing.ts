/**
 * Routing Intelligence engine.
 *
 * Deterministic, dependency-free model of the control plane: autonomous
 * systems, BGP peering, OSPF areas and per-device routing tables derived from
 * the derived topology graph. Everything is seeded so the same fleet + seed
 * always produces the same control plane.
 */
import type { Device, DeviceType, Severity } from '@/types'
import { deriveLinks } from '@/lib/topology'
import { formatPct, round } from '@/lib/format'
import { hashSeed, mulberry32 } from '@/simulation/random'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type RoutingProtocol = 'connected' | 'static' | 'ospf' | 'bgp'

export type OspfArea = 0 | 1 | 2

/** A simulated autonomous system owned by the fleet or a peer provider. */
export interface AutonomousSystem {
  asn: number
  name: string
  /** Local ASes are those the fleet itself originates. */
  local: boolean
  /** Human-readable role for the scorecard. */
  role: 'backbone' | 'edge' | 'peer' | 'transit'
}

/** A BGP peering session between two ASes (or a device and a peer AS). */
export interface BgpSession {
  id: string
  localDeviceId: string
  localDeviceName: string
  localAsn: number
  remoteAsn: number
  remotePeer: string
  state: 'established' | 'idle' | 'active'
  /** Advertised prefix count from the remote peer. */
  prefixesReceived: number
  /** Prefixes we advertise to the peer. */
  prefixesSent: number
  /** Negotiated hold timer, seconds. */
  holdTimeSec: number
}

/** An OSPF adjacency between two routers. */
export interface OspfAdjacency {
  id: string
  aId: string
  aName: string
  bId: string
  bName: string
  area: OspfArea
  state: 'full' | 'two-way' | 'down'
  /** Simulated cost derived from latency. */
  cost: number
}

/** A single entry in a device's routing table. */
export interface RouteEntry {
  /** Destination prefix in CIDR form. */
  prefix: string
  protocol: RoutingProtocol
  /** Next-hop device id, or null for connected/local routes. */
  nextHopId: string | null
  nextHopName: string
  /** Administrative distance for tie-breaking (lower is preferred). */
  adminDistance: number
  /** Protocol metric (OSPF cost, BGP MED, hop count). */
  metric: number
  /** Age of the route in seconds since it was last (re)installed. */
  ageSec: number
}

/** A device's complete control-plane view. */
export interface RoutingTable {
  deviceId: string
  deviceName: string
  routerId: string
  ospfArea: OspfArea | null
  localAsn: number | null
  routes: RouteEntry[]
}

// ---------------------------------------------------------------------------
// Static reference data
// ---------------------------------------------------------------------------

export const LOCAL_ASN = 65001
export const LOCAL_AS_NAME = 'NetScope Backbone'

/** Peer/transit ASNs the edge routers peer with. */
export const PEER_ASES: AutonomousSystem[] = [
  { asn: 64512, name: 'Acme Transit', local: false, role: 'transit' },
  { asn: 64513, name: 'Northwind ISP', local: false, role: 'transit' },
  { asn: 64514, name: 'Contoso Peering', local: false, role: 'peer' },
  { asn: 64515, name: 'Fabrikam Edge', local: false, role: 'peer' },
]

export const PROTOCOL_LABELS: Record<RoutingProtocol, string> = {
  connected: 'Connected',
  static: 'Static',
  ospf: 'OSPF',
  bgp: 'BGP',
}

export const BGP_STATE_LABELS: Record<BgpSession['state'], string> = {
  established: 'Established',
  idle: 'Idle',
  active: 'Active',
}

export const OSPF_STATE_LABELS: Record<OspfAdjacency['state'], string> = {
  full: 'Full',
  'two-way': 'Two-way',
  down: 'Down',
}

/** Administrative distances (Cisco-like defaults) per protocol. */
const ADMIN_DISTANCE: Record<RoutingProtocol, number> = {
  connected: 0,
  static: 1,
  ospf: 110,
  bgp: 20,
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** Deterministic OSPF router-id from a device id (dotted-decimal form). */
export function routerIdFor(deviceId: string): string {
  const h = hashSeed(`routerid:${deviceId}`)
  return [
    1 + ((h >>> 24) & 127),
    (h >>> 16) & 255,
    (h >>> 8) & 255,
    h & 255,
  ].join('.')
}

/** Assign an OSPF area to a router based on its type and site hash. */
function ospfAreaFor(device: Device): OspfArea {
  // Core/backbone routers sit in area 0; branch routers in stub areas.
  if (device.type === 'router' && /hq|data center/i.test(device.site)) return 0
  const h = hashSeed(`area:${device.id}`)
  return (1 + (h % 2)) as OspfArea
}

/** OSPF cost from latency: faster link = lower cost. */
export function ospfCost(latencyMs: number): number {
  return Math.max(1, Math.round(latencyMs * 10))
}

/**
 * Build the AS topology: one local AS plus one AS per provider peer.
 */
export function buildAutonomousSystems(): AutonomousSystem[] {
  const local: AutonomousSystem = {
    asn: LOCAL_ASN,
    name: LOCAL_AS_NAME,
    local: true,
    role: 'backbone',
  }
  return [local, ...PEER_ASES]
}

/**
 * Build BGP peering sessions. Edge routers (per site) each establish a
 * session to one or two provider ASes, deterministically seeded.
 */
export function buildBgpSessions(devices: Device[], seed = 0): BgpSession[] {
  const routers = devices.filter(
    (device) => device.type === 'router' && device.status !== 'offline',
  )
  const rng = mulberry32(hashSeed(`bgp:${seed}`))
  const sessions: BgpSession[] = []

  routers.forEach((router, index) => {
    // Deterministically pick 1-2 peers for this router.
    const peerCount = 1 + (hashSeed(`bgp-n:${router.id}${seed}`) % 2)
    const chosen = new Set<number>()
    for (let i = 0; i < peerCount; i += 1) {
      let peerIndex = rng.int(0, PEER_ASES.length - 1)
      // Avoid duplicate peers on the same router.
      let guard = 0
      while (chosen.has(peerIndex) && guard < PEER_ASES.length) {
        peerIndex = (peerIndex + 1) % PEER_ASES.length
        guard += 1
      }
      chosen.add(peerIndex)
      const peer = PEER_ASES[peerIndex]!
      // ~92% of sessions establish; the rest flap or stay idle.
      const roll = hashSeed(`bgp-s:${router.id}:${peer.asn}:${seed}`)
      const state: BgpSession['state'] =
        roll % 16 === 0 ? 'idle' : roll % 12 === 0 ? 'active' : 'established'
      const established = state === 'established'
      sessions.push({
        id: `bgp-${router.id}-${peer.asn}`,
        localDeviceId: router.id,
        localDeviceName: router.name,
        localAsn: LOCAL_ASN,
        remoteAsn: peer.asn,
        remotePeer: peer.name,
        state,
        prefixesReceived: established ? 40 + (roll % 900) : 0,
        prefixesSent: established ? 12 + (index % 20) : 0,
        holdTimeSec: established ? 180 : 0,
      })
    }
  })

  return sessions.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Build OSPF adjacencies across every derived topology link whose endpoints
 * are both routing-capable (routers).
 */
export function buildOspfAdjacencies(devices: Device[]): OspfAdjacency[] {
  const byId = new Map(devices.map((device) => [device.id, device]))
  const links = deriveLinks(devices)
  const adjacencies: OspfAdjacency[] = []

  for (const link of links) {
    const a = byId.get(link.source)
    const b = byId.get(link.target)
    if (!a || !b) continue
    if (a.type !== 'router' || b.type !== 'router') continue
    if (a.status === 'offline' || b.status === 'offline') continue

    const areaA = ospfAreaFor(a)
    const areaB = ospfAreaFor(b)
    // Adjacency only forms within the same area.
    if (areaA !== areaB) continue

    const cost = ospfCost((a.latencyMs + b.latencyMs) / 2)
    const roll = hashSeed(`ospf:${a.id}:${b.id}`)
    const state: OspfAdjacency['state'] =
      a.status === 'degraded' || b.status === 'degraded'
        ? roll % 3 === 0
          ? 'two-way'
          : 'full'
        : roll % 20 === 0
          ? 'two-way'
          : 'full'

    // Canonical ordering so A↔B doesn't duplicate.
    const [first, second] = a.id < b.id ? [a, b] : [b, a]
    adjacencies.push({
      id: `ospf-${first!.id}-${second!.id}`,
      aId: first!.id,
      aName: first!.name,
      bId: second!.id,
      bName: second!.name,
      area: areaA,
      state,
      cost,
    })
  }

  return adjacencies.sort((a, b) => a.id.localeCompare(b.id))
}

// ---------------------------------------------------------------------------
// Routing tables (shortest-path derivation)
// ---------------------------------------------------------------------------

interface GraphEdge {
  to: string
  cost: number
}

/** Build an adjacency map (device id → edges) from OSPF adjacencies. */
function buildGraph(adjacencies: OspfAdjacency[]): Map<string, GraphEdge[]> {
  const graph = new Map<string, GraphEdge[]>()
  const push = (from: string, to: string, cost: number) => {
    const list = graph.get(from) ?? []
    list.push({ to, cost })
    graph.set(from, list)
  }
  for (const adjacency of adjacencies) {
    if (adjacency.state === 'down') continue
    push(adjacency.aId, adjacency.bId, adjacency.cost)
    push(adjacency.bId, adjacency.aId, adjacency.cost)
  }
  return graph
}

/** Dijkstra over the OSPF graph, returning dist + predecessor maps. */
function dijkstra(
  graph: Map<string, GraphEdge[]>,
  source: string,
): { dist: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>()
  const prev = new Map<string, string>()
  const visited = new Set<string>()
  dist.set(source, 0)

  // Simple O(V²) Dijkstra — the fleet is small and this stays dependency-free.
  for (;;) {
    let best: string | null = null
    let bestDist = Number.POSITIVE_INFINITY
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < bestDist) {
        bestDist = d
        best = node
      }
    }
    if (best === null) break
    visited.add(best)
    for (const edge of graph.get(best) ?? []) {
      const candidate = bestDist + edge.cost
      const current = dist.get(edge.to)
      if (current === undefined || candidate < current) {
        dist.set(edge.to, candidate)
        prev.set(edge.to, best)
      }
    }
  }

  return { dist, prev }
}

/** Reconstruct the next hop from `source` toward `target`. */
function nextHopOf(
  prev: Map<string, string>,
  source: string,
  target: string,
): string | null {
  let node = target
  const seen = new Set<string>()
  while (prev.has(node) && !seen.has(node)) {
    seen.add(node)
    const parent = prev.get(node)!
    if (parent === source) return node
    node = parent
  }
  return null
}

/**
 * Derive a full routing table for every routing-capable device.
 *
 * Routes are shortest-path OSPF routes over the adjacency graph, plus
 * connected prefixes for directly-attached subnets and a default route toward
 * the best BGP edge.
 */
export function buildRoutingTables(
  devices: Device[],
  adjacencies: OspfAdjacency[],
  bgpSessions: BgpSession[],
  seed = 0,
): RoutingTable[] {
  const routers = devices.filter((device) => device.type === 'router')
  const byId = new Map(devices.map((device) => [device.id, device]))
  const graph = buildGraph(adjacencies)
  const rng = mulberry32(hashSeed(`routes:${seed}`))

  // Connected prefixes: derive a deterministic /24 per router from its id.
  const connectedPrefix = (deviceId: string): string => {
    const h = hashSeed(`conn:${deviceId}`)
    return `10.${(h >>> 8) & 255}.${h & 255}.0/24`
  }

  const tables: RoutingTable[] = routers.map((router) => {
    const { dist, prev } = dijkstra(graph, router.id)
    const area = ospfAreaFor(router)
    const routes: RouteEntry[] = []

    // Connected route for the router's own subnet.
    routes.push({
      prefix: connectedPrefix(router.id),
      protocol: 'connected',
      nextHopId: null,
      nextHopName: router.name,
      adminDistance: ADMIN_DISTANCE.connected,
      metric: 0,
      ageSec: 86_400 + rng.int(0, 100_000),
    })

    // OSPF routes to every other reachable router.
    for (const [targetId, cost] of dist) {
      if (targetId === router.id) continue
      const target = byId.get(targetId)
      if (!target) continue
      const nextHopId = nextHopOf(prev, router.id, targetId)
      if (!nextHopId) continue
      const nextHop = byId.get(nextHopId)
      routes.push({
        prefix: connectedPrefix(targetId),
        protocol: 'ospf',
        nextHopId,
        nextHopName: nextHop?.name ?? nextHopId,
        adminDistance: ADMIN_DISTANCE.ospf,
        metric: cost,
        ageSec: rng.int(60, 86_400),
      })
    }

    // Default route toward the first established BGP peer's edge.
    const edge = bgpSessions.find(
      (session) =>
        session.localDeviceId === router.id && session.state === 'established',
    )
    if (edge) {
      routes.push({
        prefix: '0.0.0.0/0',
        protocol: 'bgp',
        nextHopId: router.id,
        nextHopName: edge.remotePeer,
        adminDistance: ADMIN_DISTANCE.bgp,
        metric: 0,
        ageSec: rng.int(300, 86_400),
      })
    } else {
      // Static default as a fallback when no BGP session is up.
      routes.push({
        prefix: '0.0.0.0/0',
        protocol: 'static',
        nextHopId: router.id,
        nextHopName: 'null0',
        adminDistance: ADMIN_DISTANCE.static,
        metric: 1,
        ageSec: 172_800,
      })
    }

    // Deterministic ordering: longest prefix first, then protocol.
    routes.sort((a, b) => {
      const prefixA = Number.parseInt(a.prefix.split('/')[1] ?? '32', 10)
      const prefixB = Number.parseInt(b.prefix.split('/')[1] ?? '32', 10)
      if (prefixA !== prefixB) return prefixB - prefixA
      return a.protocol.localeCompare(b.protocol)
    })

    return {
      deviceId: router.id,
      deviceName: router.name,
      routerId: routerIdFor(router.id),
      ospfArea: area,
      localAsn: edge ? LOCAL_ASN : null,
      routes,
    }
  })

  return tables.sort((a, b) => a.deviceId.localeCompare(b.deviceId))
}

// ---------------------------------------------------------------------------
// Health & anomalies
// ---------------------------------------------------------------------------

/** A routing problem worth surfacing to the operator. */
export interface RoutingIssue {
  id: string
  kind:
    | 'bgp-down'
    | 'ospf-adjacency-down'
    | 'suboptimal-path'
    | 'flapping'
    | 'blackhole'
  severity: Severity
  message: string
  deviceId: string | null
  deviceName: string
}

/**
 * Detect control-plane anomalies: downed BGP sessions, degraded OSPF
 * adjacencies, suboptimal paths (longer than the theoretical minimum) and
 * route flaps.
 */
export function detectRoutingIssues(
  bgpSessions: BgpSession[],
  adjacencies: OspfAdjacency[],
  tables: RoutingTable[],
  devices: Device[],
  seed = 0,
): RoutingIssue[] {
  const issues: RoutingIssue[] = []
  const byId = new Map(devices.map((device) => [device.id, device]))
  const rng = mulberry32(hashSeed(`rissues:${seed}`))

  for (const session of bgpSessions) {
    if (session.state === 'established') continue
    issues.push({
      id: `issue-${session.id}`,
      kind: 'bgp-down',
      severity: session.state === 'idle' ? 'critical' : 'high',
      message: `BGP session to ${session.remotePeer} (AS${session.remoteAsn}) is ${BGP_STATE_LABELS[session.state].toLowerCase()}.`,
      deviceId: session.localDeviceId,
      deviceName: session.localDeviceName,
    })
  }

  for (const adjacency of adjacencies) {
    if (adjacency.state === 'full') continue
    issues.push({
      id: `issue-${adjacency.id}`,
      kind: 'ospf-adjacency-down',
      severity: adjacency.state === 'down' ? 'critical' : 'medium',
      message: `OSPF adjacency ${adjacency.aName} ↔ ${adjacency.bName} (area ${adjacency.area}) is ${OSPF_STATE_LABELS[adjacency.state].toLowerCase()}.`,
      deviceId: adjacency.aId,
      deviceName: adjacency.aName,
    })
  }

  // Suboptimal path: an OSPF route whose metric is much larger than the best
  // path between the same endpoints in the graph.
  const graph = buildGraph(adjacencies)
  for (const table of tables) {
    for (const route of table.routes) {
      if (route.protocol !== 'ospf' || !route.nextHopId) continue
      const nextHop = byId.get(route.nextHopId)
      if (!nextHop) continue
      const { dist } = dijkstra(graph, table.deviceId)
      const best = dist.get(route.nextHopId)
      // If the first hop already carries a high cost, the path is suboptimal.
      if (
        best !== undefined &&
        route.metric > best * 2.5 &&
        route.metric > 200
      ) {
        issues.push({
          id: `issue-subopt-${table.deviceId}-${route.prefix}`,
          kind: 'suboptimal-path',
          severity: 'medium',
          message: `Suboptimal route to ${route.prefix} via ${route.nextHopName} (metric ${route.metric}).`,
          deviceId: table.deviceId,
          deviceName: table.deviceName,
        })
      }
    }
  }

  // Route flaps: deterministic per table.
  for (const table of tables) {
    if (rng.chance(0.06)) {
      issues.push({
        id: `issue-flap-${table.deviceId}`,
        kind: 'flapping',
        severity: 'medium',
        message: `Routing table on ${table.deviceName} flapped ${rng.int(3, 12)} times in the last hour.`,
        deviceId: table.deviceId,
        deviceName: table.deviceName,
      })
    }
  }

  // Blackhole: an offline router that other routers still route toward.
  for (const device of devices) {
    if (device.type !== 'router' || device.status !== 'offline') continue
    const referencing = tables.filter((table) =>
      table.routes.some((route) => route.nextHopId === device.id),
    )
    if (referencing.length > 0) {
      issues.push({
        id: `issue-blackhole-${device.id}`,
        kind: 'blackhole',
        severity: 'critical',
        message: `${referencing.length} router(s) still install routes toward offline ${device.name} — traffic blackholes.`,
        deviceId: device.id,
        deviceName: device.name,
      })
    }
  }

  const severityRank: Record<Severity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }
  return issues.sort((a, b) => {
    const diff = severityRank[a.severity] - severityRank[b.severity]
    if (diff !== 0) return diff
    return a.id.localeCompare(b.id)
  })
}

/** A convergence event: how long the control plane took to stabilise. */
export interface ConvergenceEvent {
  id: string
  scope: string
  /** Seconds until the routing domain reconverged. */
  seconds: number
  prefixesAffected: number
  severity: Severity
}

/**
 * Simulate convergence timelines. Each BGP/OSPF failure produces a
 * convergence event with a deterministic duration.
 */
export function convergenceTimeline(
  issues: RoutingIssue[],
  seed = 0,
): ConvergenceEvent[] {
  const rng = mulberry32(hashSeed(`conv:${seed}`))
  return issues
    .filter(
      (issue) =>
        issue.kind === 'bgp-down' ||
        issue.kind === 'ospf-adjacency-down' ||
        issue.kind === 'blackhole',
    )
    .map((issue) => ({
      id: `conv-${issue.id}`,
      scope: issue.deviceName,
      seconds: round(rng.range(2, 45), 1),
      prefixesAffected: rng.int(4, 220),
      severity: issue.severity,
    }))
    .sort((a, b) => b.seconds - a.seconds)
}

// ---------------------------------------------------------------------------
// Routing protocol summary
// ---------------------------------------------------------------------------

export interface RoutingSummary {
  /** Total routing-capable devices. */
  routers: number
  /** Routers participating in OSPF. */
  ospfRouters: number
  /** Routers with at least one established BGP session. */
  bgpRouters: number
  /** Total routes across the whole routing domain. */
  totalRoutes: number
  /** Average routes per router. */
  avgRoutesPerRouter: number
  /** Number of BGP sessions by state. */
  bgpByState: Record<BgpSession['state'], number>
  /** Number of OSPF adjacencies by state. */
  ospfByState: Record<OspfAdjacency['state'], number>
  /** Open routing issues. */
  issues: number
  /** 0-100 control-plane health score. */
  health: number
  /** Grade label for the scorecard. */
  grade: 'healthy' | 'degraded' | 'critical'
}

export function routingSummary(
  tables: RoutingTable[],
  bgpSessions: BgpSession[],
  adjacencies: OspfAdjacency[],
  issues: RoutingIssue[],
): RoutingSummary {
  const totalRoutes = tables.reduce(
    (sum, table) => sum + table.routes.length,
    0,
  )
  const bgpByState: Record<BgpSession['state'], number> = {
    established: 0,
    idle: 0,
    active: 0,
  }
  for (const session of bgpSessions) bgpByState[session.state] += 1

  const ospfByState: Record<OspfAdjacency['state'], number> = {
    full: 0,
    'two-way': 0,
    down: 0,
  }
  for (const adjacency of adjacencies) ospfByState[adjacency.state] += 1

  const bgpRouters = new Set(
    bgpSessions
      .filter((session) => session.state === 'established')
      .map((session) => session.localDeviceId),
  ).size

  // Health: start at 100, penalise downed sessions/adjacencies and issues.
  let health = 100
  health -= bgpByState.idle * 8
  health -= bgpByState.active * 4
  health -= ospfByState.down * 6
  health -= issues.filter((issue) => issue.severity === 'critical').length * 6
  health -= issues.filter((issue) => issue.severity === 'high').length * 3
  health = Math.max(0, Math.min(100, Math.round(health)))

  const grade: RoutingSummary['grade'] =
    health >= 85 ? 'healthy' : health >= 60 ? 'degraded' : 'critical'

  return {
    routers: tables.length,
    ospfRouters: adjacencies.length > 0 ? tables.length : 0,
    bgpRouters,
    totalRoutes,
    avgRoutesPerRouter:
      tables.length > 0 ? round(totalRoutes / tables.length, 1) : 0,
    bgpByState,
    ospfByState,
    issues: issues.length,
    health,
    grade,
  }
}

/** Human-readable helper for the health percentage. */
export function formatRoutingHealth(health: number): string {
  return formatPct(health, 0)
}

/** Router capability check reused by the page and tests. */
export function isRoutingCapable(type: DeviceType): boolean {
  return type === 'router'
}
