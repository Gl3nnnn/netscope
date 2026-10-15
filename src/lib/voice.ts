import type { Device, Severity } from '@/types'
import { hashSeed } from '@/simulation/random'
import { buildCircuits, wanSites, type Circuit } from '@/lib/wan'

export type VoiceCodec = 'g711' | 'g729' | 'opus'
export type CallQuality = 'clear' | 'degraded' | 'failing'
export type VoiceGrade = 'excellent' | 'good' | 'fair' | 'poor'
export type VoiceFindingKind =
  'low-mos' | 'jitter-budget' | 'loss-budget' | 'legacy-codec' | 'single-trunk'

/** Jitter budget recommended by ITU-T G.114-adjacent guidance (ms). */
export const JITTER_BUDGET_MS = 30
/** Packet-loss budget for toll-quality voice (%). */
export const LOSS_BUDGET_PCT = 1
/** Grade thresholds on the 1–4.5 MOS scale. */
export const MOS_EXCELLENT = 4.3
export const MOS_GOOD = 4.0
export const MOS_FAIR = 3.6
/** Minutes of MOS history kept per site. */
export const VOICE_HISTORY_POINTS = 30

export const CODEC_PARAMS: Record<
  VoiceCodec,
  { label: string; bitrateKbps: number; ie: number; bpl: number }
> = {
  g711: { label: 'G.711', bitrateKbps: 64, ie: 0, bpl: 4.3 },
  g729: { label: 'G.729', bitrateKbps: 8, ie: 11, bpl: 19 },
  opus: { label: 'Opus', bitrateKbps: 32, ie: 3, bpl: 6 },
}

export const CODEC_LABELS: Record<VoiceCodec, string> = {
  g711: 'G.711 PCMA/PCMU',
  g729: 'G.729 (legacy)',
  opus: 'Opus adaptive',
}

export const GRADE_LABELS: Record<VoiceGrade, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
}

export const QUALITY_LABELS: Record<CallQuality, string> = {
  clear: 'Clear',
  degraded: 'Degraded',
  failing: 'Failing',
}

export interface VoiceTrunk {
  id: string
  site: string
  carrier: string
  circuitId: string
  channels: number
  hasBackup: boolean
}

export interface CallSample {
  id: string
  site: string
  trunkId: string
  codec: VoiceCodec
  rttMs: number
  jitterMs: number
  lossPct: number
  mos: number
  quality: CallQuality
}

export interface SiteVoice {
  site: string
  trunkId: string
  calls: number
  avgMos: number
  avgJitterMs: number
  avgLossPct: number
  grade: VoiceGrade
  history: number[]
}

export interface VoiceFinding {
  id: string
  kind: VoiceFindingKind
  site: string
  severity: Severity
  message: string
}

export interface VoiceSummary {
  calls: number
  avgMos: number
  clear: number
  degraded: number
  failing: number
  sites: number
  sitesAtRisk: number
}

export interface VoiceResult {
  calls: CallSample[]
  trunks: VoiceTrunk[]
  sites: SiteVoice[]
  findings: VoiceFinding[]
  summary: VoiceSummary
}

/**
 * Simplified ITU-T G.107 E-model: fixed source level, delay and packet-loss
 * impairment, mapped to a mean-opinion score via the standard polynomial.
 */
export function mosFrom(
  rttMs: number,
  jitterMs: number,
  lossPct: number,
  codec: VoiceCodec,
): number {
  const params = CODEC_PARAMS[codec]
  const oneWay = Math.max(0, rttMs) / 2 + Math.max(0, jitterMs)
  const isDelay = 0.024 * oneWay + 0.11 * Math.max(0, oneWay - 177)
  const e = Math.min(1, Math.max(0, lossPct / 100))
  const ieEffective = params.ie + params.bpl * Math.log(1 + 15 * e)
  const r = Math.min(100, Math.max(0, 93.2 - isDelay - ieEffective))
  const mos = 1 + 0.035 * r + r * (r - 60) * (100 - r) * 7e-6
  return Math.min(4.6, Math.max(1, mos))
}

export function mosGrade(mos: number): VoiceGrade {
  if (mos >= MOS_EXCELLENT) return 'excellent'
  if (mos >= MOS_GOOD) return 'good'
  if (mos >= MOS_FAIR) return 'fair'
  return 'poor'
}

export function qualityFor(mos: number): CallQuality {
  if (mos >= MOS_GOOD) return 'clear'
  if (mos >= MOS_FAIR) return 'degraded'
  return 'failing'
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** One SIP trunk per site (plus a second on HQ/DC hubs), bound to circuits. */
export function buildTrunks(
  devices: Device[],
  circuits: Circuit[],
  seed: number,
): {
  trunks: VoiceTrunk[]
  sitePrimary: Map<string, Circuit>
  backupSites: Set<string>
} {
  const sitePrimary = new Map<string, Circuit>()
  const backupSites = new Set<string>()
  for (const circuit of circuits) {
    if (circuit.role === 'primary') sitePrimary.set(circuit.site, circuit)
    else backupSites.add(circuit.site)
  }

  const trunks: VoiceTrunk[] = []
  for (const site of wanSites(devices)) {
    const hub = site.startsWith('HQ') || site.startsWith('Data Center')
    const count = hub ? 2 : 1
    const primary = sitePrimary.get(site)
    for (let n = 1; n <= count; n += 1) {
      trunks.push({
        id: `trunk-${slug(site)}-${n}`,
        site,
        carrier: primary ? primary.carrier : 'Unknown carrier',
        circuitId: primary ? primary.id : '',
        channels: ((hashSeed(`trunk:${site}:${n}:${seed}`) % 4) + 1) * 30,
        hasBackup: backupSites.has(site),
      })
    }
  }
  return { trunks, sitePrimary, backupSites }
}

function pickCodec(h: number): VoiceCodec {
  const roll = h % 10
  if (roll < 6) return 'g711'
  if (roll < 8) return 'opus'
  return 'g729'
}

/** Simulated call samples for every site at a minute tick. */
export function generateCalls(
  devices: Device[],
  seed: number,
  tick: number,
): { calls: CallSample[]; trunks: VoiceTrunk[] } {
  const circuits = buildCircuits(devices, {}, seed)
  const { trunks, sitePrimary } = buildTrunks(devices, circuits, seed)

  const calls: CallSample[] = []
  for (const trunk of trunks) {
    const circuit = sitePrimary.get(trunk.site)
    const count = 4 + (hashSeed(`voice:${trunk.id}:${tick}`) % 5)
    for (let n = 0; n < count; n += 1) {
      const h = hashSeed(`${seed}|${trunk.id}|${tick}|${n}`)
      const codec = pickCodec(h)
      const circuitJitter = circuit ? circuit.jitterMs : 5
      const circuitLoss = circuit ? circuit.lossPct : 0.2
      const circuitLatency = circuit ? circuit.latencyMs : 20
      const statusHit =
        circuit && circuit.status === 'down'
          ? 1
          : circuit && circuit.status === 'degraded'
            ? 0.35
            : 0
      const rttMs = circuitLatency + ((h >>> 3) % 12)
      const jitterMs = circuitJitter + ((h >>> 7) % 10) + statusHit * 18
      const lossPct = circuitLoss + ((h >>> 11) % 40) / 100 + statusHit * 3
      const mos = mosFrom(rttMs, jitterMs, lossPct, codec)
      calls.push({
        id: `call-${trunk.id}-${tick}-${n}`,
        site: trunk.site,
        trunkId: trunk.id,
        codec,
        rttMs,
        jitterMs: Math.round(jitterMs * 10) / 10,
        lossPct: Math.round(lossPct * 100) / 100,
        mos: Math.round(mos * 100) / 100,
        quality: qualityFor(mos),
      })
    }
  }
  return { calls, trunks }
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Per-site rollups for one tick (no history). */
export function siteVoice(
  sites: readonly string[],
  calls: CallSample[],
): Array<Omit<SiteVoice, 'history' | 'trunkId'>> {
  return sites.map((site) => {
    const members = calls.filter((call) => call.site === site)
    const avgMos = average(members.map((call) => call.mos))
    return {
      site,
      calls: members.length,
      avgMos,
      avgJitterMs: average(members.map((call) => call.jitterMs)),
      avgLossPct: average(members.map((call) => call.lossPct)),
      grade: mosGrade(avgMos),
    }
  })
}

export function voiceFindings(
  sites: readonly string[],
  calls: CallSample[],
  trunks: VoiceTrunk[],
): VoiceFinding[] {
  const findings: VoiceFinding[] = []
  for (const rollup of siteVoice(sites, calls)) {
    const { site } = rollup
    if (rollup.calls === 0) continue
    if (rollup.avgMos < MOS_FAIR) {
      findings.push({
        id: `${site}:low-mos`,
        kind: 'low-mos',
        site,
        severity: 'high',
        message: `${site}: average MOS ${rollup.avgMos.toFixed(2)} is below toll quality`,
      })
    }
    if (rollup.avgJitterMs > JITTER_BUDGET_MS) {
      findings.push({
        id: `${site}:jitter-budget`,
        kind: 'jitter-budget',
        site,
        severity:
          rollup.avgJitterMs > JITTER_BUDGET_MS * 2 ? 'critical' : 'medium',
        message: `${site}: mean jitter ${rollup.avgJitterMs.toFixed(0)} ms exceeds the ${JITTER_BUDGET_MS} ms budget`,
      })
    }
    if (rollup.avgLossPct > LOSS_BUDGET_PCT) {
      findings.push({
        id: `${site}:loss-budget`,
        kind: 'loss-budget',
        site,
        severity:
          rollup.avgLossPct > LOSS_BUDGET_PCT * 2 ? 'critical' : 'medium',
        message: `${site}: mean loss ${rollup.avgLossPct.toFixed(1)}% exceeds the ${LOSS_BUDGET_PCT}% budget`,
      })
    }
    const legacy = membersUsing(calls, site, 'g729')
    if (legacy > 0 && rollup.avgMos < MOS_EXCELLENT) {
      findings.push({
        id: `${site}:legacy-codec`,
        kind: 'legacy-codec',
        site,
        severity: 'low',
        message: `${site}: ${legacy} call(s) on G.729 with imperfect quality`,
      })
    }
    for (const trunk of trunks.filter((item) => item.site === site)) {
      if (!trunk.hasBackup) {
        findings.push({
          id: `${trunk.id}:single-trunk`,
          kind: 'single-trunk',
          site,
          severity: 'medium',
          message: `${site}: trunk ${trunk.id} has no backup path to its carrier`,
        })
      }
    }
  }
  return findings
}

function membersUsing(
  calls: CallSample[],
  site: string,
  codec: VoiceCodec,
): number {
  return calls.filter((call) => call.site === site && call.codec === codec)
    .length
}

export function voiceSummary(
  calls: CallSample[],
  siteRollups: Array<Omit<SiteVoice, 'history' | 'trunkId'>>,
): VoiceSummary {
  if (calls.length === 0) {
    return {
      calls: 0,
      avgMos: 0,
      clear: 0,
      degraded: 0,
      failing: 0,
      sites: 0,
      sitesAtRisk: 0,
    }
  }
  let clear = 0
  let degraded = 0
  let failing = 0
  for (const call of calls) {
    if (call.quality === 'clear') clear += 1
    else if (call.quality === 'degraded') degraded += 1
    else failing += 1
  }
  return {
    calls: calls.length,
    avgMos: average(calls.map((call) => call.mos)),
    clear,
    degraded,
    failing,
    sites: siteRollups.length,
    sitesAtRisk: siteRollups.filter(
      (rollup) => rollup.grade === 'poor' || rollup.grade === 'fair',
    ).length,
  }
}

/** Full voice view: calls, trunks, site rollups with history, findings, summary. */
export function runVoice(
  devices: Device[],
  sites: readonly string[],
  seed: number,
  tick: number,
): VoiceResult {
  const { calls, trunks } = generateCalls(devices, seed, tick)

  const window: CallSample[][] = []
  for (let i = VOICE_HISTORY_POINTS - 1; i >= 0; i -= 1) {
    window.push(generateCalls(devices, seed, tick - i).calls)
  }

  const siteVoices: SiteVoice[] = sites.map((site) => {
    const members = calls.filter((call) => call.site === site)
    const trunk = trunks.find((item) => item.site === site)
    const avgMos = average(members.map((call) => call.mos))
    const history = window.map((sample) => {
      const perSite = sample.filter((call) => call.site === site)
      return Math.round(average(perSite.map((call) => call.mos)) * 100) / 100
    })
    return {
      site,
      trunkId: trunk ? trunk.id : '',
      calls: members.length,
      avgMos,
      avgJitterMs: average(members.map((call) => call.jitterMs)),
      avgLossPct: average(members.map((call) => call.lossPct)),
      grade: mosGrade(avgMos),
      history,
    }
  })

  const rollups = siteVoices.map(
    ({ history: _history, trunkId: _trunk, ...rest }) => rest,
  )
  return {
    calls,
    trunks,
    sites: siteVoices,
    findings: voiceFindings(sites, calls, trunks),
    summary: voiceSummary(calls, rollups),
  }
}
