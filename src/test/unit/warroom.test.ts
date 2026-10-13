import { describe, expect, it } from 'vitest'
import type { Device, Incident, TimelineEvent } from '@/types'
import {
  buildCausalChain,
  buildIncidentRoom,
  type IncidentNote,
} from '@/lib/warroom'

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

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    title: 'App Server down',
    description: '',
    severity: 'critical',
    status: 'open',
    deviceIds: ['srv'],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'e1',
    timestamp: 1500,
    type: 'status',
    message: 'status changed',
    ...overrides,
  }
}

// HQ core/router feeds DC-A firewall which feeds the switch + server.
const DEVICES: Device[] = [
  device({ id: 'core', name: 'Core Router', type: 'router', site: 'HQ' }),
  device({ id: 'fw', name: 'DC Firewall', type: 'firewall', site: 'DC-A' }),
  device({ id: 'sw', name: 'DC Switch', type: 'switch', site: 'DC-A' }),
  device({
    id: 'srv',
    name: 'App Server',
    type: 'server',
    site: 'DC-A',
    status: 'offline',
  }),
]

describe('buildCausalChain', () => {
  it('merges events and notes in chronological order', () => {
    const notes: IncidentNote[] = [
      {
        id: 'n1',
        incidentId: 'i1',
        at: 1200,
        author: 'You',
        body: 'Investigating',
      },
    ]
    const chain = buildCausalChain({
      incident: incident(),
      events: [event({ id: 'late', timestamp: 1600 })],
      notes,
      now: 2000,
    })
    expect(chain.map((entry) => entry.at)).toEqual([1200, 1600])
    expect(chain[0].kind).toBe('note')
  })

  it('includes events touching an affected device outside the window', () => {
    const chain = buildCausalChain({
      incident: incident({ deviceIds: ['srv'] }),
      events: [
        event({ id: 'dev', timestamp: 50, deviceId: 'srv' }),
        event({ id: 'other', timestamp: 50, deviceId: 'unrelated' }),
      ],
      notes: [],
      now: 2000,
    })
    expect(chain.map((entry) => entry.id)).toEqual(['evt-dev'])
  })

  it('excludes notes for other incidents', () => {
    const chain = buildCausalChain({
      incident: incident(),
      events: [],
      notes: [
        { id: 'n1', incidentId: 'i2', at: 1300, author: 'You', body: 'x' },
      ],
      now: 2000,
    })
    expect(chain).toHaveLength(0)
  })
})

describe('buildIncidentRoom', () => {
  it('assembles runbook, impact and causal chain', () => {
    const room = buildIncidentRoom({
      incident: incident(),
      devices: DEVICES,
      events: [event({ id: 'e', timestamp: 1100 })],
      history: {},
      faults: [],
      notes: [],
      now: 5000,
    })
    expect(room.incident.id).toBe('i1')
    expect(room.runbook.id).toBe('offline')
    expect(room.impactedDevices.map((d) => d.id)).toEqual(['srv'])
    expect(room.causalChain).toHaveLength(1)
    expect(room.report.metrics.deviceCount).toBe(1)
    expect(room.ageMs).toBe(4000)
  })

  it('computes a blast radius excluding affected devices', () => {
    const room = buildIncidentRoom({
      incident: incident(),
      devices: DEVICES,
      events: [],
      history: {},
      faults: [],
      notes: [],
      now: 5000,
    })
    const ids = room.blastRadius.map((d) => d.id)
    expect(ids).not.toContain('srv')
    expect(room.rootCauses.length).toBeGreaterThan(0)
  })
})
