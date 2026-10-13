/**
 * On-call rotation scheduling.
 *
 * A team owns a set of members; a rotation maps that team onto a timeline using
 * an anchor start and a fixed interval (weekly by default), cycling through the
 * members in order. Everything here is pure and deterministic given `now`, so it
 * can be unit tested and rendered reproducibly.
 */

export interface OnCallMember {
  id: string
  name: string
  email?: string
}

export interface Team {
  id: string
  name: string
  members: OnCallMember[]
}

export interface Rotation {
  id: string
  teamId: string
  name: string
  /** Anchor epoch ms of the first slot's start. */
  startsAt: number
  /** Slot length in ms. */
  intervalMs: number
  /** Member ids in rotation order. */
  members: string[]
}

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const WEEK_MS = 7 * DAY_MS

export const INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: DAY_MS, label: 'Daily' },
  { value: 2 * DAY_MS, label: 'Every 2 days' },
  { value: WEEK_MS, label: 'Weekly' },
  { value: 2 * WEEK_MS, label: 'Bi-weekly' },
]

export function resolveMember(
  teams: Team[],
  memberId: string,
): OnCallMember | null {
  for (const team of teams) {
    const member = team.members.find((entry) => entry.id === memberId)
    if (member) return member
  }
  return null
}

/** Zero-based slot index for a rotation at time `t` (safe before `startsAt`). */
export function slotIndex(rotation: Rotation, t: number): number {
  const count = rotation.members.length
  if (count === 0 || rotation.intervalMs <= 0) return -1
  const elapsed = Math.floor((t - rotation.startsAt) / rotation.intervalMs)
  return ((elapsed % count) + count) % count
}

/** Start epoch of the slot containing `t`. */
export function slotStart(rotation: Rotation, t: number): number {
  if (rotation.intervalMs <= 0) return rotation.startsAt
  const elapsed = Math.floor((t - rotation.startsAt) / rotation.intervalMs)
  return rotation.startsAt + elapsed * rotation.intervalMs
}

/** Member id on call at `t`, cycling through the list (null when empty). */
export function memberIdAt(rotation: Rotation, t: number): string | null {
  const index = slotIndex(rotation, t)
  return index < 0 ? null : rotation.members[index]
}

/** The on-call member for a rotation at `t`. */
export function onCallAt(
  rotation: Rotation,
  teams: Team[],
  t: number,
): OnCallMember | null {
  const id = memberIdAt(rotation, t)
  return id ? resolveMember(teams, id) : null
}

export interface OnCallSlot {
  start: number
  end: number
  memberId: string | null
}

/** The slot containing `t` followed by the next `count - 1` slots. */
export function handoffSchedule(
  rotation: Rotation,
  t: number,
  count: number,
): OnCallSlot[] {
  const slots: OnCallSlot[] = []
  if (rotation.members.length === 0 || rotation.intervalMs <= 0) return slots
  const start = slotStart(rotation, t)
  for (let i = 0; i < count; i += 1) {
    const slotStartAt = start + i * rotation.intervalMs
    slots.push({
      start: slotStartAt,
      end: slotStartAt + rotation.intervalMs,
      memberId: memberIdAt(rotation, slotStartAt),
    })
  }
  return slots
}

export interface UpcomingHandoff {
  at: number
  memberId: string
}

/** The next handoff after `t`. */
export function nextHandoff(
  rotation: Rotation,
  t: number,
): UpcomingHandoff | null {
  if (rotation.members.length === 0 || rotation.intervalMs <= 0) return null
  const at = slotStart(rotation, t) + rotation.intervalMs
  return { at, memberId: memberIdAt(rotation, at) ?? rotation.members[0] }
}

export interface CurrentOnCall {
  rotation: Rotation
  team: Team
  member: OnCallMember | null
  next: UpcomingHandoff | null
}

/** Everyone currently on call across all rotations that resolve to a team. */
export function currentOnCall(
  teams: Team[],
  rotations: Rotation[],
  t: number,
): CurrentOnCall[] {
  const teamById = new Map(teams.map((team) => [team.id, team]))
  const out: CurrentOnCall[] = []
  for (const rotation of rotations) {
    const team = teamById.get(rotation.teamId)
    if (!team) continue
    out.push({
      rotation,
      team,
      member: onCallAt(rotation, teams, t),
      next: nextHandoff(rotation, t),
    })
  }
  return out
}

/**
 * The next `count` members to page for a rotation, starting with whoever is
 * currently on call and walking the rotation order (wrapping around).
 */
export function escalationChain(
  rotation: Rotation,
  teams: Team[],
  t: number,
  count: number,
): OnCallMember[] {
  const chain: OnCallMember[] = []
  const size = rotation.members.length
  if (size === 0) return chain
  const start = slotIndex(rotation, t)
  for (let i = 0; i < Math.min(count, size); i += 1) {
    const member = resolveMember(teams, rotation.members[(start + i) % size])
    if (member) chain.push(member)
  }
  return chain
}

export function describeRotation(rotation: Rotation): string {
  const label =
    INTERVAL_OPTIONS.find((option) => option.value === rotation.intervalMs)
      ?.label ?? `Every ${Math.round(rotation.intervalMs / HOUR_MS)}h`
  return `${label} · ${rotation.members.length} member${
    rotation.members.length === 1 ? '' : 's'
  }`
}
