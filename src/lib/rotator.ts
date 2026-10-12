/**
 * Pure helpers for the NOC wallboard's panel rotation. Kept free of timers and
 * DOM so the indexing logic can be unit tested deterministically.
 */

/** Wrap an arbitrary index into `[0, count)`. Returns 0 when there are none. */
export function rotateIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return ((index % count) + count) % count
}

/** The next panel index, wrapping at the end. */
export function nextRotation(index: number, count: number): number {
  return rotateIndex(index + 1, count)
}

/** Progress through a rotation interval as a 0..1 fraction. */
export function rotationProgress(
  startedAt: number,
  now: number,
  intervalMs: number,
): number {
  if (intervalMs <= 0) return 1
  const elapsed = now - startedAt
  if (elapsed <= 0) return 0
  if (elapsed >= intervalMs) return 1
  return elapsed / intervalMs
}

/** Which panel should be visible for a cycle that began at `startedAt`. */
export function panelAt(
  startedAt: number,
  now: number,
  intervalMs: number,
  count: number,
): number {
  if (intervalMs <= 0 || count <= 0) return 0
  return rotateIndex(Math.floor((now - startedAt) / intervalMs), count)
}
