import { describe, expect, it } from 'vitest'
import type { Device, Incident, MetricSample } from '@/types'
import {
  computeSla,
  deviceUptimePct,
  fleetUptimePct,
  incidentsBySeverity,
  meanTimeToAcknowledge,
  meanTimeToResolve,
  siteSla,
} from '@/lib/sla'

const makeIncident = (over: Partial<Incident>): Incident => ({
  id: 'i1',
  title: 'Test incident',
  description: '',
  severity: 'medium',
  status: 'open',
  deviceIds: [],
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
})

const makeDevice = (
  over: Partial<Device> & Pick<Device, 'id' | 'site'>,
): Device => ({
  name: 'Device',
  type: 'router',
  ip: '10.0.0.1',
  mac: '00:00:00:00:00:01',
  status: 'online',
  tags: [],
  latencyMs: 5,
  packetLossPct: 0,
  availabilityPct: 99,
  throughputMbps: 100,
  capacityMbps: 1000,
  cpuPct: 10,
  memoryPct: 20,
  uptimeSec: 3600,
  lastSeen: 0,
  ...over,
})

const samples = (...availability: number[]): MetricSample[] =>
  availability.map((value, index) => ({
    t: index,
    latencyMs: 1,
    packetLossPct: 0,
    availabilityPct: value,
    throughputMbps: 1,
    cpuPct: 1,
    memoryPct: 1,
  }))

describe('meanTimeToAcknowledge', () => {
  it('averages only acknowledged incidents', () => {
    const incidents = [
      makeIncident({ id: 'a', createdAt: 1000, acknowledgedAt: 5000 }),
      makeIncident({ id: 'b', createdAt: 2000, acknowledgedAt: 8000 }),
      makeIncident({ id: 'c', createdAt: 0 }),
    ]
    expect(meanTimeToAcknowledge(incidents)).toBe(5000)
  })

  it('returns null when nothing was acknowledged', () => {
    expect(meanTimeToAcknowledge([makeIncident({})])).toBeNull()
  })
})

describe('meanTimeToResolve', () => {
  it('averages resolved incidents', () => {
    const incidents = [
      makeIncident({ id: 'a', createdAt: 1000, resolvedAt: 3000 }),
      makeIncident({ id: 'b', createdAt: 1000, resolvedAt: 7000 }),
    ]
    expect(meanTimeToResolve(incidents)).toBe(4000)
  })

  it('ignores negative durations defensively', () => {
    const incidents = [
      makeIncident({ id: 'a', createdAt: 5000, resolvedAt: 1000 }),
    ]
    expect(meanTimeToResolve(incidents)).toBe(0)
  })
})

describe('incidentsBySeverity', () => {
  it('counts incidents per severity', () => {
    const incidents = [
      makeIncident({ id: 'a', severity: 'critical' }),
      makeIncident({ id: 'b', severity: 'critical' }),
      makeIncident({ id: 'c', severity: 'low' }),
    ]
    expect(incidentsBySeverity(incidents)).toEqual({
      critical: 2,
      high: 0,
      medium: 0,
      low: 1,
    })
  })
})

describe('deviceUptimePct', () => {
  it('prefers historical samples when present', () => {
    const device = makeDevice({ id: 'd', site: 'X', availabilityPct: 99 })
    expect(deviceUptimePct(device, samples(90, 100))).toBe(95)
  })

  it('falls back to the live value without history', () => {
    const device = makeDevice({ id: 'd', site: 'X', availabilityPct: 97.5 })
    expect(deviceUptimePct(device)).toBe(97.5)
  })
})

describe('fleetUptimePct', () => {
  it('averages per-device uptime and handles an empty fleet', () => {
    const a = makeDevice({ id: 'a', site: 'X' })
    const b = makeDevice({ id: 'b', site: 'Y' })
    const uptime = fleetUptimePct([a, b], {
      a: samples(90),
      b: samples(100),
    })
    expect(uptime).toBe(95)
    expect(fleetUptimePct([], {})).toBe(0)
  })
})

describe('siteSla', () => {
  it('counts distinct incidents per site and sorts by uptime ascending', () => {
    const a = makeDevice({ id: 'a', site: 'Alpha' })
    const b = makeDevice({ id: 'b', site: 'Alpha' })
    const c = makeDevice({ id: 'c', site: 'Beta' })
    const incidents = [
      makeIncident({ id: 'i1', deviceIds: ['a', 'b'] }),
      makeIncident({ id: 'i2', deviceIds: ['a', 'c'] }),
    ]
    const result = siteSla([a, b, c], incidents, {
      a: samples(90),
      b: samples(90),
      c: samples(100),
    })
    expect(result).toEqual([
      { site: 'Alpha', devices: 2, incidents: 2, uptimePct: 90 },
      { site: 'Beta', devices: 1, incidents: 1, uptimePct: 100 },
    ])
  })
})

describe('computeSla', () => {
  it('summarises uptime, timings and incident counts', () => {
    const a = makeDevice({ id: 'a', site: 'X' })
    const incidents = [
      makeIncident({
        id: 'i1',
        status: 'resolved',
        severity: 'high',
        deviceIds: ['a'],
        createdAt: 1000,
        acknowledgedAt: 3000,
        resolvedAt: 9000,
      }),
      makeIncident({ id: 'i2', status: 'open', severity: 'critical' }),
    ]
    const sla = computeSla([a], incidents, { a: samples(100) })
    expect(sla.uptimePct).toBe(100)
    expect(sla.mttaMs).toBe(2000)
    expect(sla.mttrMs).toBe(8000)
    expect(sla.totalIncidents).toBe(2)
    expect(sla.openIncidents).toBe(1)
    expect(sla.resolvedIncidents).toBe(1)
    expect(sla.bySeverity).toEqual({
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
    })
  })
})
