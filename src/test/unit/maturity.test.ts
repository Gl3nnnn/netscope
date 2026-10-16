import { describe, expect, it } from 'vitest'
import {
  DOMAINS,
  LEVEL_LABELS,
  computeMaturity,
  maturityLevel,
  type DomainId,
} from '@/lib/maturity'

const ALL_100: Record<DomainId, number> = {
  health: 100,
  routing: 100,
  wan: 100,
  resilience: 100,
  security: 100,
  qos: 100,
  environment: 100,
  compliance: 100,
}

describe('DOMAINS', () => {
  it('weights sum to 100 and ids are unique', () => {
    const total = DOMAINS.reduce((sum, domain) => sum + domain.weight, 0)
    expect(total).toBe(100)
    const ids = new Set(DOMAINS.map((domain) => domain.id))
    expect(ids.size).toBe(DOMAINS.length)
    for (const domain of DOMAINS) {
      expect(domain.label.length).toBeGreaterThan(0)
      expect(domain.description.length).toBeGreaterThan(0)
    }
  })
})

describe('maturityLevel', () => {
  it('maps scores to CMM levels at the thresholds', () => {
    expect(maturityLevel(100)).toBe(5)
    expect(maturityLevel(90)).toBe(5)
    expect(maturityLevel(89.9)).toBe(4)
    expect(maturityLevel(75)).toBe(4)
    expect(maturityLevel(74.9)).toBe(3)
    expect(maturityLevel(60)).toBe(3)
    expect(maturityLevel(59.9)).toBe(2)
    expect(maturityLevel(40)).toBe(2)
    expect(maturityLevel(39.9)).toBe(1)
    expect(maturityLevel(0)).toBe(1)
  })

  it('labels every level', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      expect(LEVEL_LABELS[level].length).toBeGreaterThan(0)
    }
  })
})

describe('computeMaturity', () => {
  it('scores a perfect fleet as level 5', () => {
    const result = computeMaturity(ALL_100)
    expect(result.index).toBe(100)
    expect(result.level).toBe(5)
    expect(result.levelLabel).toBe('Optimizing')
    expect(result.gaps).toHaveLength(3)
    expect(result.roadmap).toEqual([])
  })

  it('computes the weighted index from domain weights', () => {
    const scores = { ...ALL_100, security: 0 }
    const result = computeMaturity(scores)
    // security weight 15 → index = 100 − 15 = 85
    expect(result.index).toBe(85)
    expect(result.level).toBe(4)
  })

  it('flags the weakest domains as gaps, lowest first', () => {
    const scores: Record<DomainId, number> = {
      ...ALL_100,
      qos: 55,
      environment: 30,
      health: 70,
    }
    const result = computeMaturity(scores)
    expect(result.gaps.map((gap) => gap.id)).toEqual([
      'environment',
      'qos',
      'health',
    ])
    for (const gap of result.gaps) {
      expect(gap.level).toBe(maturityLevel(gap.score))
    }
  })

  it('produces a priority-sorted roadmap for the gaps', () => {
    const scores: Record<DomainId, number> = {
      ...ALL_100,
      qos: 40,
      resilience: 50,
      compliance: 60,
    }
    const result = computeMaturity(scores)
    expect(result.roadmap).toHaveLength(3)
    for (let i = 1; i < result.roadmap.length; i += 1) {
      expect(result.roadmap[i]!.priority).toBeLessThanOrEqual(
        result.roadmap[i - 1]!.priority,
      )
    }
    for (const item of result.roadmap) {
      expect(item.impact).toBeGreaterThan(0)
      expect(item.action.length).toBeGreaterThan(10)
      expect(['low', 'medium', 'high']).toContain(item.effort)
    }
  })

  it('clamps out-of-range and missing scores', () => {
    const result = computeMaturity({
      ...ALL_100,
      health: 150,
      routing: -20,
      wan: Number.NaN,
    } as Record<DomainId, number>)
    const byId = Object.fromEntries(
      result.domains.map((domain) => [domain.id, domain.score]),
    )
    expect(byId.health).toBe(100)
    expect(byId.routing).toBe(0)
    expect(byId.wan).toBe(0)
  })

  it('is deterministic', () => {
    const scores: Record<DomainId, number> = {
      health: 71,
      routing: 66,
      wan: 58,
      resilience: 62,
      security: 45,
      qos: 80,
      environment: 74,
      compliance: 51,
    }
    expect(computeMaturity(scores)).toEqual(computeMaturity(scores))
    const result = computeMaturity(scores)
    expect(result.index).toBeGreaterThan(0)
    expect(result.index).toBeLessThan(100)
  })
})
