import { describe, expect, it } from 'vitest'
import {
  nextRotation,
  panelAt,
  rotateIndex,
  rotationProgress,
} from '@/lib/rotator'

describe('rotateIndex', () => {
  it('wraps indices into range', () => {
    expect(rotateIndex(0, 4)).toBe(0)
    expect(rotateIndex(3, 4)).toBe(3)
    expect(rotateIndex(4, 4)).toBe(0)
    expect(rotateIndex(5, 4)).toBe(1)
  })

  it('handles negative indices', () => {
    expect(rotateIndex(-1, 4)).toBe(3)
    expect(rotateIndex(-5, 4)).toBe(3)
  })

  it('returns 0 when there are no panels', () => {
    expect(rotateIndex(7, 0)).toBe(0)
    expect(rotateIndex(0, -2)).toBe(0)
  })
})

describe('nextRotation', () => {
  it('advances and wraps', () => {
    expect(nextRotation(0, 3)).toBe(1)
    expect(nextRotation(2, 3)).toBe(0)
  })
})

describe('rotationProgress', () => {
  it('is a clamped 0..1 fraction', () => {
    expect(rotationProgress(1000, 1000, 10000)).toBe(0)
    expect(rotationProgress(1000, 6000, 10000)).toBeCloseTo(0.5)
    expect(rotationProgress(1000, 20000, 10000)).toBe(1)
    expect(rotationProgress(1000, 500, 10000)).toBe(0)
  })

  it('is complete for non-positive intervals', () => {
    expect(rotationProgress(0, 100, 0)).toBe(1)
    expect(rotationProgress(0, 100, -5)).toBe(1)
  })
})

describe('panelAt', () => {
  it('selects the panel for the elapsed time', () => {
    const start = 1000
    const interval = 10000
    expect(panelAt(start, 1000, interval, 3)).toBe(0)
    expect(panelAt(start, 10999, interval, 3)).toBe(0)
    expect(panelAt(start, 11000, interval, 3)).toBe(1)
    expect(panelAt(start, 31000, interval, 3)).toBe(0)
  })

  it('degrades safely for empty rotations', () => {
    expect(panelAt(0, 50000, 0, 4)).toBe(0)
    expect(panelAt(0, 50000, 10000, 0)).toBe(0)
  })
})
