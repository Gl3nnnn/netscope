import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../simulation/random'

describe('mulberry32 PRNG', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(12345)
    const b = mulberry32(12345)
    const seqA = Array.from({ length: 10 }, () => a.next())
    const seqB = Array.from({ length: 10 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1).next()
    const b = mulberry32(2).next()
    expect(a).not.toBe(b)
  })

  it('keeps next() within [0, 1)', () => {
    const rng = mulberry32(999)
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('respects range and int bounds', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 200; i += 1) {
      const value = rng.range(5, 10)
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThan(10)
      const integer = rng.int(1, 6)
      expect(Number.isInteger(integer)).toBe(true)
      expect(integer).toBeGreaterThanOrEqual(1)
      expect(integer).toBeLessThanOrEqual(6)
    }
  })

  it('chance(0) is always false and chance(1) is always true', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 50; i += 1) {
      expect(rng.chance(0)).toBe(false)
      expect(rng.chance(1)).toBe(true)
    }
  })

  it('throws when picking from an empty array', () => {
    expect(() => mulberry32(1).pick([])).toThrow()
  })
})
