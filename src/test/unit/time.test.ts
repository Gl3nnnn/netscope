import { describe, expect, it } from 'vitest'
import { elapsedMs, formatAge } from '@/lib/time'

describe('elapsedMs', () => {
  it('clamps negative durations to zero', () => {
    expect(elapsedMs(1000, 500)).toBe(0)
    expect(elapsedMs(1000, 1500)).toBe(500)
  })
})

describe('formatAge', () => {
  it('formats seconds, minutes, hours and days', () => {
    expect(formatAge(0)).toBe('0s')
    expect(formatAge(45_000)).toBe('45s')
    expect(formatAge(12 * 60_000)).toBe('12m')
    expect(formatAge(4 * 3_600_000)).toBe('4h')
    expect(formatAge(3 * 86_400_000)).toBe('3d')
  })
})
