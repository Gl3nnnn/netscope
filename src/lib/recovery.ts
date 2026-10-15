import type { Device, Severity } from '@/types'
import { hashSeed, mulberry32 } from '@/simulation/random'
import type { BusinessService, ServiceTier } from '@/lib/services'

/**
 * DR & Backup engine.
 *
 * Every relevant device gets a backup job (kind derived from its type, target
 * RPO from the job kind, tier pulled from its business services). Each tick
 * simulates the last run deterministically from (jobId, tick) — some jobs go
 * failed, stale or over their RPO. Restore tests give every job an actual RTO
 * versus the tier's target. The store layers operator overrides and drill
 * history (each drill files a CAB change and a timeline event) on top.
 */

export type BackupKind = 'database' | 'config' | 'image' | 'app'
export type BackupStatus = 'ok' | 'warning' | 'failed' | 'stale'
export type RestoreResult = 'pass' | 'fail' | 'pending'

export const BACKUP_KIND_LABELS: Record<BackupKind, string> = {
  database: 'Database',
  config: 'Config',
  image: 'Image',
  app: 'App',
}

export const BACKUP_STATUS_LABELS: Record<BackupStatus, string> = {
  ok: 'OK',
  warning: 'At risk',
  failed: 'Failed',
  stale: 'Stale',
}

/** Target RPO (hours) per backup kind — how fresh a restore may be. */
export const RPO_TARGET_HRS: Record<BackupKind, number> = {
  database: 1,
  app: 4,
  image: 8,
  config: 24,
}

/** Target RTO (hours) per service tier — how fast a restore must complete. */
export const RTO_TARGET_HRS: Record<ServiceTier, number> = {
  p1: 1,
  p2: 4,
  p3: 12,
  p4: 48,
}

export const STORAGE_COST_PER_GB_USD = 0.023

export interface BackupJob {
  id: string
  deviceId: string
  deviceName: string
  site: string
  kind: BackupKind
  tier: ServiceTier
  /** Target RPO (hours) for this kind. */
  targetRpoHrs: number
  /** Hours since the last successful run (simulated this tick). */
  lastRunHoursAgo: number
  /** Data age a restore would land on — must stay ≤ targetRpoHrs. */
  actualRpoHrs: number
  status: BackupStatus
  sizeGb: number
  retentionDays: number
  storageMonthlyUsd: number
  /** Rolling success rate over the last 30 runs (%). */
  successRatePct: number
}

export interface RestoreTest {
  id: string
  jobId: string
  jobName: string
  deviceId: string
  deviceName: string
  tier: ServiceTier
  targetRtoHrs: number
  /** Measured restore duration this tick (hours). */
  actualRtoHrs: number
  result: RestoreResult
  testedHoursAgo: number
}

export interface DrillRecord {
  id: string
  ranHoursAgo: number
  jobsTested: number
  jobsPassed: number
  rtoBreaches: number
  note: string
}

export type RecoveryOverride = {
  status?: BackupStatus
  lastRunHoursAgo?: number
}

export type RecoveryOverrides = Record<string, RecoveryOverride>

export type RecoveryFindingKind =
  'failed-backup' | 'stale-backup' | 'rpo-miss' | 'rto-miss'

export interface RecoveryFinding {
  id: string
  jobId: string
  deviceName: string
  kind: RecoveryFindingKind
  severity: Severity
  message: string
}

export interface RecoverySummary {
  jobs: number
  ok: number
  warning: number
  failed: number
  stale: number
  restoreTests: number
  restorePassed: number
  rtoBreaches: number
  rpoMisses: number
  monthlyCostUsd: number
  avgSuccessPct: number
}

export interface RecoveryResult {
  jobs: BackupJob[]
  tests: RestoreTest[]
  findings: RecoveryFinding[]
  summary: RecoverySummary
}

/** Service tier a device belongs to — lowest (most critical) wins, else p4. */
export function tierForDevice(
  deviceId: string,
  services: BusinessService[],
): ServiceTier {
  let tier: ServiceTier = 'p4'
  for (const service of services) {
    if (!service.deviceIds.includes(deviceId)) continue
    if (service.tier < tier) tier = service.tier
  }
  return tier
}

function kindForDevice(device: Device): BackupKind {
  if (device.type === 'server') {
    const roll = mulberry32(hashSeed(`${device.id}:kind`)).next()
    if (roll < 0.6) return 'database'
    if (roll < 0.8) return 'app'
    return 'image'
  }
  return 'config'
}

/** One backup job per device (routers/firewalls/switches/APs back up config). */
export function seedJobs(
  devices: Device[],
  services: BusinessService[],
  seed: number,
): BackupJob[] {
  return devices.map((device) => {
    const kind = kindForDevice(device)
    const tier = tierForDevice(device.id, services)
    const rng = mulberry32(hashSeed(`${device.id}:backup:${seed}`))
    const sizeRoll = rng.next()
    const retentionRoll = rng.next()
    const sizeGb =
      device.type === 'server'
        ? 10 + Math.round(sizeRoll * 190)
        : kind === 'config'
          ? 1 + Math.round(sizeRoll * 3)
          : 5 + Math.round(sizeRoll * 20)
    const retentionDays =
      tier === 'p1'
        ? 35
        : tier === 'p2'
          ? 30
          : tier === 'p3'
            ? 14
            : 7 + Math.round(retentionRoll * 3)
    return {
      id: `bk-${device.id}-${kind}`,
      deviceId: device.id,
      deviceName: device.name,
      site: device.site,
      kind,
      tier,
      targetRpoHrs: RPO_TARGET_HRS[kind],
      lastRunHoursAgo: 0,
      actualRpoHrs: 0,
      status: 'ok' as BackupStatus,
      sizeGb,
      retentionDays,
      storageMonthlyUsd:
        Math.round(sizeGb * STORAGE_COST_PER_GB_USD * 100) / 100,
      successRatePct: 100,
    }
  })
}

/**
 * Simulate each job's latest run for this tick. Deterministic from
 * (jobId, tick); operator overrides land last. P1 jobs succeed more often.
 */
export function withJobResults(
  jobs: BackupJob[],
  seed: number,
  tick: number,
  overrides: RecoveryOverrides = {},
): BackupJob[] {
  return jobs.map((job) => {
    const rng = mulberry32(hashSeed(`${job.id}:${seed}:${tick}`))
    const statusRoll = rng.next()
    const ageRoll = rng.next()
    const successRoll = rng.next()
    // P1/P2 jobs skew healthier: shift the roll toward "ok".
    const bias = job.tier === 'p1' ? 0.12 : job.tier === 'p2' ? 0.06 : 0
    const roll = statusRoll - bias
    let status: BackupStatus = 'ok'
    if (roll >= 0.97) status = 'stale'
    else if (roll >= 0.9) status = 'failed'
    else if (roll >= 0.78) status = 'warning'

    const target = RPO_TARGET_HRS[job.kind]
    const lastRunHoursAgo =
      status === 'stale'
        ? 48 + Math.round(ageRoll * 48)
        : status === 'failed'
          ? 12 + Math.round(ageRoll * 24)
          : Math.max(0.2, Math.round(ageRoll * target * 10) / 10)
    const actualRpoHrs =
      status === 'ok'
        ? Math.min(target, lastRunHoursAgo)
        : status === 'warning'
          ? Math.round(target * (1 + ageRoll * 0.8) * 10) / 10
          : lastRunHoursAgo
    const successRatePct =
      status === 'ok'
        ? 96 + Math.round(successRoll * 4)
        : status === 'warning'
          ? 85 + Math.round(successRoll * 11)
          : 60 + Math.round(successRoll * 25)

    const override = overrides[job.id]
    return {
      ...job,
      status: override?.status ?? status,
      lastRunHoursAgo: override?.lastRunHoursAgo ?? lastRunHoursAgo,
      actualRpoHrs: override?.lastRunHoursAgo
        ? override.lastRunHoursAgo
        : actualRpoHrs,
      successRatePct,
    }
  })
}

/** A restore test per job: measured RTO versus the tier target. */
export function restoreTestsFor(
  jobs: BackupJob[],
  seed: number,
  tick: number,
): RestoreTest[] {
  return jobs.map((job) => {
    const rng = mulberry32(hashSeed(`${job.id}:restore:${seed}:${tick}`))
    const durationRoll = rng.next()
    const ageRoll = rng.next()
    const targetRtoHrs = RTO_TARGET_HRS[job.tier]
    const actualRtoHrs =
      Math.round(targetRtoHrs * (0.4 + durationRoll * 1.4) * 10) / 10
    const result: RestoreResult = actualRtoHrs <= targetRtoHrs ? 'pass' : 'fail'
    return {
      id: `rt-${job.id}`,
      jobId: job.id,
      jobName: `${BACKUP_KIND_LABELS[job.kind]} backup — ${job.deviceName}`,
      deviceId: job.deviceId,
      deviceName: job.deviceName,
      tier: job.tier,
      targetRtoHrs,
      actualRtoHrs,
      result,
      testedHoursAgo: Math.round(ageRoll * 72),
    }
  })
}

/** Run a DR drill across P1/P2 jobs (returns the record; the store files it). */
export function runDrill(
  jobs: BackupJob[],
  tests: RestoreTest[],
  tick: number,
): DrillRecord {
  const critical = jobs.filter((job) => job.tier === 'p1' || job.tier === 'p2')
  const testedIds = new Set(critical.map((job) => job.id))
  const scoped = tests.filter((test) => testedIds.has(test.jobId))
  const passed = scoped.filter((test) => test.result === 'pass').length
  const breaches = scoped.length - passed
  return {
    id: `drill-${tick}`,
    ranHoursAgo: 0,
    jobsTested: scoped.length,
    jobsPassed: passed,
    rtoBreaches: breaches,
    note:
      breaches > 0
        ? `${breaches} RTO breach(es) — tighten restore runbooks before the next window.`
        : 'All critical restores met their RTO targets.',
  }
}

export function recoveryFindings(
  jobs: BackupJob[],
  tests: RestoreTest[],
): RecoveryFinding[] {
  const findings: RecoveryFinding[] = []
  const testByJob = new Map(tests.map((test) => [test.jobId, test]))

  for (const job of jobs) {
    if (job.status === 'failed') {
      findings.push({
        id: `${job.id}:failed`,
        jobId: job.id,
        deviceName: job.deviceName,
        kind: 'failed-backup',
        severity: job.tier === 'p1' || job.tier === 'p2' ? 'critical' : 'high',
        message: `Backup failing on ${job.deviceName} — last run ${job.lastRunHoursAgo} h ago (${job.kind}).`,
      })
    }
    if (job.status === 'stale') {
      findings.push({
        id: `${job.id}:stale`,
        jobId: job.id,
        deviceName: job.deviceName,
        kind: 'stale-backup',
        severity: job.tier === 'p1' ? 'high' : 'medium',
        message: `Backup stale on ${job.deviceName} — no successful run in ${job.lastRunHoursAgo} h.`,
      })
    }
    if (job.status !== 'ok' && job.actualRpoHrs > job.targetRpoHrs) {
      findings.push({
        id: `${job.id}:rpo`,
        jobId: job.id,
        deviceName: job.deviceName,
        kind: 'rpo-miss',
        severity: job.tier === 'p1' || job.tier === 'p2' ? 'high' : 'medium',
        message: `RPO miss on ${job.deviceName} — data age ${job.actualRpoHrs} h exceeds ${job.targetRpoHrs} h target.`,
      })
    }
    const test = testByJob.get(job.id)
    if (test && test.result === 'fail') {
      findings.push({
        id: `${job.id}:rto`,
        jobId: job.id,
        deviceName: job.deviceName,
        kind: 'rto-miss',
        severity: test.tier === 'p1' ? 'critical' : 'high',
        message: `Restore RTO miss on ${job.deviceName} — ${test.actualRtoHrs} h vs ${test.targetRtoHrs} h target.`,
      })
    }
  }
  return findings
}

export function recoverySummary(
  jobs: BackupJob[],
  tests: RestoreTest[],
): RecoverySummary {
  const count = (status: BackupStatus) =>
    jobs.filter((job) => job.status === status).length
  const passed = tests.filter((test) => test.result === 'pass').length
  const avgSuccessPct =
    jobs.length === 0
      ? 100
      : Math.round(
          (jobs.reduce((sum, job) => sum + job.successRatePct, 0) /
            jobs.length) *
            10,
        ) / 10
  return {
    jobs: jobs.length,
    ok: count('ok'),
    warning: count('warning'),
    failed: count('failed'),
    stale: count('stale'),
    restoreTests: tests.length,
    restorePassed: passed,
    rtoBreaches: tests.length - passed,
    rpoMisses: jobs.filter((job) => job.actualRpoHrs > job.targetRpoHrs).length,
    monthlyCostUsd:
      Math.round(
        jobs.reduce((sum, job) => sum + job.storageMonthlyUsd, 0) * 100,
      ) / 100,
    avgSuccessPct,
  }
}

/** Full view: jobs + restore tests + findings + summary for this tick. */
export function runRecovery(
  devices: Device[],
  services: BusinessService[],
  seed: number,
  tick: number,
  overrides: RecoveryOverrides = {},
): RecoveryResult {
  const jobs = withJobResults(
    seedJobs(devices, services, seed),
    seed,
    tick,
    overrides,
  )
  const tests = restoreTestsFor(jobs, seed, tick)
  return {
    jobs,
    tests,
    findings: recoveryFindings(jobs, tests),
    summary: recoverySummary(jobs, tests),
  }
}
