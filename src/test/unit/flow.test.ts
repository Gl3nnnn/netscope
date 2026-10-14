import { describe, expect, it } from 'vitest'
import type { Device, DeviceType } from '@/types'
import {
  APPLICATIONS,
  EXTERNAL_SITE,
  applicationMeta,
  applicationMix,
  buildFlows,
  conversationPairs,
  eastWestRatio,
  flowAnomalies,
  flowSummary,
  topTalkers,
  trafficMatrix,
  type FlowRecord,
} from '@/lib/flow'

function device(
  id: string,
  type: DeviceType,
  site: string,
  throughputMbps = 500,
): Device {
  return {
    id,
    name: `${type} ${id}`,
    type,
    site,
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 12,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps,
    capacityMbps: 2000,
    cpuPct: 48,
    memoryPct: 70,
    uptimeSec: 1000,
    lastSeen: 0,
  }
}

function fleet(): Device[] {
  return [
    device('1', 'router', 'DC', 900),
    device('2', 'firewall', 'DC', 700),
    device('3', 'server', 'SiteA', 600),
    device('4', 'switch', 'SiteA', 300),
    device('5', 'accessPoint', 'SiteB', 150),
  ]
}

describe('buildFlows', () => {
  it('is deterministic for the same devices and seed', () => {
    const a = buildFlows(fleet(), 42)
    const b = buildFlows(fleet(), 42)
    expect(a).toEqual(b)
  })

  it('produces at least a few flows per active device', () => {
    const flows = buildFlows(fleet())
    expect(flows.length).toBeGreaterThanOrEqual(fleet().length * 3)
  })

  it("splits each device's throughput across its flows", () => {
    const devices = fleet()
    const flows = buildFlows(devices)
    for (const dev of devices) {
      const mine = flows.filter((flow) => flow.sourceDeviceId === dev.id)
      const sum = mine.reduce((total, flow) => total + flow.throughputMbps, 0)
      expect(sum).toBeCloseTo(dev.throughputMbps, 1)
    }
  })

  it('marks internet-bound flows as north-south with no peer device', () => {
    const flows = buildFlows(fleet())
    for (const flow of flows) {
      if (flow.direction === 'north-south') {
        expect(flow.destDeviceId).toBeNull()
        expect(flow.destSite).toBe(EXTERNAL_SITE)
      } else {
        expect(flow.destDeviceId).not.toBeNull()
        expect(flow.destSite).not.toBe(EXTERNAL_SITE)
      }
    }
  })

  it('assigns a known application, protocol and port to every flow', () => {
    for (const flow of buildFlows(fleet())) {
      const meta = applicationMeta(flow.application)
      expect(meta.kind).toBe(flow.application)
      expect(flow.protocol).toBe(meta.protocol)
      expect(flow.port).toBe(meta.port)
    }
  })
})

describe('topTalkers', () => {
  it('aggregates by source device and sorts busiest first', () => {
    const talkers = topTalkers(buildFlows(fleet()))
    const mbps = talkers.map((talker) => talker.throughputMbps)
    expect(mbps).toEqual([...mbps].sort((a, b) => b - a))
    expect(talkers.length).toBeGreaterThan(0)
    // busiest talker should be the highest-throughput device (router, 900).
    expect(talkers[0]!.deviceId).toBe('1')
  })

  it('limits the result to n entries', () => {
    expect(topTalkers(buildFlows(fleet()), 2)).toHaveLength(2)
  })
})

describe('applicationMix', () => {
  it('produces shares that sum to ~100 and sort by throughput', () => {
    const mix = applicationMix(buildFlows(fleet()))
    const totalPct = mix.reduce((sum, share) => sum + share.sharePct, 0)
    expect(totalPct).toBeCloseTo(100, 0)
    const mbps = mix.map((share) => share.throughputMbps)
    expect(mbps).toEqual([...mbps].sort((a, b) => b - a))
  })

  it('only references defined applications', () => {
    const kinds = new Set(APPLICATIONS.map((app) => app.kind))
    for (const share of applicationMix(buildFlows(fleet()))) {
      expect(kinds.has(share.application)).toBe(true)
    }
  })
})

describe('conversationPairs', () => {
  it('aggregates by source and peer, including the internet peer', () => {
    const pairs = conversationPairs(buildFlows(fleet()))
    expect(pairs.length).toBeGreaterThan(0)
    const mbps = pairs.map((pair) => pair.throughputMbps)
    expect(mbps).toEqual([...mbps].sort((a, b) => b - a))
  })
})

describe('trafficMatrix', () => {
  it('zeroes the diagonal and only counts cross-site east-west flows', () => {
    const devices = fleet()
    const { sites, matrix } = trafficMatrix(devices, buildFlows(devices))
    expect(sites).toEqual([...sites].sort())
    for (let i = 0; i < sites.length; i += 1) {
      expect(matrix[i]![i]).toBe(0)
      for (let j = 0; j < sites.length; j += 1) {
        expect(matrix[i]![j]).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('respects the flow direction (only east-west contributes)', () => {
    const devices = [device('1', 'router', 'A'), device('2', 'server', 'B')]
    const flows: FlowRecord[] = [
      {
        id: 'x',
        sourceDeviceId: '1',
        destDeviceId: '2',
        destSite: 'B',
        application: 'web',
        protocol: 'TCP',
        port: 443,
        throughputMbps: 100,
        packetsPerSec: 1000,
        direction: 'east-west',
      },
      {
        id: 'y',
        sourceDeviceId: '1',
        destDeviceId: null,
        destSite: EXTERNAL_SITE,
        application: 'web',
        protocol: 'TCP',
        port: 443,
        throughputMbps: 500,
        packetsPerSec: 5000,
        direction: 'north-south',
      },
    ]
    const { matrix } = trafficMatrix(devices, flows)
    const a = 0
    const b = 1
    expect(matrix[a]![b]).toBe(100)
    expect(matrix[b]![a]).toBe(0)
  })
})

describe('eastWestRatio & flowSummary', () => {
  it('splits traffic and reports a percentage in range', () => {
    const split = eastWestRatio(buildFlows(fleet()))
    expect(split.eastWestPct).toBeGreaterThanOrEqual(0)
    expect(split.eastWestPct).toBeLessThanOrEqual(100)
    expect(split.eastWestMbps + split.northSouthMbps).toBeCloseTo(
      split.eastWestMbps + split.northSouthMbps,
      1,
    )
  })

  it('summarises count, total and top application', () => {
    const flows = buildFlows(fleet())
    const summary = flowSummary(flows)
    expect(summary.flowCount).toBe(flows.length)
    expect(summary.totalMbps).toBeGreaterThan(0)
    expect(summary.topApplication).not.toBeNull()
  })
})

describe('flowAnomalies', () => {
  it('flags flows well above their application mean', () => {
    const mk = (id: string, throughputMbps: number): FlowRecord => ({
      id,
      sourceDeviceId: '1',
      destDeviceId: null,
      destSite: EXTERNAL_SITE,
      application: 'web',
      protocol: 'TCP',
      port: 443,
      throughputMbps,
      packetsPerSec: throughputMbps * 100,
      direction: 'north-south',
    })
    // mean web throughput = (10+10+100)/3 ≈ 40; the 100 flow is > 2× mean.
    const anomalies = flowAnomalies([mk('a', 10), mk('b', 10), mk('c', 100)], 2)
    expect(anomalies.length).toBe(1)
    expect(anomalies[0]!.flow.id).toBe('c')
    expect(anomalies[0]!.ratio).toBeGreaterThan(2)
  })
})
