import { describe, expect, it } from 'vitest'
import type { Device, Severity } from '@/types'
import { SITES } from '@/simulation/seed'
import {
  CODEC_LABELS,
  CODEC_PARAMS,
  GRADE_LABELS,
  JITTER_BUDGET_MS,
  LOSS_BUDGET_PCT,
  MOS_FAIR,
  MOS_GOOD,
  QUALITY_LABELS,
  VOICE_HISTORY_POINTS,
  buildTrunks,
  generateCalls,
  mosFrom,
  mosGrade,
  qualityFor,
  runVoice,
  siteVoice,
  voiceFindings,
  voiceSummary,
} from '@/lib/voice'
import { buildCircuits } from '@/lib/wan'

const SEED = 7
const TICK = 42
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

function makeDevice(overrides: Partial<Device> & { id: string }): Device {
  return {
    name: overrides.id,
    type: 'server',
    site: 'HQ - Floor 1',
    ip: '10.0.0.1',
    mac: '00:00:00:00:00:00',
    status: 'online',
    tags: [],
    latencyMs: 8,
    packetLossPct: 0,
    availabilityPct: 99.9,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 30,
    memoryPct: 45,
    uptimeSec: 900_000,
    lastSeen: 0,
    ...overrides,
  }
}

function fleet(): Device[] {
  return SITES.map((site, index) =>
    makeDevice({ id: `d${index}`, site, throughputMbps: 80 + index * 40 }),
  )
}

const DEVICES = fleet()

// ---------------------------------------------------------------------------
// E-model
// ---------------------------------------------------------------------------

describe('mosFrom', () => {
  it('scores clean G.711 as toll quality', () => {
    expect(mosFrom(20, 0, 0, 'g711')).toBeGreaterThan(4.3)
  })

  it('decreases as packet loss grows', () => {
    const losses = [0, 0.5, 1, 2, 5]
    const scores = losses.map((loss) => mosFrom(40, 5, loss, 'g711'))
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeLessThan(scores[i - 1]!)
    }
  })

  it('decreases as delay and jitter grow', () => {
    const clean = mosFrom(20, 0, 0.1, 'opus')
    const slow = mosFrom(220, 40, 0.1, 'opus')
    expect(slow).toBeLessThan(clean)
  })

  it('penalises lossy codecs on identical conditions', () => {
    const g711 = mosFrom(60, 10, 1, 'g711')
    const opus = mosFrom(60, 10, 1, 'opus')
    const g729 = mosFrom(60, 10, 1, 'g729')
    expect(g711).toBeGreaterThan(opus)
    expect(opus).toBeGreaterThan(g729)
  })

  it('stays clamped within the MOS scale', () => {
    for (const [rtt, jitter, loss] of [
      [0, 0, 0],
      [5000, 500, 100],
      [-10, -10, -5],
    ] as const) {
      const score = mosFrom(rtt, jitter, loss, 'g729')
      expect(score).toBeGreaterThanOrEqual(1)
      expect(score).toBeLessThanOrEqual(4.6)
    }
  })
})

describe('grades and quality', () => {
  it('maps MOS boundaries to grades', () => {
    expect(mosGrade(4.3)).toBe('excellent')
    expect(mosGrade(4.29)).toBe('good')
    expect(mosGrade(4.0)).toBe('good')
    expect(mosGrade(3.99)).toBe('fair')
    expect(mosGrade(3.6)).toBe('fair')
    expect(mosGrade(3.59)).toBe('poor')
    for (const grade of Object.values(GRADE_LABELS)) {
      expect(grade.length).toBeGreaterThan(0)
    }
  })

  it('maps MOS to per-call quality buckets', () => {
    expect(qualityFor(MOS_GOOD)).toBe('clear')
    expect(qualityFor(MOS_FAIR)).toBe('degraded')
    expect(qualityFor(MOS_FAIR - 0.01)).toBe('failing')
    for (const label of Object.values(QUALITY_LABELS)) {
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('keeps documented budgets', () => {
    expect(JITTER_BUDGET_MS).toBe(30)
    expect(LOSS_BUDGET_PCT).toBe(1)
  })
})

describe('codec metadata', () => {
  it('defines params and labels for every codec', () => {
    expect(Object.keys(CODEC_PARAMS).sort()).toEqual(['g711', 'g729', 'opus'])
    for (const codec of ['g711', 'g729', 'opus'] as const) {
      expect(CODEC_PARAMS[codec].bitrateKbps).toBeGreaterThan(0)
      expect(CODEC_PARAMS[codec].ie).toBeGreaterThanOrEqual(0)
      expect(CODEC_LABELS[codec].length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Trunks and calls
// ---------------------------------------------------------------------------

describe('buildTrunks', () => {
  it('gives hubs two trunks and branches one, bound to circuits', () => {
    const circuits = buildCircuits(DEVICES, {}, SEED)
    const { trunks } = buildTrunks(DEVICES, circuits, SEED)
    for (const site of SITES) {
      const siteTrunks = trunks.filter((trunk) => trunk.site === site)
      const hub = site.startsWith('HQ') || site.startsWith('Data Center')
      expect(siteTrunks).toHaveLength(hub ? 2 : 1)
      for (const trunk of siteTrunks) {
        expect(trunk.channels).toBeGreaterThanOrEqual(30)
        expect(trunk.channels % 30).toBe(0)
        expect(trunk.carrier.length).toBeGreaterThan(0)
      }
    }
    expect(trunks.some((trunk) => trunk.hasBackup)).toBe(true)
  })
})

describe('generateCalls', () => {
  it('produces unique, well-formed calls for every site', () => {
    const { calls, trunks } = generateCalls(DEVICES, SEED, TICK)
    const ids = new Set(calls.map((call) => call.id))
    expect(ids.size).toBe(calls.length)
    for (const site of SITES) {
      expect(
        calls.filter((call) => call.site === site).length,
      ).toBeGreaterThanOrEqual(4)
    }
    const trunkIds = new Set(trunks.map((trunk) => trunk.id))
    for (const call of calls) {
      expect(trunkIds.has(call.trunkId)).toBe(true)
      expect(CODEC_LABELS[call.codec]).toBeTruthy()
      expect(call.rttMs).toBeGreaterThan(0)
      expect(call.jitterMs).toBeGreaterThanOrEqual(0)
      expect(call.lossPct).toBeGreaterThanOrEqual(0)
      expect(call.mos).toBeGreaterThanOrEqual(1)
      expect(call.mos).toBeLessThanOrEqual(4.6)
      expect(Object.keys(QUALITY_LABELS)).toContain(call.quality)
    }
  })

  it('is deterministic per seed and varies across seeds', () => {
    const a = generateCalls(DEVICES, SEED, TICK)
    const b = generateCalls(DEVICES, SEED, TICK)
    const other = generateCalls(DEVICES, SEED + 1, TICK)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(other))
  })
})

// ---------------------------------------------------------------------------
// Rollups
// ---------------------------------------------------------------------------

describe('siteVoice', () => {
  it('averages member calls and grades them', () => {
    const { calls } = generateCalls(DEVICES, SEED, TICK)
    const rollups = siteVoice(SITES, calls)
    expect(rollups).toHaveLength(SITES.length)
    for (const rollup of rollups) {
      const members = calls.filter((call) => call.site === rollup.site)
      expect(rollup.calls).toBe(members.length)
      const avg =
        members.reduce((sum, call) => sum + call.mos, 0) / members.length
      expect(rollup.avgMos).toBeCloseTo(avg, 6)
      expect(rollup.grade).toBe(mosGrade(rollup.avgMos))
      expect(Object.keys(GRADE_LABELS)).toContain(rollup.grade)
    }
  })

  it('returns empty for an empty site list', () => {
    expect(siteVoice([], [])).toEqual([])
  })
})

describe('voiceSummary', () => {
  it('partitions calls and computes averages', () => {
    const { calls } = generateCalls(DEVICES, SEED, TICK)
    const rollups = siteVoice(SITES, calls)
    const summary = voiceSummary(calls, rollups)
    expect(summary.calls).toBe(calls.length)
    expect(summary.clear + summary.degraded + summary.failing).toBe(
      calls.length,
    )
    const avg = calls.reduce((sum, call) => sum + call.mos, 0) / calls.length
    expect(summary.avgMos).toBeCloseTo(avg, 6)
    expect(summary.sites).toBe(SITES.length)
    expect(summary.sitesAtRisk).toBeLessThanOrEqual(SITES.length)
  })

  it('returns zeroes for an empty fleet', () => {
    expect(voiceSummary([], [])).toEqual({
      calls: 0,
      avgMos: 0,
      clear: 0,
      degraded: 0,
      failing: 0,
      sites: 0,
      sitesAtRisk: 0,
    })
  })
})

describe('voiceFindings', () => {
  it('emits unique, severity-ranked findings tied to real sites', () => {
    const { calls, trunks } = generateCalls(DEVICES, SEED, TICK)
    const findings = voiceFindings(SITES, calls, trunks)
    expect(findings.length).toBeGreaterThan(0)
    const ids = new Set(findings.map((finding) => finding.id))
    expect(ids.size).toBe(findings.length)
    for (const finding of findings) {
      expect(SITES).toContain(finding.site)
      expect(SEVERITIES).toContain(finding.severity)
      expect(finding.message).toContain(finding.site)
      expect(finding.id).toContain(finding.kind)
    }
  })

  it('flags low-MOS sites as high severity', () => {
    const poor = SITES.map((site) => ({
      id: `call-${site}`,
      site,
      trunkId: 'trunk-x',
      codec: 'g729' as const,
      rttMs: 400,
      jitterMs: 120,
      lossPct: 8,
      mos: 2.1,
      quality: 'failing' as const,
    }))
    const findings = voiceFindings(SITES, poor, [
      {
        id: 'trunk-x',
        site: SITES[0]!,
        carrier: 'Acme',
        circuitId: 'c1',
        channels: 30,
        hasBackup: false,
      },
    ])
    const lowMos = findings.filter((finding) => finding.kind === 'low-mos')
    expect(lowMos).toHaveLength(SITES.length)
    expect(lowMos.every((finding) => finding.severity === 'high')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

describe('runVoice', () => {
  it('is deterministic and keeps a sliding MOS history per site', () => {
    const now = runVoice(DEVICES, SITES, SEED, TICK)
    const again = runVoice(DEVICES, SITES, SEED, TICK)
    const next = runVoice(DEVICES, SITES, SEED, TICK + 1)
    expect(now).toEqual(again)
    for (const site of now.sites) {
      expect(site.history).toHaveLength(VOICE_HISTORY_POINTS)
      for (const value of site.history) {
        expect(value).toBeGreaterThanOrEqual(1)
        expect(value).toBeLessThanOrEqual(4.6)
      }
      const sibling = next.sites.find((item) => item.site === site.site)!
      expect(sibling.history.slice(0, VOICE_HISTORY_POINTS - 1)).toEqual(
        site.history.slice(1),
      )
    }
  })

  it('ties rollups, findings and summary back to the call set', () => {
    const result = runVoice(DEVICES, SITES, SEED, TICK)
    expect(result.summary.calls).toBe(result.calls.length)
    const callSites = new Set(result.calls.map((call) => call.site))
    for (const site of result.sites) {
      expect(callSites.has(site.site)).toBe(true)
      expect(site.calls).toBeGreaterThan(0)
    }
    for (const finding of result.findings) {
      expect(SITES).toContain(finding.site)
    }
  })

  it('stays deterministic per seed and differs across seeds', () => {
    const a = runVoice(DEVICES, SITES, SEED, TICK)
    const b = runVoice(DEVICES, SITES, SEED, TICK)
    const other = runVoice(DEVICES, SITES, SEED + 5, TICK)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(other))
  })
})
