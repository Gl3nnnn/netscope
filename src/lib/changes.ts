import type { Device } from '@/types'
import type { DriftSummary } from './configs'
import {
  resolveServiceDevices,
  SERVICE_TIER_WEIGHT,
  type BusinessService,
} from './services'

/**
 * Change management / CAB workflow.
 *
 * Models the full lifecycle of a change request — draft → review → approved →
 * scheduled → implementing → verifying → closed — with rejected, cancelled and
 * rolled-back branches. Includes deterministic risk scoring, change-window
 * tracking, conflict detection between overlapping changes, an approval queue
 * and drift-based post-implementation verification. Pure and unit-testable.
 */

export type ChangeType = 'standard' | 'normal' | 'emergency'
export type ChangeRisk = 'low' | 'medium' | 'high'

export type ChangeStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'implementing'
  | 'verifying'
  | 'closed'
  | 'rejected'
  | 'cancelled'
  | 'rolled-back'

export interface ChangeRequest {
  id: string
  title: string
  description: string
  type: ChangeType
  status: ChangeStatus
  /** Device ids in scope. */
  deviceIds: string[]
  /** Sites in scope (used for conflict detection). */
  siteNames: string[]
  plannedStart: number
  plannedEnd: number
  requestedBy: string
  approver?: string
  createdAt: number
  updatedAt: number
  /** Free-form implementation / rollback notes. */
  note?: string
}

export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  standard: 'Standard',
  normal: 'Normal',
  emergency: 'Emergency',
}

export const CHANGE_RISK_LABELS: Record<ChangeRisk, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  draft: 'Draft',
  review: 'In review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  implementing: 'Implementing',
  verifying: 'Verifying',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  'rolled-back': 'Rolled back',
}

/** Allowed forward/backward transitions for the workflow. */
export const CHANGE_TRANSITIONS: Record<ChangeStatus, ChangeStatus[]> = {
  draft: ['review', 'cancelled'],
  review: ['approved', 'rejected', 'draft'],
  approved: ['scheduled', 'cancelled'],
  scheduled: ['implementing', 'cancelled'],
  implementing: ['verifying', 'rolled-back'],
  verifying: ['closed', 'rolled-back'],
  closed: [],
  rejected: [],
  cancelled: [],
  'rolled-back': [],
}

export const TERMINAL_CHANGE_STATUSES: ChangeStatus[] = [
  'closed',
  'rejected',
  'cancelled',
  'rolled-back',
]

export function isTerminalChange(status: ChangeStatus): boolean {
  return TERMINAL_CHANGE_STATUSES.includes(status)
}

export function nextChangeStatuses(status: ChangeStatus): ChangeStatus[] {
  return CHANGE_TRANSITIONS[status]
}

export function canTransition(from: ChangeStatus, to: ChangeStatus): boolean {
  return CHANGE_TRANSITIONS[from].includes(to)
}

export interface ChangeTransitionResult {
  ok: boolean
  change: ChangeRequest
  reason?: string
}

/** Apply a workflow transition, stamping `updatedAt` and the approver. */
export function transitionChange(
  change: ChangeRequest,
  to: ChangeStatus,
  options: { now: number; actor?: string },
): ChangeTransitionResult {
  if (!canTransition(change.status, to)) {
    return {
      ok: false,
      change,
      reason: `Cannot move from ${CHANGE_STATUS_LABELS[change.status]} to ${CHANGE_STATUS_LABELS[to]}.`,
    }
  }
  const next: ChangeRequest = {
    ...change,
    status: to,
    updatedAt: options.now,
  }
  if (to === 'approved' && options.actor) next.approver = options.actor
  return { ok: true, change: next }
}

// --- Risk scoring -----------------------------------------------------------

export interface RiskAssessment {
  score: number
  level: ChangeRisk
  reasons: string[]
}

/** Deterministic risk score from scope, change type and impacted services. */
export function assessRisk(input: {
  change: ChangeRequest
  devices: Device[]
  services: BusinessService[]
}): RiskAssessment {
  const { change, devices, services } = input
  const reasons: string[] = []
  let score = 0

  const scope = change.deviceIds.length
  if (scope >= 5) {
    score += 3
    reasons.push(`${scope} devices in scope`)
  } else if (scope >= 2) {
    score += 2
    reasons.push(`${scope} devices in scope`)
  } else if (scope === 1) {
    score += 1
    reasons.push('1 device in scope')
  }

  if (change.type === 'emergency') {
    score += 2
    reasons.push('Emergency change')
  } else if (change.type === 'normal') {
    score += 1
    reasons.push('Normal change')
  }

  const scopeIds = new Set(change.deviceIds)
  const impacted = services.filter((service) =>
    resolveServiceDevices(service, devices).some((device) =>
      scopeIds.has(device.id),
    ),
  )
  let servicePoints = 0
  for (const service of impacted) {
    servicePoints = Math.max(servicePoints, SERVICE_TIER_WEIGHT[service.tier])
  }
  if (impacted.length > 0) {
    score += servicePoints
    reasons.push(
      `${impacted.length} business service(s) impacted (max tier weight ${servicePoints})`,
    )
  }

  const level: ChangeRisk = score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low'
  return { score, level, reasons }
}

// --- Windows & conflicts ----------------------------------------------------

export type ChangeWindowState = 'upcoming' | 'active' | 'elapsed'

export const CHANGE_WINDOW_LABELS: Record<ChangeWindowState, string> = {
  upcoming: 'Upcoming',
  active: 'Active now',
  elapsed: 'Window elapsed',
}

export function changeWindowState(
  change: ChangeRequest,
  now: number,
): ChangeWindowState {
  if (now < change.plannedStart) return 'upcoming'
  if (now <= change.plannedEnd) return 'active'
  return 'elapsed'
}

/** A non-terminal change whose planned window has already passed. */
export function isChangeOverdue(change: ChangeRequest, now: number): boolean {
  return (
    !isTerminalChange(change.status) &&
    changeWindowState(change, now) === 'elapsed'
  )
}

export function changeWindowsOverlap(
  a: ChangeRequest,
  b: ChangeRequest,
): boolean {
  return a.plannedStart < b.plannedEnd && b.plannedStart < a.plannedEnd
}

const ACTIVE_STATUSES: ChangeStatus[] = [
  'draft',
  'review',
  'approved',
  'scheduled',
  'implementing',
  'verifying',
]

export interface ChangeConflict {
  aId: string
  bId: string
  reason: string
}

function overlap(a: string[], b: string[]): string[] {
  const setB = new Set(b)
  return a.filter((item) => setB.has(item))
}

/** Overlapping windows on devices or sites between non-terminal changes. */
export function findChangeConflicts(
  changes: ChangeRequest[],
): ChangeConflict[] {
  const open = changes.filter((change) =>
    ACTIVE_STATUSES.includes(change.status),
  )
  const conflicts: ChangeConflict[] = []
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      const a = open[i]
      const b = open[j]
      if (!changeWindowsOverlap(a, b)) continue
      const devices = overlap(a.deviceIds, b.deviceIds)
      const sites = overlap(a.siteNames, b.siteNames)
      if (devices.length > 0) {
        conflicts.push({
          aId: a.id,
          bId: b.id,
          reason: `${devices.length} shared device(s) with overlapping window`,
        })
      } else if (sites.length > 0) {
        conflicts.push({
          aId: a.id,
          bId: b.id,
          reason: `shared site ${sites[0]} with overlapping window`,
        })
      }
    }
  }
  return conflicts
}

/** Changes awaiting CAB approval, highest risk first. */
export function pendingApprovals(
  changes: ChangeRequest[],
  devices: Device[],
  services: BusinessService[],
): { change: ChangeRequest; assessment: RiskAssessment }[] {
  return changes
    .filter((change) => change.status === 'review')
    .map((change) => ({
      change,
      assessment: assessRisk({ change, devices, services }),
    }))
    .sort(
      (a, b) =>
        b.assessment.score - a.assessment.score ||
        a.change.plannedStart - b.change.plannedStart,
    )
}

// --- Verification -----------------------------------------------------------

export interface ChangeVerification {
  changeId: string
  total: number
  drifted: number
  verified: boolean
}

/**
 * Post-implementation verification: a change is verified when none of its
 * in-scope devices show configuration drift afterwards.
 */
export function verifyChange(
  change: ChangeRequest,
  drifts: DriftSummary[],
): ChangeVerification {
  const scope = new Set(change.deviceIds)
  const inScope = drifts.filter((drift) => scope.has(drift.deviceId))
  const drifted = inScope.filter((drift) => drift.drifted).length
  return {
    changeId: change.id,
    total: change.deviceIds.length,
    drifted,
    verified: drifted === 0,
  }
}

export interface ChangeSummary {
  total: number
  byStatus: Record<ChangeStatus, number>
  pendingApproval: number
  active: number
  upcoming: number
  overdue: number
  conflicts: number
}

export function changeSummary(
  changes: ChangeRequest[],
  now: number,
): ChangeSummary {
  const byStatus = {} as Record<ChangeStatus, number>
  for (const status of Object.keys(CHANGE_STATUS_LABELS) as ChangeStatus[]) {
    byStatus[status] = 0
  }
  for (const change of changes) byStatus[change.status] += 1

  return {
    total: changes.length,
    byStatus,
    pendingApproval: byStatus.review,
    active: changes.filter(
      (change) => changeWindowState(change, now) === 'active',
    ).length,
    upcoming: changes.filter(
      (change) => changeWindowState(change, now) === 'upcoming',
    ).length,
    overdue: changes.filter((change) => isChangeOverdue(change, now)).length,
    conflicts: findChangeConflicts(changes).length,
  }
}

export function describeChange(change: ChangeRequest): string {
  return `${CHANGE_TYPE_LABELS[change.type]} · ${change.deviceIds.length} device(s)${
    change.siteNames.length > 0 ? ` · ${change.siteNames.join(', ')}` : ''
  }`
}
