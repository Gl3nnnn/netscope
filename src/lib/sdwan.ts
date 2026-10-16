/**
 * SD-WAN overlay steering.
 *
 * Builds one overlay tunnel per underlay WAN circuit (from the WAN engine),
 * scores path quality, detects brownouts (loss/jitter/latency breaches) and
 * steers every classified flow (via the QoS engine's app→class mapping) onto
 * the best healthy path for its traffic class — failing over when the
 * preferred path is degraded. Pure and deterministic.
 */

import { classifyFlow, type TrafficClass } from '@/lib/qos'
import { buildCircuits, type Circuit, type CircuitKind } from '@/lib/wan'
import type { FlowRecord } from '@/lib/flow'
import type { Device } from '@/types'

export const BROWNOUT_LOSS_PCT = 2
export const BROWNOUT_JITTER_MS = 30
export const BROWNOUT_LATENCY_MS = 150

/** Preferred underlay kinds per traffic class, best first. */
export const CLASS_PATH_PREFERENCE: Record<TrafficClass, CircuitKind[]> = {
  realtime: ['mpls', 'dia', 'broadband', 'lte'],
  interactive: ['dia', 'mpls', 'broadband', 'lte'],
  transactional: ['dia', 'mpls', 'broadband', 'lte'],
  bulk: ['broadband', 'dia', 'mpls', 'lte'],
  'best-effort': ['broadband', 'lte', 'mpls', 'dia'],
}

export interface Tunnel {
  id: string
  site: string
  circuitId: string
  carrier: string
  kind: CircuitKind
  role: 'primary' | 'backup'
  bandwidthMbps: number
  latencyMs: number
  jitterMs: number
  lossPct: number
  status: Circuit['status']
  /** 0–100 composite path quality (higher is better). */
  quality: number
  /** True when measured metrics breach the brownout thresholds. */
  brownout: boolean
}

/** Composite path quality: 100 minus latency/jitter/loss/status penalties. */
export function pathQuality(circuit: Circuit): number {
  const latencyPenalty = Math.min(circuit.latencyMs / 5, 30)
  const jitterPenalty = Math.min(circuit.jitterMs / 2, 25)
  const lossPenalty = Math.min(circuit.lossPct * 10, 30)
  const statusPenalty =
    circuit.status === 'down' ? 15 : circuit.status === 'degraded' ? 8 : 0
  return Math.max(
    0,
    Math.round(
      100 - latencyPenalty - jitterPenalty - lossPenalty - statusPenalty,
    ),
  )
}

export function isBrownout(circuit: Circuit): boolean {
  return (
    circuit.status === 'down' ||
    circuit.lossPct > BROWNOUT_LOSS_PCT ||
    circuit.jitterMs > BROWNOUT_JITTER_MS ||
    circuit.latencyMs > BROWNOUT_LATENCY_MS
  )
}

export function buildTunnels(circuits: Circuit[]): Tunnel[] {
  return circuits.map((circuit) => ({
    id: `tun-${circuit.id}`,
    site: circuit.site,
    circuitId: circuit.id,
    carrier: circuit.carrier,
    kind: circuit.kind,
    role: circuit.role,
    bandwidthMbps: circuit.bandwidthMbps,
    latencyMs: circuit.latencyMs,
    jitterMs: circuit.jitterMs,
    lossPct: circuit.lossPct,
    status: circuit.status,
    quality: pathQuality(circuit),
    brownout: isBrownout(circuit),
  }))
}

export interface SteeringDecision {
  flowId: string
  application: FlowRecord['application']
  class: TrafficClass
  site: string
  throughputMbps: number
  /** Chosen tunnel id, null when the site has no path at all. */
  pathId: string | null
  pathKind: CircuitKind | null
  /** True when the class-preferred path was browned out and we failed over. */
  failedOver: boolean
  reason: string
}

export interface SteeringEvent {
  id: string
  site: string
  circuitId: string
  kind: CircuitKind
  carrier: string
  reason: 'brownout' | 'recover'
}

export interface SdwanSummary {
  tunnels: number
  brownouts: number
  flows: number
  steered: number
  failedOver: number
  steeredPct: number
  sites: number
  sitesWithFailover: number
}

export interface SdwanResult {
  tunnels: Tunnel[]
  decisions: SteeringDecision[]
  events: SteeringEvent[]
  summary: SdwanSummary
}

export interface SdwanInput {
  devices: Device[]
  flows: FlowRecord[]
  seed?: number
}

const round1 = (value: number) => Math.round(value * 10) / 10

/**
 * Steer each flow onto the best healthy tunnel at its site: class preference
 * first, path quality second. Pure — tests can craft tunnel fixtures directly.
 */
export function steerFlows(
  tunnels: Tunnel[],
  flows: FlowRecord[],
  siteOf: ReadonlyMap<string, string>,
): SteeringDecision[] {
  const bySite = new Map<string, Tunnel[]>()
  for (const tunnel of tunnels) {
    const list = bySite.get(tunnel.site) ?? []
    list.push(tunnel)
    bySite.set(tunnel.site, list)
  }

  return flows.map((flow) => {
    const site = siteOf.get(flow.sourceDeviceId) ?? flow.destSite
    const trafficClass = classifyFlow(flow)
    const preference = CLASS_PATH_PREFERENCE[trafficClass]
    const siteTunnels = (bySite.get(site) ?? []).filter(
      (tunnel) => tunnel.status !== 'down',
    )

    const healthy = siteTunnels.filter((tunnel) => !tunnel.brownout)
    const candidates = healthy.length > 0 ? healthy : siteTunnels

    if (candidates.length === 0) {
      return {
        flowId: flow.id,
        application: flow.application,
        class: trafficClass,
        site,
        throughputMbps: flow.throughputMbps,
        pathId: null,
        pathKind: null,
        failedOver: true,
        reason: 'no-path',
      }
    }

    // Rank candidates: preference order first, then path quality.
    const ranked = [...candidates].sort((a, b) => {
      const prefA = preference.indexOf(a.kind)
      const prefB = preference.indexOf(b.kind)
      if (prefA !== prefB) return prefA - prefB
      return b.quality - a.quality
    })
    const chosen = ranked[0]!
    const preferred = preference[0]!
    // Failover = the class-preferred underlay kind exists at the site but is
    // unusable (brownout or down), so we steered onto the next-best path.
    const preferredExists = siteTunnels.some(
      (tunnel) => tunnel.kind === preferred,
    )
    const preferredHealthy = healthy.some((tunnel) => tunnel.kind === preferred)
    const failedOver = preferredExists && !preferredHealthy

    return {
      flowId: flow.id,
      application: flow.application,
      class: trafficClass,
      site,
      throughputMbps: flow.throughputMbps,
      pathId: chosen.id,
      pathKind: chosen.kind,
      failedOver,
      reason: failedOver
        ? healthy.length === 0
          ? 'all-paths-brownout'
          : 'preferred-brownout'
        : 'on-preference',
    }
  })
}

export function runSdwan(input: SdwanInput): SdwanResult {
  const { devices, flows, seed = 0 } = input
  const circuits = buildCircuits(devices, {}, seed)
  const tunnels = buildTunnels(circuits)
  const siteOf = new Map(devices.map((device) => [device.id, device.site]))

  const decisions = steerFlows(tunnels, flows, siteOf)

  const events: SteeringEvent[] = tunnels
    .filter((tunnel) => tunnel.brownout)
    .map((tunnel) => ({
      id: `evt-${tunnel.id}`,
      site: tunnel.site,
      circuitId: tunnel.circuitId,
      kind: tunnel.kind,
      carrier: tunnel.carrier,
      reason: 'brownout' as const,
    }))

  const failedOver = decisions.filter((decision) => decision.failedOver).length
  const steered = decisions.filter(
    (decision) => decision.pathId !== null,
  ).length
  const siteSet = new Set(tunnels.map((tunnel) => tunnel.site))
  const failoverSites = new Set(
    decisions
      .filter((decision) => decision.failedOver)
      .map((decision) => decision.site),
  )

  const summary: SdwanSummary = {
    tunnels: tunnels.length,
    brownouts: tunnels.filter((tunnel) => tunnel.brownout).length,
    flows: decisions.length,
    steered,
    failedOver,
    steeredPct:
      decisions.length === 0 ? 0 : round1((steered / decisions.length) * 100),
    sites: siteSet.size,
    sitesWithFailover: failoverSites.size,
  }

  return { tunnels, decisions, events, summary }
}
