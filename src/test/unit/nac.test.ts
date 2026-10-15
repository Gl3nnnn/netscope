import { describe, expect, it } from 'vitest'
import type { Device, Severity } from '@/types'
import { SITES } from '@/simulation/seed'
import {
  KIND_LABELS,
  METHOD_LABELS,
  POSTURE_LABELS,
  generateEndpoints,
  nacFindings,
  nacSummary,
  postureBreakdown,
  runNac,
  withQuarantine,
} from '@/lib/nac'

const SEED = 7
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
  const types = [
    'server',
    'switch',
    'accessPoint',
    'router',
    'firewall',
  ] as const
  return SITES.map((site, index) =>
    makeDevice({
      id: `d${index}`,
      site,
      type: types[index % types.length]!,
      name: `dev-${index}`,
    }),
  )
}

const DEVICES = fleet()

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('generateEndpoints', () => {
  it('creates unique, well-formed endpoints for devices and guests', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED)
    const ids = new Set(endpoints.map((endpoint) => endpoint.id))
    expect(ids.size).toBe(endpoints.length)
    expect(endpoints.length).toBeGreaterThan(DEVICES.length)
    for (const endpoint of endpoints) {
      expect(endpoint.mac.split(':')).toHaveLength(6)
      expect(Object.keys(METHOD_LABELS)).toContain(endpoint.method)
      expect(Object.keys(KIND_LABELS)).toContain(endpoint.kind)
      expect(Object.keys(POSTURE_LABELS)).toContain(endpoint.posture)
      expect(endpoint.site.length).toBeGreaterThan(0)
      expect(endpoint.authFailures).toBeGreaterThanOrEqual(0)
      expect(endpoint.checks).toHaveLength(4)
      if (endpoint.method === 'guest') {
        expect(endpoint.posture).toBe('guest')
        expect(endpoint.deviceId).toBe('')
      } else {
        expect(endpoint.deviceId.length).toBeGreaterThan(0)
      }
    }
  })

  it('gives every site guest endpoints', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED)
    for (const site of SITES) {
      expect(
        endpoints.filter(
          (endpoint) => endpoint.site === site && endpoint.method === 'guest',
        ).length,
      ).toBeGreaterThanOrEqual(2)
    }
  })

  it('is deterministic per seed and differs across seeds', () => {
    const a = generateEndpoints(DEVICES, SITES, SEED)
    const b = generateEndpoints(DEVICES, SITES, SEED)
    const other = generateEndpoints(DEVICES, SITES, SEED + 1)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(other))
  })

  it('forces unmanaged hardware to fail AV and encryption checks', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED)
    for (const endpoint of endpoints) {
      if (
        endpoint.kind === 'printer' ||
        endpoint.kind === 'iot' ||
        endpoint.kind === 'camera'
      ) {
        expect(
          endpoint.checks.find((check) => check.key === 'av-agent')?.passed,
        ).toBe(false)
        expect(
          endpoint.checks.find((check) => check.key === 'disk-encryption')
            ?.passed,
        ).toBe(false)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

describe('withQuarantine', () => {
  it('marks listed endpoints quarantined without mutating the source', () => {
    const source = generateEndpoints(DEVICES, SITES, SEED)
    const target = source[0]!
    const overlay = withQuarantine(source, [target.id])
    expect(overlay[0]!.quarantined).toBe(true)
    expect(overlay[0]!.posture).toBe('quarantined')
    expect(source[0]!.quarantined).toBe(false)
    expect(source[0]!.posture).not.toBe('quarantined')
    expect(withQuarantine(source, [])).toBe(source)
  })
})

// ---------------------------------------------------------------------------
// Findings and rollups
// ---------------------------------------------------------------------------

describe('nacFindings', () => {
  it('emits unique findings tied to real sites with valid severity', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED)
    const findings = nacFindings(endpoints, SITES)
    expect(findings.length).toBeGreaterThan(0)
    const ids = new Set(findings.map((finding) => finding.id))
    expect(ids.size).toBe(findings.length)
    for (const finding of findings) {
      expect(SITES).toContain(finding.site)
      expect(SEVERITIES).toContain(finding.severity)
      expect(finding.message.length).toBeGreaterThan(0)
    }
  })

  it('skips quarantined endpoints and counts guest overstay per site', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED).map(
      (endpoint) => ({ ...endpoint, quarantined: true }),
    )
    const findings = nacFindings(endpoints, SITES)
    expect(
      findings.filter(
        (finding) =>
          finding.kind === 'auth-storm' ||
          finding.kind === 'posture-fail' ||
          finding.kind === 'mab-only',
      ),
    ).toHaveLength(0)
    const overstay = findings.filter(
      (finding) => finding.kind === 'guest-overstay',
    )
    for (const site of SITES) {
      const count = endpoints.filter(
        (endpoint) => endpoint.site === site && endpoint.method === 'guest',
      ).length
      const finding = overstay.find((item) => item.site === site)
      if (count > 4) expect(finding).toBeDefined()
      else expect(finding).toBeUndefined()
    }
  })

  it('flags MAB-only servers as critical', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED).map((endpoint) =>
      endpoint.kind === 'server'
        ? { ...endpoint, method: 'mab' as const }
        : endpoint,
    )
    const findings = nacFindings(endpoints, SITES)
    const mab = findings.filter((finding) => finding.kind === 'mab-only')
    expect(mab.length).toBeGreaterThan(0)
    expect(mab.every((finding) => finding.severity === 'critical')).toBe(true)
  })
})

describe('nacSummary', () => {
  it('partitions methods and kinds and scores compliance', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED)
    const summary = nacSummary(endpoints)
    expect(summary.endpoints).toBe(endpoints.length)
    const methodTotal = Object.values(summary.byMethod).reduce(
      (sum, count) => sum + count,
      0,
    )
    const kindTotal = Object.values(summary.byKind).reduce(
      (sum, count) => sum + count,
      0,
    )
    expect(methodTotal).toBe(endpoints.length)
    expect(kindTotal).toBe(endpoints.length)
    expect(summary.compliancePct).toBeGreaterThanOrEqual(0)
    expect(summary.compliancePct).toBeLessThanOrEqual(100)
    expect(summary.eapTlsPct).toBeGreaterThanOrEqual(0)
    expect(summary.eapTlsPct).toBeLessThanOrEqual(100)
    expect(summary.authFailures).toBeGreaterThanOrEqual(0)
  })

  it('returns zeroes for an empty estate', () => {
    expect(nacSummary([])).toEqual({
      endpoints: 0,
      compliant: 0,
      compliancePct: 100,
      quarantined: 0,
      authFailures: 0,
      eapTlsPct: 0,
      byMethod: { 'eap-tls': 0, peap: 0, mab: 0, guest: 0 },
      byKind: { laptop: 0, phone: 0, printer: 0, camera: 0, iot: 0, server: 0 },
    })
  })
})

describe('postureBreakdown', () => {
  it('scores every check between 0 and 100 excluding guests', () => {
    const endpoints = generateEndpoints(DEVICES, SITES, SEED)
    const breakdown = postureBreakdown(endpoints)
    expect(breakdown).toHaveLength(4)
    for (const row of breakdown) {
      expect(row.label.length).toBeGreaterThan(0)
      expect(row.passPct).toBeGreaterThanOrEqual(0)
      expect(row.passPct).toBeLessThanOrEqual(100)
    }
  })
})

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

describe('runNac', () => {
  it('overlays quarantines into posture, findings and summary', () => {
    const base = runNac(DEVICES, SITES, SEED)
    const target = base.endpoints.find(
      (endpoint) => endpoint.posture === 'noncompliant',
    )!
    const quarantined = runNac(DEVICES, SITES, SEED, [target.id])
    expect(
      quarantined.endpoints.find((endpoint) => endpoint.id === target.id)
        ?.posture,
    ).toBe('quarantined')
    expect(quarantined.summary.quarantined).toBe(base.summary.quarantined + 1)
    expect(
      quarantined.findings.filter((finding) =>
        finding.id.startsWith(target.id),
      ),
    ).toHaveLength(0)
    expect(quarantined.summary.compliant).toBe(base.summary.compliant)
  })

  it('is deterministic per seed and differs across seeds', () => {
    const a = runNac(DEVICES, SITES, SEED)
    const b = runNac(DEVICES, SITES, SEED)
    const other = runNac(DEVICES, SITES, SEED + 3)
    expect(a).toEqual(b)
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(other))
  })

  it('ties findings back to generated endpoints', () => {
    const result = runNac(DEVICES, SITES, SEED)
    const ids = new Set(result.endpoints.map((endpoint) => endpoint.id))
    for (const finding of result.findings) {
      const endpointId = finding.id.split(':')[0]!
      if (finding.kind !== 'guest-overstay') {
        expect(ids.has(endpointId)).toBe(true)
      }
      expect(SITES).toContain(finding.site)
    }
  })
})
