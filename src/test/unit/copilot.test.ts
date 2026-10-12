import { describe, expect, it } from 'vitest'
import type { Device, Incident, Thresholds } from '@/types'
import { answerQuestion, type CopilotContext } from '@/lib/copilot'

const THRESHOLDS: Thresholds = {
  latencyMs: 120,
  packetLossPct: 1,
  availabilityPct: 99,
}

function device(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    name: 'Device 1',
    type: 'server',
    site: 'HQ',
    ip: '10.0.0.1',
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 10,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 10,
    memoryPct: 20,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

const DEVICES: Device[] = [
  device({
    id: 'core',
    name: 'Core Router',
    type: 'router',
    site: 'HQ',
    latencyMs: 5,
  }),
  device({
    id: 'edge',
    name: 'Edge Switch',
    type: 'switch',
    site: 'DC-A',
    latencyMs: 8,
  }),
  device({
    id: 'fw',
    name: 'Edge Firewall',
    type: 'firewall',
    site: 'DC-A',
    status: 'degraded',
    latencyMs: 90,
    cpuPct: 95,
    throughputMbps: 950,
  }),
  device({
    id: 'srv',
    name: 'App Server',
    type: 'server',
    site: 'DC-A',
    status: 'offline',
    latencyMs: 300,
    availabilityPct: 90,
  }),
]

const INCIDENTS: Incident[] = [
  {
    id: 'i1',
    title: 'App Server down',
    description: '',
    severity: 'critical',
    status: 'open',
    deviceIds: ['srv'],
    createdAt: 1000,
    updatedAt: 1000,
  },
]

const CONTEXT: CopilotContext = {
  devices: DEVICES,
  incidents: INCIDENTS,
  thresholds: THRESHOLDS,
  now: 5000,
}

describe('ask / help', () => {
  it('returns help for an empty question', () => {
    expect(answerQuestion('', CONTEXT).intent).toBe('help')
  })

  it('returns help for an explicit help request', () => {
    expect(answerQuestion('help', CONTEXT).intent).toBe('help')
  })
})

describe('fleet status', () => {
  it('summarises fleet health for a status question', () => {
    const answer = answerQuestion('How is the fleet doing?', CONTEXT)
    expect(answer.intent).toBe('fleet-status')
    expect(answer.summary).toMatch(/health/i)
    expect(answer.devices?.map((d) => d.id)).toContain('srv')
  })
})

describe('device status', () => {
  it('reports a named device', () => {
    const answer = answerQuestion('how is the Core Router', CONTEXT)
    expect(answer.intent).toBe('device-status')
    expect(answer.title).toBe('Core Router')
    expect(answer.links?.[0]?.to).toBe('/devices/core')
  })

  it('surfaces open incidents for the device', () => {
    const answer = answerQuestion('tell me about App Server', CONTEXT)
    expect(answer.intent).toBe('device-status')
    expect(answer.bullets.join(' ')).toMatch(/incident/i)
  })
})

describe('site status', () => {
  it('summarises a site', () => {
    const answer = answerQuestion('tell me about DC-A', CONTEXT)
    expect(answer.intent).toBe('site-status')
    expect(answer.title).toBe('Site DC-A')
  })
})

describe('counts', () => {
  it('counts offline devices', () => {
    const answer = answerQuestion('how many devices are offline?', CONTEXT)
    expect(answer.intent).toBe('count-status')
    expect(answer.summary).toContain('1')
  })
})

describe('ranking', () => {
  it('ranks the worst devices by health', () => {
    const answer = answerQuestion('which devices are the worst', CONTEXT)
    expect(answer.intent).toBe('rank-devices')
    expect(answer.devices?.[0]?.id).toBe('srv')
  })

  it('ranks the top slowest devices by latency', () => {
    const answer = answerQuestion('top 2 slowest devices', CONTEXT)
    expect(answer.intent).toBe('rank-devices')
    expect(answer.devices?.[0]?.id).toBe('srv')
    expect(answer.devices).toHaveLength(2)
  })
})

describe('incidents', () => {
  it('lists open incidents', () => {
    const answer = answerQuestion('what incidents are open', CONTEXT)
    expect(answer.intent).toBe('incidents')
    expect(answer.summary).toMatch(/1 open incident/)
  })
})

describe('capacity', () => {
  it('flags near-capacity devices', () => {
    const answer = answerQuestion('which devices are near capacity', CONTEXT)
    expect(answer.intent).toBe('capacity')
    expect(answer.devices?.map((d) => d.id)).toContain('fw')
  })
})

describe('route', () => {
  it('traces a route between two named devices', () => {
    const answer = answerQuestion(
      'how do I get from Core Router to App Server',
      CONTEXT,
    )
    expect(answer.intent).toBe('route')
    expect(answer.title).toBe('Core Router → App Server')
    expect(answer.summary).toMatch(/path status/i)
  })

  it('asks for clarification when an endpoint is unknown', () => {
    const answer = answerQuestion('route from Core Router to Nowhere', CONTEXT)
    expect(answer.intent).toBe('route')
    expect(answer.summary).toMatch(/couldn't match/i)
  })
})

describe('slo', () => {
  it('reports uptime against target', () => {
    const answer = answerQuestion("what's our uptime", CONTEXT)
    expect(answer.intent).toBe('slo')
    expect(answer.summary).toMatch(/availability/i)
  })
})

describe('fallback', () => {
  it('returns a helpful prompt for an unknown question', () => {
    const answer = answerQuestion('banana', CONTEXT)
    expect(answer.intent).toBe('unknown')
    expect(answer.bullets.length).toBeGreaterThan(1)
  })
})
