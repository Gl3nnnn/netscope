/** Time helpers for incident age / duration display. Pure and testable. */

/** How long `from` has been in effect relative to `now`, clamped to >= 0. */
export function elapsedMs(from: number, now: number): number {
  return Math.max(0, now - from)
}

/** Compact human duration: "45s", "12m", "4h", "3d". */
export function formatAge(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  return `${days}d`
}
