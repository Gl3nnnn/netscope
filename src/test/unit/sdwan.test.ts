import { describe, expect, it } from 'vitest'
import {
  BROWNOUT_JITTER_MS,
  BROWNOUT_LATENCY_MS,
  BROWNOUT_LOSS_PCT,
  CLASS_PATH_PREFERENCE,
  buildTunnels,
  isBrownout,
  pathQuality,
  runSdwan,
  steerFlows,
  type Tunnel,
} from '@/lib/sdwan'
import { classifyFlow } from '@/lib/qos'
import type { Circuit, CircuitKind } from '@/lib/wan'
import type { FlowRecord } from '@/lib/flow'
import type { Device } from '@/types'

function circuit(overrides: Partial<Circuit> & { kind: CircuitKind }): Circuit {
  return {
    id: `ckt-${overrides.kind}`,
    site: 'HQ',
    carrier: 'CarrierA',
    role: 'primary',
    bandwidthMbps: 1000,
    monthlyCostUsd: 1000,
    contractedUptimePct: 99.9,
    measuredUptimePct: 99.95,
    latencyMs: 10,
    jitterMs: 3,
    lossPct: 0.1,
    status: 'up',
    ...overrides,
  }
}

function tunnel(overrides: Partial<Tunnel> & { kind: CircuitKind }): Tunnel {
  const base = buildTunnels([
    circuit({ kind: overrides.kind, id: `ckt-${overrides.kind}` }),
  ])[0]!
  const merged = { ...base, ...overrides }
  // Recompute the flags from the overridden metrics, exactly as buildTunnels
  // would, so fixtures stay consistent with the real engine.
  merged.brownout = isBrownout(
    circuit({
      kind: merged.kind,
      id: merged.circuitId,
      status: merged.status,
      lossPct: merged.lossPct,
      jitterMs: merged.jitterMs,
      latencyMs: merged.latencyMs,
    }),
  )
  return merged
}

function flow(id: string, application: FlowRecord['application']): FlowRecord {
  return {
    id,
    sourceDeviceId: 'dev-1',
    destDeviceId: null,
    destSite: 'Internet',
    application,
    protocol: 'TCP',
    port: 443,
    throughputMbps: 10,
    packetsPerSec: 50,
    direction: 'north-south',
  }
}

function device(id: string, site: string): Device {
  return {
    id,
    name: id,
    type: 'router',
    site,
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:01',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 500,
    capacityMbps: 1000,
    cpuPct: 40,
    memoryPct: 50,
    uptimeSec: 100_000,
    lastSeen: 0,
  }
}

const siteOf = (devices: Device[]) =>
  new Map(devices.map((d) => [d.id, d.site]))

describe('pathQuality', () => {
  it('ranks a clean fast path above a degraded one', () => {
    const clean = pathQuality(circuit({ kind: 'dia' }))
    const dirty = pathQuality(
      circuit({ kind: 'dia', latencyMs: 120, jitterMs: 40, lossPct: 3 }),
    )
    expect(clean).toBeGreaterThan(dirty)
    expect(clean).toBeGreaterThanOrEqual(90)
  })

  it('penalises down and degraded status', () => {
    const up = pathQuality(circuit({ kind: 'dia' }))
    const degraded = pathQuality(circuit({ kind: 'dia', status: 'degraded' }))
    const down = pathQuality(circuit({ kind: 'dia', status: 'down' }))
    expect(degraded).toBeLessThan(up)
    expect(down).toBeLessThan(degraded)
  })

  it('never returns a negative score', () => {
    expect(
      pathQuality(
        circuit({
          kind: 'lte',
          latencyMs: 400,
          jitterMs: 200,
          lossPct: 50,
          status: 'down',
        }),
      ),
    ).toBeGreaterThanOrEqual(0)
  })
})

describe('isBrownout', () => {
  it('breaches on any threshold metric or down status', () => {
    expect(isBrownout(circuit({ kind: 'dia' }))).toBe(false)
    expect(
      isBrownout(circuit({ kind: 'dia', lossPct: BROWNOUT_LOSS_PCT + 0.1 })),
    ).toBe(true)
    expect(
      isBrownout(circuit({ kind: 'dia', jitterMs: BROWNOUT_JITTER_MS + 1 })),
    ).toBe(true)
    expect(
      isBrownout(circuit({ kind: 'dia', latencyMs: BROWNOUT_LATENCY_MS + 1 })),
    ).toBe(true)
    expect(isBrownout(circuit({ kind: 'dia', status: 'down' }))).toBe(true)
    // Exactly at threshold is not a breach (uses >).
    expect(
      isBrownout(circuit({ kind: 'dia', lossPct: BROWNOUT_LOSS_PCT })),
    ).toBe(false)
  })
})

describe('buildTunnels', () => {
  it('maps circuits to tunnels with quality and brownout flags', () => {
    const circuits = [
      circuit({ kind: 'dia', id: 'ckt-a' }),
      circuit({ kind: 'broadband', id: 'ckt-b', lossPct: 5 }),
    ]
    const tunnels = buildTunnels(circuits)
    expect(tunnels).toHaveLength(2)
    expect(tunnels[0]!.id).toBe('tun-ckt-a')
    expect(tunnels[0]!.brownout).toBe(false)
    expect(tunnels[1]!.brownout).toBe(true)
    expect(tunnels[1]!.quality).toBeLessThan(tunnels[0]!.quality)
  })
})

describe('CLASS_PATH_PREFERENCE', () => {
  it('covers every traffic class with a full kind ordering', () => {
    const classes = [
      'realtime',
      'interactive',
      'transactional',
      'bulk',
      'best-effort',
    ] as const
    for (const trafficClass of classes) {
      const order = CLASS_PATH_PREFERENCE[trafficClass]
      expect(order).toHaveLength(4)
      expect(new Set(order).size).toBe(4)
    }
    expect(CLASS_PATH_PREFERENCE.realtime[0]).toBe('mpls')
    expect(CLASS_PATH_PREFERENCE.bulk[0]).toBe('broadband')
    expect(CLASS_PATH_PREFERENCE.interactive[0]).toBe('dia')
  })
})

describe('steerFlows', () => {
  const devices = [device('dev-1', 'HQ')]
  const map = siteOf(devices)

  it('steers realtime traffic onto its preferred healthy path', () => {
    const tunnels = [
      tunnel({ kind: 'mpls', id: 't1' }),
      tunnel({ kind: 'broadband', id: 't2' }),
    ]
    const [decision] = steerFlows(tunnels, [flow('f1', 'voip')], map)
    expect(decision!.pathKind).toBe('mpls')
    expect(decision!.failedOver).toBe(false)
    expect(decision!.reason).toBe('on-preference')
    expect(decision!.class).toBe('realtime')
    expect(decision!.class).toBe(classifyFlow(flow('f1', 'voip')))
  })

  it('fails over when the preferred path is in brownout', () => {
    const tunnels = [
      tunnel({ kind: 'mpls', id: 't1', lossPct: BROWNOUT_LOSS_PCT + 1 }),
      tunnel({ kind: 'broadband', id: 't2' }),
    ]
    const [decision] = steerFlows(tunnels, [flow('f1', 'voip')], map)
    expect(decision!.pathKind).toBe('broadband')
    expect(decision!.failedOver).toBe(true)
    expect(decision!.reason).toBe('preferred-brownout')
  })

  it('still steers when every path is brownout but up', () => {
    const tunnels = [
      tunnel({ kind: 'mpls', id: 't1', lossPct: 9 }),
      tunnel({ kind: 'broadband', id: 't2', jitterMs: 99 }),
    ]
    const [decision] = steerFlows(tunnels, [flow('f1', 'voip')], map)
    expect(decision!.pathId).not.toBeNull()
    expect(decision!.failedOver).toBe(true)
    expect(decision!.reason).toBe('all-paths-brownout')
  })

  it('returns no-path for sites without tunnels', () => {
    const [decision] = steerFlows([], [flow('f1', 'web')], map)
    expect(decision!.pathId).toBeNull()
    expect(decision!.failedOver).toBe(true)
    expect(decision!.reason).toBe('no-path')
  })

  it('ignores down tunnels when choosing a path', () => {
    const tunnels = [
      tunnel({ kind: 'mpls', id: 't1', status: 'down' }),
      tunnel({ kind: 'broadband', id: 't2' }),
    ]
    const [decision] = steerFlows(tunnels, [flow('f1', 'voip')], map)
    expect(decision!.pathKind).toBe('broadband')
  })

  it('prefers broadband for bulk transfers', () => {
    const tunnels = [
      tunnel({ kind: 'dia', id: 't1' }),
      tunnel({ kind: 'broadband', id: 't2' }),
    ]
    const [decision] = steerFlows(tunnels, [flow('f1', 'backup')], map)
    expect(decision!.pathKind).toBe('broadband')
    expect(decision!.class).toBe('bulk')
  })

  it('is deterministic', () => {
    const tunnels = [tunnel({ kind: 'dia', id: 't1' })]
    const flows = [flow('f1', 'web'), flow('f2', 'ssh')]
    expect(steerFlows(tunnels, flows, map)).toEqual(
      steerFlows(tunnels, flows, map),
    )
  })
})

describe('runSdwan', () => {
  const devices = [device('dev-1', 'HQ'), device('dev-2', 'Branch-1')]
  const flows = [
    flow('f1', 'voip'),
    flow('f2', 'backup'),
    { ...flow('f3', 'web'), sourceDeviceId: 'dev-2' },
  ]

  it('is deterministic for identical inputs', () => {
    const input = { devices, flows, seed: 42 }
    expect(runSdwan(input)).toEqual(runSdwan(input))
  })

  it('keeps summary counts consistent', () => {
    const result = runSdwan({ devices, flows, seed: 42 })
    const { summary } = result
    expect(summary.tunnels).toBe(result.tunnels.length)
    expect(summary.flows).toBe(flows.length)
    expect(summary.steered).toBeLessThanOrEqual(summary.flows)
    expect(summary.failedOver).toBeLessThanOrEqual(summary.flows)
    expect(summary.brownouts).toBe(
      result.tunnels.filter((tunnel_) => tunnel_.brownout).length,
    )
    expect(summary.sites).toBeGreaterThan(0)
    expect(summary.sitesWithFailover).toBeLessThanOrEqual(summary.sites)
    if (summary.flows > 0) {
      expect(summary.steeredPct).toBeCloseTo(
        (summary.steered / summary.flows) * 100,
        1,
      )
    }
  })

  it('emits one brownout event per browned-out tunnel', () => {
    const result = runSdwan({ devices, flows, seed: 42 })
    expect(result.events).toHaveLength(result.summary.brownouts)
    for (const event of result.events) {
      expect(event.id).toMatch(/^evt-/)
      expect(event.reason).toBe('brownout')
    }
  })

  it('handles an empty fleet', () => {
    const result = runSdwan({ devices: [], flows: [] })
    expect(result.tunnels).toEqual([])
    expect(result.decisions).toEqual([])
    expect(result.summary.flows).toBe(0)
    expect(result.summary.steeredPct).toBe(0)
  })
})
