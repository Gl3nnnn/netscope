import type { Device, Severity } from '@/types'
import { hashSeed } from '@/simulation/random'
import { deriveLinks } from '@/lib/topology'
import { scanFleet, type VulnStatus } from '@/lib/vulnerabilities'
import {
  certFindings,
  seedCertificates,
  withOverrides,
  type CertOverrides,
} from '@/lib/certificates'
import type { BusinessService, ServiceTier } from '@/lib/services'

export type ExposureKind = 'open-port' | 'expired-cert' | 'critical-vuln'
export type AttackStepKind = 'entry' | 'lateral' | 'target'
export type RiskBand = 'critical' | 'high' | 'medium' | 'low'

export interface Exposure {
  id: string
  deviceId: string
  deviceName: string
  kind: ExposureKind
  detail: string
  severity: Severity
}

export interface AttackStep {
  kind: AttackStepKind
  deviceId: string
  deviceName: string
  detail: string
  severity: Severity
}

export interface AttackPath {
  id: string
  entryId: string
  targetServiceId: string
  targetService: string
  tier: ServiceTier
  steps: AttackStep[]
  lateralHops: number
  risk: number
  band: RiskBand
  mitigations: string[]
}

export interface ChokePoint {
  deviceId: string
  deviceName: string
  pathCount: number
  sharePct: number
}

export interface AttackSummary {
  paths: number
  critical: number
  high: number
  medium: number
  low: number
  exposures: number
  topRisk: number
  avgRisk: number
}

export interface AttackResult {
  paths: AttackPath[]
  exposures: Exposure[]
  chokePoints: ChokePoint[]
  summary: AttackSummary
}

export interface AttackInput {
  devices: Device[]
  seed: number
  statuses: Record<string, VulnStatus>
  certOverrides: CertOverrides
  services: BusinessService[]
}

/** Maximum intermediate hops an attacker may traverse laterally. */
export const MAX_LATERAL_HOPS = 4
/** Hard cap on enumerated paths (ranked worst-first). */
export const MAX_PATHS = 24

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 30,
  high: 22,
  medium: 14,
  low: 8,
}

export const TIER_WEIGHT: Record<ServiceTier, number> = {
  p1: 18,
  p2: 10,
  p3: 4,
  p4: 0,
}

export function bandFor(risk: number): RiskBand {
  if (risk >= 75) return 'critical'
  if (risk >= 55) return 'high'
  if (risk >= 35) return 'medium'
  return 'low'
}

/** Devices and sites a business service depends on. */
export function serviceMembers(
  service: BusinessService,
  devices: Device[],
): Device[] {
  const ids = new Set(service.deviceIds)
  return devices.filter(
    (device) => ids.has(device.id) || service.siteNames.includes(device.site),
  )
}

/** Exposure inventory: edge mgmt ports, critical CVEs and expired certificates. */
export function buildExposures(
  devices: Device[],
  vulns: ReturnType<typeof scanFleet>,
  certs: ReturnType<typeof seedCertificates>,
): Exposure[] {
  const exposures: Exposure[] = []
  const byId = new Map(devices.map((device) => [device.id, device]))

  for (const device of devices) {
    if (device.type !== 'router' && device.type !== 'firewall') continue
    const h = hashSeed(`attackpath:${device.id}`)
    if (h % 10 >= 4) continue
    const plaintext = h % 2 === 0
    exposures.push({
      id: `${device.id}:open-port:${plaintext ? 'http' : 'ssh'}`,
      deviceId: device.id,
      deviceName: device.name,
      kind: 'open-port',
      detail: plaintext
        ? 'HTTP management interface reachable from untrusted networks'
        : 'SSH management exposed beyond the admin network',
      severity: plaintext ? 'high' : 'medium',
    })
  }

  for (const vuln of vulns) {
    if (vuln.status !== 'open' || vuln.cvss < 9) continue
    exposures.push({
      id: `${vuln.deviceId}:critical-vuln:${vuln.cveId}`,
      deviceId: vuln.deviceId,
      deviceName: vuln.deviceName,
      kind: 'critical-vuln',
      detail: `${vuln.cveId} (CVSS ${vuln.cvss}) — ${vuln.title}`,
      severity: 'critical',
    })
  }

  for (const finding of certFindings(certs)) {
    if (finding.kind !== 'expired') continue
    if (!byId.has(finding.deviceId)) continue
    exposures.push({
      id: `${finding.deviceId}:expired-cert:${finding.certId}`,
      deviceId: finding.deviceId,
      deviceName: finding.deviceName,
      kind: 'expired-cert',
      detail: `Expired certificate ${finding.certId} still trusted by clients`,
      severity: 'high',
    })
  }

  return exposures
}

function adjacency(devices: Device[]): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const device of devices) graph.set(device.id, [])
  for (const link of deriveLinks(devices)) {
    graph.get(link.source)?.push(link.target)
    graph.get(link.target)?.push(link.source)
  }
  return graph
}

/** Shortest path (node list incl. endpoints) within the hop budget, else null. */
export function shortestPath(
  graph: Map<string, string[]>,
  from: string,
  to: string,
  maxHops: number,
): string[] | null {
  if (from === to) return [from]
  const queue: Array<{ node: string; path: string[] }> = [
    { node: from, path: [from] },
  ]
  const seen = new Set([from])
  while (queue.length > 0) {
    const current = queue.shift()!
    if (current.path.length - 1 >= maxHops) continue
    for (const next of graph.get(current.node) ?? []) {
      if (seen.has(next)) continue
      const path = [...current.path, next]
      if (next === to) return path
      seen.add(next)
      queue.push({ node: next, path })
    }
  }
  return null
}

function worstExposure(
  exposures: Exposure[],
  deviceId: string,
): Exposure | undefined {
  return exposures
    .filter((exposure) => exposure.deviceId === deviceId)
    .sort(
      (a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity],
    )[0]
}

function stepFor(
  kind: AttackStepKind,
  device: Device | undefined,
  deviceId: string,
  detail: string,
  severity: Severity,
): AttackStep {
  return {
    kind,
    deviceId,
    deviceName: device ? device.name : deviceId,
    detail,
    severity,
  }
}

function mitigationsFor(
  pathDevices: string[],
  exposures: Exposure[],
  entryId: string,
  goalId: string,
): string[] {
  const mitigations: string[] = []
  for (const deviceId of pathDevices) {
    const exposure = worstExposure(exposures, deviceId)
    if (!exposure) continue
    if (exposure.kind === 'critical-vuln') {
      mitigations.push(
        `Patch ${exposure.detail.split(' ')[0]} on ${exposure.deviceName}`,
      )
    } else if (exposure.kind === 'expired-cert') {
      mitigations.push(
        `Rotate the expired certificate on ${exposure.deviceName}`,
      )
    } else {
      mitigations.push(
        `Restrict the management port on ${exposure.deviceName} with an ACL`,
      )
    }
  }
  mitigations.push(
    `Segment ${entryId === goalId ? 'the compromised host' : 'between entry and target'} to break lateral paths`,
  )
  return [...new Set(mitigations)]
}

/** Enumerate and rank attack paths from exposed entries to critical services. */
export function findAttackPaths(
  devices: Device[],
  exposures: Exposure[],
  services: BusinessService[],
): AttackPath[] {
  const graph = adjacency(devices)
  const byId = new Map(devices.map((device) => [device.id, device]))
  const exposedDevices = new Set(exposures.map((exposure) => exposure.deviceId))
  const targets = services.filter(
    (service) => service.tier === 'p1' || service.tier === 'p2',
  )

  const paths: AttackPath[] = []
  const seen = new Set<string>()

  for (const entry of devices) {
    if (!exposedDevices.has(entry.id)) continue
    const entryExposure = worstExposure(exposures, entry.id)!
    for (const service of targets) {
      const members = serviceMembers(service, devices)
      for (const goal of members.slice(0, 2)) {
        const key = `${entry.id}|${service.id}|${goal.id}`
        if (seen.has(key)) continue
        const nodePath = shortestPath(
          graph,
          entry.id,
          goal.id,
          MAX_LATERAL_HOPS + 1,
        )
        if (!nodePath) continue
        seen.add(key)

        const lateralHops = nodePath.length - 2
        const steps: AttackStep[] = [
          stepFor(
            'entry',
            entry,
            entry.id,
            entryExposure.detail,
            entryExposure.severity,
          ),
        ]
        for (const deviceId of nodePath.slice(1, -1)) {
          const exposure = worstExposure(exposures, deviceId)
          steps.push(
            stepFor(
              'lateral',
              byId.get(deviceId),
              deviceId,
              exposure
                ? `${exposure.detail} on the way to the target`
                : 'Lateral movement across a trusted segment',
              exposure ? exposure.severity : 'medium',
            ),
          )
        }
        steps.push(
          stepFor(
            'target',
            byId.get(goal.id),
            goal.id,
            `Compromise ${service.name} (${service.tier.toUpperCase()})`,
            'critical',
          ),
        )

        const rawRisk =
          steps.reduce((sum, step) => sum + SEVERITY_WEIGHT[step.severity], 0) +
          TIER_WEIGHT[service.tier] -
          lateralHops * 3
        const risk = Math.min(100, Math.max(0, rawRisk))
        const pathDevices = nodePath
        paths.push({
          id: `${entry.id}>${service.id}:${goal.id}`,
          entryId: entry.id,
          targetServiceId: service.id,
          targetService: service.name,
          tier: service.tier,
          steps,
          lateralHops,
          risk,
          band: bandFor(risk),
          mitigations: mitigationsFor(
            pathDevices,
            exposures,
            entry.id,
            goal.id,
          ),
        })
      }
    }
  }

  return paths
    .sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id))
    .slice(0, MAX_PATHS)
}

/** Intermediate devices that appear on multiple ranked paths. */
export function chokePoints(
  paths: AttackPath[],
  devices: Device[],
): ChokePoint[] {
  const byId = new Map(devices.map((device) => [device.id, device.name]))
  const counts = new Map<string, number>()
  for (const path of paths) {
    const seen = new Set<string>()
    for (const step of path.steps) {
      if (step.kind !== 'lateral') continue
      if (seen.has(step.deviceId)) continue
      seen.add(step.deviceId)
      counts.set(step.deviceId, (counts.get(step.deviceId) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([deviceId, pathCount]) => ({
      deviceId,
      deviceName: byId.get(deviceId) ?? deviceId,
      pathCount,
      sharePct:
        paths.length === 0
          ? 0
          : Math.round((pathCount / paths.length) * 1000) / 10,
    }))
    .sort(
      (a, b) =>
        b.pathCount - a.pathCount || a.deviceId.localeCompare(b.deviceId),
    )
}

export function attackSummary(
  paths: AttackPath[],
  exposureCount: number,
): AttackSummary {
  if (paths.length === 0) {
    return {
      paths: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      exposures: exposureCount,
      topRisk: 0,
      avgRisk: 0,
    }
  }
  let critical = 0
  let high = 0
  let medium = 0
  let low = 0
  let riskSum = 0
  for (const path of paths) {
    if (path.band === 'critical') critical += 1
    else if (path.band === 'high') high += 1
    else if (path.band === 'medium') medium += 1
    else low += 1
    riskSum += path.risk
  }
  return {
    paths: paths.length,
    critical,
    high,
    medium,
    low,
    exposures: exposureCount,
    topRisk: paths[0]?.risk ?? 0,
    avgRisk: Math.round((riskSum / paths.length) * 10) / 10,
  }
}

/** Full attack-path view wired to the live vuln, cert and service stores. */
export function runAttackPaths(input: AttackInput): AttackResult {
  const { devices, seed, statuses, certOverrides, services } = input
  const vulns = scanFleet(devices, seed, statuses)
  const certs = withOverrides(seedCertificates(devices, seed), certOverrides)
  const exposures = buildExposures(devices, vulns, certs)
  const paths = findAttackPaths(devices, exposures, services)
  return {
    paths,
    exposures,
    chokePoints: chokePoints(paths, devices),
    summary: attackSummary(paths, exposures.length),
  }
}
