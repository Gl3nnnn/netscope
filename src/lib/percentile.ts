/** Nearest-rank percentile, a pure helper for latency/throughput percentiles. */
export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(
    sorted.length,
    Math.max(1, Math.ceil((p / 100) * sorted.length)),
  )
  return sorted[rank - 1]
}
