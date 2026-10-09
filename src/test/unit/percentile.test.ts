import { describe, expect, it } from 'vitest'
import { percentile } from '@/lib/percentile'

describe('percentile', () => {
  it('returns undefined for an empty list', () => {
    expect(percentile([], 95)).toBeUndefined()
  })

  it('computes the nearest-rank percentile', () => {
    expect(percentile([1, 2, 3, 4], 95)).toBe(4)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([5], 75)).toBe(5)
    expect(percentile([10, 20, 30], 100)).toBe(30)
    expect(percentile([40, 10, 30, 20], 25)).toBe(10)
  })
})
