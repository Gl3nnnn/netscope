import { describe, expect, it } from 'vitest'
import { SITES } from '@/simulation/seed'
import {
  APDEX_T,
  FAILURE_RATE,
  HISTORY_POINTS,
  JOURNEY_KINDS,
  JOURNEY_TEMPLATES,
  apdexFor,
  experienceSummary,
  journeyId,
  runFleetJourneys,
  runJourney,
  siteExperience,
  slugify,
  statusFor,
} from '@/lib/experience'

const SEED = 7
const TICK = 42

describe('apdexFor', () => {
  it('scores satisfied, tolerating and error boundaries', () => {
    expect(apdexFor(0)).toBe(1)
    expect(apdexFor(APDEX_T)).toBe(1)
    expect(apdexFor(APDEX_T + 1)).toBe(0.5)
    expect(apdexFor(4 * APDEX_T)).toBe(0.5)
    expect(apdexFor(4 * APDEX_T + 1)).toBe(0)
  })

  it('is non-increasing as latency grows', () => {
    let previous = 1
    for (let ms = 0; ms <= 1600; ms += 50) {
      const score = apdexFor(ms)
      expect(score).toBeLessThanOrEqual(previous)
      previous = score
    }
  })

  it('never leaves the 0–1 range', () => {
    for (const ms of [-100, 0, 1, 299, 301, 799, 1201, 99_999]) {
      expect(apdexFor(ms)).toBeGreaterThanOrEqual(0)
      expect(apdexFor(ms)).toBeLessThanOrEqual(1)
    }
  })
})

describe('statusFor', () => {
  it('maps failures, thresholds and timeouts to statuses', () => {
    expect(statusFor(100, true)).toBe('failing')
    expect(statusFor(APDEX_T, false)).toBe('healthy')
    expect(statusFor(APDEX_T + 1, false)).toBe('degraded')
    expect(statusFor(3 * APDEX_T, false)).toBe('degraded')
    expect(statusFor(3 * APDEX_T + 1, false)).toBe('failing')
  })

  it('agrees with apdexFor across a latency sweep', () => {
    for (let ms = 0; ms <= 1500; ms += 100) {
      const status = statusFor(ms, false)
      if (status === 'healthy') expect(apdexFor(ms)).toBe(1)
      if (status === 'degraded') expect(apdexFor(ms)).toBe(0.5)
    }
  })
})

describe('templates and ids', () => {
  it('defines every kind with the four phases', () => {
    expect(JOURNEY_KINDS).toHaveLength(5)
    for (const kind of JOURNEY_KINDS) {
      const template = JOURNEY_TEMPLATES[kind]
      expect(template.label.length).toBeGreaterThan(0)
      expect(Object.keys(template.bases).sort()).toEqual([
        'dns',
        'http',
        'tcp',
        'tls',
      ])
    }
  })

  it('slugs site names for stable journey ids', () => {
    expect(slugify('HQ - Floor 1')).toBe('hq-floor-1')
    expect(journeyId('Data Center A', 'vpn')).toBe('data-center-a:vpn')
  })
})

describe('runJourney', () => {
  it('produces dns → tcp → tls → http steps summing to the total', () => {
    const journey = runJourney(SITES[0]!, 'vpn', SEED, TICK)
    expect(journey.steps.map((step) => step.key)).toEqual([
      'dns',
      'tcp',
      'tls',
      'http',
    ])
    for (const step of journey.steps) expect(step.ms).toBeGreaterThan(0)
    const sum = journey.steps.reduce((total, step) => total + step.ms, 0)
    expect(journey.totalMs).toBe(sum)
    expect(journey.apdex).toBeGreaterThanOrEqual(0)
    expect(journey.apdex).toBeLessThanOrEqual(1)
    expect(journey.availabilityPct).toBeGreaterThanOrEqual(0)
    expect(journey.availabilityPct).toBeLessThanOrEqual(100)
  })

  it('is deterministic for identical inputs', () => {
    const a = runJourney(SITES[2]!, 'checkout', SEED, TICK)
    const b = runJourney(SITES[2]!, 'checkout', SEED, TICK)
    expect(a).toEqual(b)
  })

  it('keeps a fixed-length positive history that slides with the tick', () => {
    const now = runJourney(SITES[1]!, 'mail', SEED, TICK)
    const next = runJourney(SITES[1]!, 'mail', SEED, TICK + 1)
    expect(now.history).toHaveLength(HISTORY_POINTS)
    for (const value of now.history) expect(value).toBeGreaterThan(0)
    expect(next.history.slice(0, HISTORY_POINTS - 1)).toEqual(
      now.history.slice(1),
    )
  })

  it('honours the failure rate with an error and reduced availability', () => {
    const journeys = runFleetJourneys(SITES, SEED, TICK)
    const failures = journeys.filter(
      (journey) => journey.status === 'failing' && journey.error,
    )
    expect(failures.length).toBeGreaterThan(0)
    for (const journey of failures) {
      expect(journey.error).toContain(journey.label)
      expect(journey.availabilityPct).toBeLessThan(100)
    }
    expect(FAILURE_RATE).toBeGreaterThan(0)
  })

  it('mixes healthy, degraded and failing journeys at the demo seed', () => {
    const journeys = runFleetJourneys(SITES, SEED, TICK)
    const statuses = new Set(journeys.map((journey) => journey.status))
    expect(statuses).toEqual(new Set(['healthy', 'degraded', 'failing']))
  })
})

describe('runFleetJourneys', () => {
  it('covers every site × kind with unique ids and template labels', () => {
    const journeys = runFleetJourneys(SITES, SEED, TICK)
    expect(journeys).toHaveLength(SITES.length * JOURNEY_KINDS.length)
    const ids = new Set(journeys.map((journey) => journey.id))
    expect(ids.size).toBe(journeys.length)
    for (const journey of journeys) {
      expect(journey.site).toBe(SITES.find((site) => site === journey.site))
      expect(journey.label).toBe(JOURNEY_TEMPLATES[journey.kind].label)
      expect(journey.id).toBe(journeyId(journey.site, journey.kind))
    }
  })

  it('changes with the seed while staying deterministic', () => {
    const a = runFleetJourneys(SITES, SEED, TICK)
    const b = runFleetJourneys(SITES, SEED, TICK)
    const other = runFleetJourneys(SITES, SEED + 1, TICK)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(other))
  })
})

describe('siteExperience', () => {
  it('rolls journeys up per site with worst-status ordering', () => {
    const journeys = runFleetJourneys(SITES, SEED, TICK)
    const sites = siteExperience(SITES, journeys)
    expect(sites).toHaveLength(SITES.length)
    for (const site of sites) {
      expect(site.journeys).toHaveLength(JOURNEY_KINDS.length)
      expect(site.avgApdex).toBeGreaterThanOrEqual(0)
      expect(site.avgApdex).toBeLessThanOrEqual(1)
      expect(site.avgLatencyMs).toBeGreaterThan(0)
      for (const journey of site.journeys) expect(journey.site).toBe(site.site)
    }
    const healthy = sites.find((site) => site.status === 'healthy')
    if (healthy) {
      for (const journey of healthy.journeys) {
        expect(journey.status).toBe('healthy')
      }
    }
    expect(siteExperience([], [])).toEqual([])
  })
})

describe('experienceSummary', () => {
  it('counts every journey exactly once and averages correctly', () => {
    const journeys = runFleetJourneys(SITES, SEED, TICK)
    const summary = experienceSummary(journeys)
    expect(summary.total).toBe(journeys.length)
    expect(summary.healthy + summary.degraded + summary.failing).toBe(
      summary.total,
    )
    const avgApdex =
      journeys.reduce((sum, journey) => sum + journey.apdex, 0) /
      journeys.length
    expect(summary.avgApdex).toBeCloseTo(avgApdex, 6)
    expect(summary.availabilityPct).toBeGreaterThanOrEqual(0)
    expect(summary.availabilityPct).toBeLessThanOrEqual(100)
    expect(summary.score).toBeGreaterThanOrEqual(0)
    expect(summary.score).toBeLessThanOrEqual(100)
  })

  it('returns zeroes for an empty fleet', () => {
    expect(experienceSummary([])).toEqual({
      total: 0,
      healthy: 0,
      degraded: 0,
      failing: 0,
      avgApdex: 0,
      avgLatencyMs: 0,
      availabilityPct: 0,
      score: 0,
    })
  })
})
