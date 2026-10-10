/**
 * Pure helper that turns a list of values into SVG polyline coordinates for a
 * tiny, dependency-free sparkline. Values are mapped into a `width` x `height`
 * box with vertical padding, and the Y axis is inverted so larger values sit
 * higher. Returns `undefined` when there are fewer than two points to draw.
 */
export function sparklinePoints(
  values: number[],
  width = 100,
  height = 100,
  padding = 6,
): string | undefined {
  if (values.length < 2) return undefined
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const innerHeight = Math.max(1, height - padding * 2)
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const normalized = span === 0 ? 0.5 : (value - min) / span
      const y = padding + (1 - normalized) * innerHeight
      return `${Number(x.toFixed(2))},${Number(y.toFixed(2))}`
    })
    .join(' ')
}
