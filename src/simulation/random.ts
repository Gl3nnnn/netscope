/**
 * Deterministic, seeded pseudo-random number generator (mulberry32).
 *
 * A seeded RNG keeps the DEMO telemetry reproducible: given the same seed and
 * the same number of ticks, the dashboard always produces the same values,
 * which makes the simulation unit-testable.
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number
  /** Float in [min, max). */
  range(min: number, max: number): number
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number
  /** Random element from a non-empty array. */
  pick<T>(items: readonly T[]): T
  /** True with probability `p` (0..1). */
  chance(p: number): boolean
  /** Approximately-normal noise centred on 0 with the given spread. */
  noise(spread: number): number
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0

  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => {
      if (items.length === 0) {
        throw new Error('rng.pick called with an empty array')
      }
      return items[Math.floor(next() * items.length)] as (typeof items)[number]
    },
    chance: (p) => next() < p,
    noise: (spread) => (next() + next() + next() - 1.5) * spread,
  }

  return rng
}

/**
 * Turn an arbitrary seed string into a 32-bit unsigned integer (FNV-1a), so
 * shareable `?seed=my-string` links still map to a deterministic RNG.
 */
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Resolve a raw `?seed=` query value into a numeric seed (or null if absent). */
export function seedFromParam(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return Math.abs(Math.floor(numeric)) >>> 0
  return hashSeed(trimmed)
}
