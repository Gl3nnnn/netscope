import { describe, expect, it } from 'vitest'
import type { FlowRecord, ApplicationKind } from '@/lib/flow'
import {
  CLASS_META,
  CLASS_ORDER,
  DSCP_NAMES,
  classifyFlows,
  classifyFlow,
  classStats,
  defaultWeights,
  detectStarvation,
  formatUtilisation,
  packetsPerMb,
  priorityInversion,
  qosGrade,
  qosScore,
  qosSummary,
  totalThroughput,
  whatIfReshape,
  QOS_POLICIES,
} from '@/lib/qos'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFlow(overrides: Partial<FlowRecord> & { id: string }): FlowRecord {
  return {
    sourceDeviceId: 'dev-1',
    destDeviceId: 'dev-2',
    destSite: 'HQ - Floor 2',
    application: 'web',
    protocol: 'TCP',
    port: 443,
    throughputMbps: 10,
    packetsPerSec: 1400,
    direction: 'east-west',
    ...overrides,
  }
}

/** A mixed workload that exercises every traffic class. */
function mixedFlows(): FlowRecord[] {
  return [
    makeFlow({
      id: 'f-1',
      application: 'voip',
      throughputMbps: 40,
      packetsPerSec: 24_800,
    }),
    makeFlow({
      id: 'f-2',
      application: 'video',
      throughputMbps: 30,
      packetsPerSec: 2700,
    }),
    makeFlow({
      id: 'f-3',
      application: 'database',
      throughputMbps: 20,
      packetsPerSec: 4200,
    }),
    makeFlow({
      id: 'f-4',
      application: 'ssh',
      throughputMbps: 5,
      packetsPerSec: 1500,
    }),
    makeFlow({
      id: 'f-5',
      application: 'web',
      throughputMbps: 25,
      packetsPerSec: 3500,
    }),
    makeFlow({
      id: 'f-6',
      application: 'mail',
      throughputMbps: 8,
      packetsPerSec: 1440,
    }),
    makeFlow({
      id: 'f-7',
      application: 'backup',
      throughputMbps: 50,
      packetsPerSec: 3500,
    }),
    makeFlow({
      id: 'f-8',
      application: 'file',
      throughputMbps: 15,
      packetsPerSec: 1425,
    }),
    makeFlow({
      id: 'f-9',
      application: 'other',
      throughputMbps: 7,
      packetsPerSec: 1050,
    }),
    makeFlow({
      id: 'f-10',
      application: 'dns',
      throughputMbps: 3,
      packetsPerSec: 2400,
    }),
  ]
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe('classifyFlow', () => {
  it('maps applications to the expected classes', () => {
    expect(classifyFlow(makeFlow({ id: 'a', application: 'voip' }))).toBe(
      'realtime',
    )
    expect(classifyFlow(makeFlow({ id: 'b', application: 'video' }))).toBe(
      'realtime',
    )
    expect(classifyFlow(makeFlow({ id: 'c', application: 'database' }))).toBe(
      'interactive',
    )
    expect(classifyFlow(makeFlow({ id: 'd', application: 'ssh' }))).toBe(
      'interactive',
    )
    expect(classifyFlow(makeFlow({ id: 'e', application: 'web' }))).toBe(
      'transactional',
    )
    expect(classifyFlow(makeFlow({ id: 'f', application: 'mail' }))).toBe(
      'transactional',
    )
    expect(classifyFlow(makeFlow({ id: 'g', application: 'backup' }))).toBe(
      'bulk',
    )
    expect(classifyFlow(makeFlow({ id: 'h', application: 'file' }))).toBe(
      'bulk',
    )
    expect(classifyFlow(makeFlow({ id: 'i', application: 'other' }))).toBe(
      'best-effort',
    )
    expect(classifyFlow(makeFlow({ id: 'j', application: 'dns' }))).toBe(
      'interactive',
    )
  })

  it('returns a valid traffic class for every flow', () => {
    for (const flow of mixedFlows()) {
      expect(CLASS_ORDER).toContain(classifyFlow(flow))
    }
  })
})

describe('classifyFlows', () => {
  it('preserves order and carries DSCP markings', () => {
    const classified = classifyFlows(mixedFlows())
    expect(classified).toHaveLength(10)
    expect(classified[0]!.flow.id).toBe('f-1')
    expect(classified[0]!.class).toBe('realtime')
    expect(classified[0]!.dscp).toBe(CLASS_META.realtime.dscp)
    expect(classified[0]!.dscpName).toBe('EF')
  })

  it('handles an empty input', () => {
    expect(classifyFlows([])).toEqual([])
  })
})

describe('DSCP reference data', () => {
  it('gives every class a unique DSCP codepoint', () => {
    const dscps = CLASS_ORDER.map((cls) => CLASS_META[cls].dscp)
    expect(new Set(dscps).size).toBe(dscps.length)
  })

  it('default weights sum to 100', () => {
    const weights = defaultWeights()
    const total = CLASS_ORDER.reduce((sum, cls) => sum + weights[cls], 0)
    expect(total).toBe(100)
  })

  it('DSCP_NAMES agrees with CLASS_META', () => {
    for (const cls of CLASS_ORDER) {
      const meta = CLASS_META[cls]
      expect(DSCP_NAMES[meta.dscp]).toBe(meta.dscpName)
    }
  })
})

describe('totalThroughput', () => {
  it('sums flow throughput', () => {
    expect(totalThroughput(mixedFlows())).toBeCloseTo(203, 1)
  })

  it('is zero for no flows', () => {
    expect(totalThroughput([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Class stats
// ---------------------------------------------------------------------------

describe('classStats', () => {
  const stats = classStats(mixedFlows())

  it('returns one stat per traffic class', () => {
    expect(stats).toHaveLength(CLASS_ORDER.length)
    expect(stats.map((s) => s.class)).toEqual(CLASS_ORDER)
  })

  it('aggregates throughput per class', () => {
    const realtime = stats.find((s) => s.class === 'realtime')!
    expect(realtime.throughputMbps).toBeCloseTo(70, 1) // voip 40 + video 30
    const bulk = stats.find((s) => s.class === 'bulk')!
    expect(bulk.throughputMbps).toBeCloseTo(65, 1) // backup 50 + file 15
  })

  it('shares sum to ~100', () => {
    const total = stats.reduce((sum, s) => sum + s.sharePct, 0)
    expect(total).toBeCloseTo(100, 0)
  })

  it('allocations match weights against capacity', () => {
    const capacity = 500
    const withCapacity = classStats(mixedFlows(), capacity)
    const interactive = withCapacity.find((s) => s.class === 'interactive')!
    expect(interactive.allocatedMbps).toBeCloseTo(125, 1) // 25% of 500
  })

  it('computes zero drops when capacity is ample', () => {
    const calm = classStats(mixedFlows(), 1000)
    for (const stat of calm) {
      expect(stat.dropsMbps).toBe(0)
      expect(stat.dropsPps).toBe(0)
    }
  })

  it('detects drops when a class exceeds its allocation', () => {
    const squeezed = classStats(mixedFlows(), 150)
    const bulk = squeezed.find((s) => s.class === 'bulk')!
    expect(bulk.dropsMbps).toBeGreaterThan(0)
    expect(bulk.dropsPps).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(classStats(mixedFlows(), 200)).toEqual(classStats(mixedFlows(), 200))
  })
})

describe('detectStarvation', () => {
  it('lists classes that are over allocation', () => {
    const starved = detectStarvation(classStats(mixedFlows(), 150))
    expect(starved).toContain('bulk')
  })

  it('is empty on a well-sized link', () => {
    expect(detectStarvation(classStats(mixedFlows(), 5000))).toEqual([])
  })
})

describe('priorityInversion', () => {
  it('flags inversion when bulk outranks starved realtime', () => {
    const stats = [
      {
        class: 'realtime' as const,
        label: 'Realtime',
        dscp: 46,
        dscpName: 'EF',
        queue: 'Priority queue (LLQ)',
        weight: 30,
        flows: 1,
        throughputMbps: 20,
        sharePct: 20,
        allocatedMbps: 45,
        utilisationPct: 44,
        dropsMbps: 15,
        dropsPps: 500,
      },
      {
        class: 'bulk' as const,
        label: 'Bulk / Backup',
        dscp: 8,
        dscpName: 'CS1',
        queue: 'Scavenger (background)',
        weight: 15,
        flows: 1,
        throughputMbps: 40,
        sharePct: 40,
        allocatedMbps: 22,
        utilisationPct: 180,
        dropsMbps: 18,
        dropsPps: 300,
      },
    ]
    const result = priorityInversion(stats)
    expect(result.inverted).toBe(true)
    expect(result.detail).toContain('Bulk')
  })

  it('does not flag when realtime is not dropping', () => {
    const stats = classStats(mixedFlows(), 5000)
    expect(priorityInversion(stats).inverted).toBe(false)
    expect(priorityInversion(stats).detail).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Summary & score
// ---------------------------------------------------------------------------

describe('qosSummary', () => {
  it('summarises an ample-capacity run as clean', () => {
    const summary = qosSummary(mixedFlows(), 5000)
    expect(summary.totalFlows).toBe(10)
    expect(summary.byClass).toHaveLength(5)
    expect(summary.dropsMbps).toBe(0)
    expect(summary.starved).toEqual([])
    expect(summary.inversion).toBe(false)
    expect(summary.score).toBe(100)
    expect(summary.grade).toBe('clean')
  })

  it('penalises drops and starvation on a squeezed link', () => {
    const summary = qosSummary(mixedFlows(), 120)
    expect(summary.dropsMbps).toBeGreaterThan(0)
    expect(summary.starved.length).toBeGreaterThan(0)
    expect(summary.score).toBeLessThan(85)
    expect(
      summary.inversionDetail === null ||
        typeof summary.inversionDetail === 'string',
    ).toBe(true)
  })

  it('capacity defaults to total demand', () => {
    const summary = qosSummary(mixedFlows())
    expect(summary.capacityMbps).toBeCloseTo(summary.throughputMbps, 1)
  })
})

describe('qosScore / qosGrade', () => {
  it('clamps to 0..100', () => {
    const clean = qosSummary(mixedFlows(), 5000)
    expect(
      qosScore({
        ...clean,
        dropsMbps: 10_000,
        starved: CLASS_ORDER,
        inversion: true,
      }),
    ).toBe(0)
  })

  it('grades match score thresholds', () => {
    expect(qosGrade(95)).toBe('clean')
    expect(qosGrade(70)).toBe('stressed')
    expect(qosGrade(30)).toBe('failing')
  })
})

// ---------------------------------------------------------------------------
// What-if reshaping (clone-only)
// ---------------------------------------------------------------------------

describe('whatIfReshape', () => {
  it('does not mutate the input flows', () => {
    const flows = mixedFlows()
    const snapshot = JSON.parse(JSON.stringify(flows))
    whatIfReshape(
      flows,
      {
        realtime: 60,
        interactive: 20,
        transactional: 10,
        bulk: 5,
        'best-effort': 5,
      },
      200,
    )
    expect(flows).toEqual(snapshot)
  })

  it('rejects weights that do not sum to 100', () => {
    const result = whatIfReshape(mixedFlows(), { realtime: 90 }, 200)
    expect(result.valid).toBe(false)
  })

  it('reports drop deltas per class', () => {
    const candidate = {
      realtime: 50,
      interactive: 25,
      transactional: 15,
      bulk: 5,
      'best-effort': 5,
    }
    const result = whatIfReshape(mixedFlows(), candidate, 200)
    expect(result.valid).toBe(true)
    expect(Object.keys(result.dropsDelta)).toHaveLength(5)
    // Giving bulk only 5% must increase its drops (or keep them equal).
    expect(result.dropsDelta.bulk).toBeGreaterThanOrEqual(0)
  })

  it('before-stats match an unshaped classStats run', () => {
    const result = whatIfReshape(mixedFlows(), defaultWeights(), 300)
    expect(result.before).toEqual(classStats(mixedFlows(), 300))
    expect(result.valid).toBe(true)
  })

  it('reshape is deterministic', () => {
    const candidate = {
      realtime: 40,
      interactive: 30,
      transactional: 15,
      bulk: 10,
      'best-effort': 5,
    }
    expect(whatIfReshape(mixedFlows(), candidate, 250)).toEqual(
      whatIfReshape(mixedFlows(), candidate, 250),
    )
  })
})

describe('QOS_POLICIES', () => {
  it('every policy has valid weights summing to 100', () => {
    for (const policy of QOS_POLICIES) {
      const total = CLASS_ORDER.reduce(
        (sum, cls) => sum + policy.weights[cls],
        0,
      )
      expect(total).toBe(100)
    }
  })

  it('policy ids are unique', () => {
    const ids = QOS_POLICIES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('helpers', () => {
  it('formatUtilisation renders a percentage', () => {
    const [stat] = classStats(mixedFlows())
    expect(formatUtilisation(stat!)).toMatch(/%$/)
  })

  it('packetsPerMb mirrors the flow application metadata', () => {
    expect(packetsPerMb('voip' as ApplicationKind)).toBe(620)
    expect(packetsPerMb('web' as ApplicationKind)).toBe(140)
  })
})
