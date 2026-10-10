import { describe, expect, it } from 'vitest'
import { sparklinePoints } from '@/lib/sparkline'

describe('sparklinePoints', () => {
  it('returns undefined when there are fewer than two points', () => {
    expect(sparklinePoints([])).toBeUndefined()
    expect(sparklinePoints([42])).toBeUndefined()
  })

  it('maps endpoints across the full width with inverted Y', () => {
    expect(sparklinePoints([0, 10])).toBe('0,94 100,6')
  })

  it('centres a flat series', () => {
    expect(sparklinePoints([5, 5, 5])).toBe('0,50 50,50 100,50')
  })

  it('emits one coordinate pair per value', () => {
    const points = sparklinePoints([1, 3, 2, 4])
    expect(points?.split(' ')).toHaveLength(4)
  })
})
