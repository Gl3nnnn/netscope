import { describe, expect, it } from 'vitest'
import { hashSeed, mulberry32, seedFromParam } from '../../simulation/random'

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

describe('seedFromParam', () => {
  it('returns null when the parameter is absent or empty', () => {
    expect(seedFromParam(null)).toBeNull()
    expect(seedFromParam(undefined)).toBeNull()
    expect(seedFromParam('')).toBeNull()
    expect(seedFromParam('   ')).toBeNull()
  })

  it('parses numeric seeds', () => {
    expect(seedFromParam('42')).toBe(42)
    expect(seedFromParam('0')).toBe(0)
  })

  it('normalises negative numbers into the unsigned range', () => {
    const value = seedFromParam('-7')
    expect(value).toBe(7)
  })

  it('hashes arbitrary strings deterministically', () => {
    expect(seedFromParam('demo')).toBe(seedFromParam('demo'))
    expect(seedFromParam('demo')).not.toBe(seedFromParam('demo2'))
  })
})

describe('hashSeed', () => {
  it('is stable across calls and returns an unsigned integer', () => {
    expect(hashSeed('hello')).toBe(hashSeed('hello'))
    expect(Number.isInteger(hashSeed('hello'))).toBe(true)
    expect(hashSeed('hello')).toBeGreaterThanOrEqual(0)
  })

  it('handles the empty string', () => {
    expect(hashSeed('')).toBe(0x811c9dc5)
  })
})
