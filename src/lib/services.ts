import type { Device, Incident, MetricSample, Thresholds } from '@/types'
import { average } from './aggregate'
import { computeHealthScore } from './health'

/**
 * Business service catalog (ITSM / BSM layer).
 *
 * A business service maps a real, customer-visible outcome ("Payments API")
 * onto the infrastructure that delivers it (devices and sites). This lets the
 * NOC answer the questions an executive actually cares about: "which *services*
 * are impacted?", "how critical is this?" and "what is the business blast
 * radius of an incident?". Everything here is pure and deterministic.
 */

export type ServiceTier = 'p1' | 'p2' | 'p3' | 'p4'

export type ServiceImpact =
  'revenue' | 'regulatory' | 'productivity' | 'internal'

export type ServiceStatus = 'operational' | 'degraded' | 'partial' | 'outage'

export interface BusinessService {
  id: string
  name: string
  description: string
  tier: ServiceTier
  impact: ServiceImpact
  /** Device ids explicitly owned by the service. */
  deviceIds: string[]
  /** Sites the service depends on; every device at these sites is a member. */
  siteNames: string[]
  /** Accountable owner (team or person). */
  owner?: string
}

export const SERVICE_TIER_LABELS: Record<ServiceTier, string> = {
  p1: 'P1 · Critical',
  p2: 'P2 · High',
  p3: 'P3 · Medium',
  p4: 'P4 · Low',
}

export const SERVICE_TIER_WEIGHT: Record<ServiceTier, number> = {
  p1: 4,
  p2: 3,
  p3: 2,
  p4: 1,
}

export const SERVICE_IMPACT_LABELS: Record<ServiceImpact, string> = {
  revenue: 'Revenue',
  regulatory: 'Regulatory',
  productivity: 'Productivity',
  internal: 'Internal',
}

export const SERVICE_IMPACT_WEIGHT: Record<ServiceImpact, number> = {
  revenue: 1.5,
  regulatory: 1.4,
  productivity: 1.1,
  internal: 1,
}

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial: 'Partial outage',
  outage: 'Major outage',
}

export const SERVICE_STATUS_HEX: Record<ServiceStatus, string> = {
  operational: '#34d399',
  degraded: '#fbbf24',
  partial: '#fb923c',
  outage: '#f43f5e',
}

const STATUS_RANK: Record<ServiceStatus, number> = {
  operational: 0,
  degraded: 1,
  partial: 2,
  outage: 3,
}

const RANK_STATUS: ServiceStatus[] = [
  'operational',
  'degraded',
  'partial',
  'outage',
]

/** Devices that deliver a service (explicit ids plus every device at its sites). */
export function resolveServiceDevices(
  service: BusinessService,
  devices: Device[],
): Device[] {
  const explicit = new Set(service.deviceIds)
  const sites = new Set(service.siteNames)
  return devices.filter(
    (device) => explicit.has(device.id) || sites.has(device.site),
  )
}

/** Whether a device is a member of the service. */
export function serviceCoversDevice(
  service: BusinessService,
  device: Device,
): boolean {
  return (
    service.deviceIds.includes(device.id) ||
    service.siteNames.includes(device.site)
  )
}

function baseStatus(members: Device[]): ServiceStatus {
  if (members.length === 0) return 'operational'
  const offline = members.filter((device) => device.status === 'offline').length
  const online = members.filter((device) => device.status === 'online').length
  const degraded = members.filter(
    (device) => device.status === 'degraded',
  ).length
  if (online === 0 || offline / members.length >= 0.5) return 'outage'
  if (offline > 0) return 'partial'
  if (degraded > 0) return 'degraded'
  return 'operational'
}

function escalate(status: ServiceStatus, incidents: Incident[]): ServiceStatus {
  const open = incidents.filter((incident) => incident.status !== 'resolved')
  const hasCritical = open.some((incident) => incident.severity === 'critical')
  const hasHigh = open.some((incident) => incident.severity === 'high')
  let rank = STATUS_RANK[status]
  if (hasCritical) rank = Math.max(rank, STATUS_RANK.partial)
  else if (hasHigh) rank = Math.max(rank, STATUS_RANK.degraded)
  return RANK_STATUS[rank]
}

export interface ServiceHealth {
  serviceId: string
  status: ServiceStatus
  /** Mean health score of member devices, 0-100. */
  healthPct: number
  /** Mean availability of member devices, 0-100. */
  availabilityPct: number
  total: number
  onlineCount: number
  degradedCount: number
  offlineCount: number
  /** Members that are degraded or offline. */
  offendingDeviceIds: string[]
  /** Ids of open incidents touching the service. */
  openIncidentIds: string[]
}

function healthFor(
  service: BusinessService,
  members: Device[],
  thresholds: Thresholds,
): { healthPct: number; availabilityPct: number } {
  void service
  if (members.length === 0) return { healthPct: 100, availabilityPct: 100 }
  return {
    healthPct: average(
      members.map((device) => computeHealthScore(device, thresholds)),
    ),
    availabilityPct: average(members.map((device) => device.availabilityPct)),
  }
}

function incidentsTouching(
  incidentMemberIds: Set<string>,
  incidents: Incident[],
): Incident[] {
  return incidents.filter((incident) =>
    incident.deviceIds.some((id) => incidentMemberIds.has(id)),
  )
}

export function serviceHealth(input: {
  service: BusinessService
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
}): ServiceHealth {
  const { service, devices, incidents, thresholds } = input
  const members = resolveServiceDevices(service, devices)
  const memberIds = new Set(members.map((device) => device.id))
  const touching = incidentsTouching(memberIds, incidents)
  const openTouching = touching.filter(
    (incident) => incident.status !== 'resolved',
  )
  const { healthPct, availabilityPct } = healthFor(service, members, thresholds)

  return {
    serviceId: service.id,
    status: escalate(baseStatus(members), openTouching),
    healthPct,
    availabilityPct,
    total: members.length,
    onlineCount: members.filter((device) => device.status === 'online').length,
    degradedCount: members.filter((device) => device.status === 'degraded')
      .length,
    offlineCount: members.filter((device) => device.status === 'offline')
      .length,
    offendingDeviceIds: members
      .filter((device) => device.status !== 'online')
      .map((device) => device.id),
    openIncidentIds: openTouching.map((incident) => incident.id),
  }
}

export function serviceHealthAll(input: {
  services: BusinessService[]
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
}): ServiceHealth[] {
  return input.services.map((service) => serviceHealth({ ...input, service }))
}

/** Mean uptime of a service's members, using rolling history when available. */
export function serviceUptimePct(
  service: BusinessService,
  devices: Device[],
  history: Record<string, MetricSample[]>,
): number {
  const members = resolveServiceDevices(service, devices)
  if (members.length === 0) return 100
  return average(
    members.map((device) => {
      const samples = history[device.id]
      if (samples && samples.length > 0) {
        return average(samples.map((sample) => sample.availabilityPct))
      }
      return device.availabilityPct
    }),
  )
}

const SEVERITY_FACTOR: Record<Incident['severity'], number> = {
  critical: 1,
  high: 0.7,
  medium: 0.4,
  low: 0.2,
}

export interface ServiceImpactEntry {
  serviceId: string
  serviceName: string
  tier: ServiceTier
  impact: ServiceImpact
  status: ServiceStatus
  /** Member devices caught in the incident. */
  affectedDeviceIds: string[]
  /** Weighted business-impact score (higher is worse). */
  score: number
}

/**
 * Which business services an incident touches, and how badly. The score blends
 * the service tier, the impact kind and the incident severity so a critical hit
 * on a P1 revenue service ranks far above a low hit on an internal tool.
 */
export function incidentBusinessImpact(
  incident: Incident,
  services: BusinessService[],
  devices: Device[],
): ServiceImpactEntry[] {
  const affectedSet = new Set(incident.deviceIds)
  const factor = SEVERITY_FACTOR[incident.severity]

  return services
    .map((service) => {
      const members = resolveServiceDevices(service, devices)
      const affected = members
        .filter((device) => affectedSet.has(device.id))
        .map((device) => device.id)
      const score =
        SERVICE_TIER_WEIGHT[service.tier] *
        SERVICE_IMPACT_WEIGHT[service.impact] *
        factor *
        (affected.length > 0 ? 1 : 0)
      return {
        serviceId: service.id,
        serviceName: service.name,
        tier: service.tier,
        impact: service.impact,
        status: affected.length > 0 ? 'partial' : 'operational',
        affectedDeviceIds: affected,
        score,
      } satisfies ServiceImpactEntry
    })
    .filter((entry) => entry.affectedDeviceIds.length > 0)
    .sort((a, b) => b.score - a.score)
}

const STATUS_FACTOR: Record<ServiceStatus, number> = {
  operational: 0,
  degraded: 0.4,
  partial: 0.7,
  outage: 1,
}

export interface BusinessImpactSummary {
  totalServices: number
  /** Services not currently operational. */
  atRisk: number
  degraded: number
  partial: number
  outage: number
  /** Weighted fleet business-risk score (higher is worse). */
  score: number
  label: string
  /** The highest-scoring non-operational services. */
  worst: ServiceImpactEntry[]
}

function impactLabel(score: number): string {
  if (score <= 0) return 'All services operational'
  if (score < 3) return 'Minor service risk'
  if (score < 8) return 'Elevated service risk'
  return 'Major service impact'
}

export function businessImpactSummary(input: {
  services: BusinessService[]
  devices: Device[]
  incidents: Incident[]
  thresholds: Thresholds
  limit?: number
}): BusinessImpactSummary {
  const healths = serviceHealthAll(input)
  const byId = new Map(input.services.map((service) => [service.id, service]))

  const entries: ServiceImpactEntry[] = healths
    .filter((health) => health.status !== 'operational')
    .map((health) => {
      const service = byId.get(health.serviceId) as BusinessService
      return {
        serviceId: service.id,
        serviceName: service.name,
        tier: service.tier,
        impact: service.impact,
        status: health.status,
        affectedDeviceIds: health.offendingDeviceIds,
        score:
          SERVICE_TIER_WEIGHT[service.tier] *
          SERVICE_IMPACT_WEIGHT[service.impact] *
          STATUS_FACTOR[health.status],
      }
    })
    .sort((a, b) => b.score - a.score)

  const score = entries.reduce((sum, entry) => sum + entry.score, 0)

  return {
    totalServices: input.services.length,
    atRisk: entries.length,
    degraded: healths.filter((health) => health.status === 'degraded').length,
    partial: healths.filter((health) => health.status === 'partial').length,
    outage: healths.filter((health) => health.status === 'outage').length,
    score: Math.round(score * 100) / 100,
    label: impactLabel(score),
    worst: entries.slice(0, input.limit ?? 5),
  }
}
