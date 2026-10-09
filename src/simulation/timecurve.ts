/**
 * Daily / weekly traffic model.
 *
 * The DEMO network is busier mid-afternoon, quiet overnight and roughly half
 * as busy on weekends. Everything is computed in UTC so the function is pure
 * and unit tests stay timezone-independent.
 */

/**
 * Return the traffic load multiplier in [0, 1] for a given epoch timestamp.
 * Relative to the type profile baseline: 1.0 at the weekday afternoon peak,
 * ~0.45 overnight, and the same curve halved on weekends.
 */
export function trafficMultiplier(now: number): number {
  const date = new Date(now)
  const hour =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6

  // Sine that is zero before 08:00 and after 20:00 and peaks at 14:00.
  const wave = Math.max(0, Math.sin(((hour - 8) / 12) * Math.PI))
  const multiplier = 0.45 + 0.55 * wave
  return weekend ? multiplier * 0.5 : multiplier
}
