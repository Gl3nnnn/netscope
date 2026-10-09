/**
 * Lightweight anomaly detection over a rolling window.
 *
 * Uses Welford's online algorithm to compute the window's mean and variance in
 * a single pass (numerically stable), then scores the current value with a
 * two-sided z-score. Values more than `threshold` standard deviations from the
 * window mean are flagged as anomalies in either direction.
 */

export interface AnomalyOptions {
  /** Number of previous points to use as the baseline window. */
  windowSize?: number
  /** Z-score threshold above which a point is flagged (default 3). */
  threshold?: number
}

export interface AnomalyResult {
  mean: number
  stdDev: number
  zScore: number
  abnormal: boolean
}

export function detectAnomaly(
  window: number[],
  value: number,
  options: AnomalyOptions = {},
): AnomalyResult {
  const threshold = options.threshold ?? 3

  let mean = 0
  let m2 = 0
  let count = 0
  for (const point of window) {
    count += 1
    const delta = point - mean
    mean += delta / count
    m2 += delta * (point - mean)
  }

  const stdDev = count > 0 ? Math.sqrt(m2 / count) : 0

  // A perfectly flat window would give an infinite z-score to any deviation.
  // Give stdDev a small floor relative to the mean's scale so threshold still
  // controls sensitivity (e.g. a +2% step on an otherwise frozen metric).
  const scale = Math.max(0.02 * Math.abs(mean), 1e-6)
  const effectiveStd = Math.max(stdDev, scale)

  const zScore = (value - mean) / effectiveStd
  return {
    mean,
    stdDev,
    zScore,
    abnormal: Math.abs(zScore) > threshold,
  }
}

export interface FlaggedPoint {
  t: number
  value: number
  zScore: number
}

/**
 * Score every point of a series against the `windowSize` points before it and
 * return the flagged ones. Points without a full window of history are skipped.
 */
export function flagAnomalies(
  series: { t: number; value: number }[],
  options: AnomalyOptions = {},
): FlaggedPoint[] {
  const windowSize = Math.max(1, options.windowSize ?? 12)
  const flagged: FlaggedPoint[] = []
  for (let i = windowSize; i < series.length; i += 1) {
    const window = series.slice(i - windowSize, i).map((point) => point.value)
    const result = detectAnomaly(window, series[i].value, options)
    if (result.abnormal) {
      flagged.push({
        t: series[i].t,
        value: series[i].value,
        zScore: result.zScore,
      })
    }
  }
  return flagged
}
