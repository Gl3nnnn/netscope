import { beforeEach, describe, expect, it } from 'vitest'
import { useNetworkStore } from '../../store/useNetworkStore'
import type { Device, FaultInjection, Incident } from '../../types'
import {
  RUNBOOKS,
  matchRunbook,
  runbookForIncident,
  signalsForDevices,
} from '../../lib/runbooks'

const baseDevice = (id: string, patch: Partial<Device> = {}): Device => ({
  id,
  name: id,
  type: 'server',
  site: 'HQ',
  ip: '10.0.0.1',
  mac: 'aa:bb:cc:dd:ee:ff',
  status: 'online',
  tags: [],
  latencyMs: 5,
  packetLossPct: 0,
  availabilityPct: 100,
  throughputMbps: 100,
  capacityMbps: 1000,
  cpuPct: 10,
  memoryPct: 20,
  uptimeSec: 100,
  lastSeen: 0,
  ...patch,
})

const fault = (patch: Partial<FaultInjection>): FaultInjection => ({
  id: 'fault_1',
  kind: 'saturate',
  target: 'dev_1',
  appliedAt: 0,
  expiresAt: null,
  ...patch,
})

const baseIncident: Incident = {
  id: 'inc_1',
  title: 'Test',
  description: 'Test',
  severity: 'high',
  status: 'open',
  deviceIds: ['dev_1'],
  createdAt: 0,
  updatedAt: 0,
}

describe('matchRunbook', () => {
  it('prioritises offline over everything', () => {
    expect(
      matchRunbook({ offline: true, saturation: true, degraded: true }).id,
    ).toBe('offline')
  })

  it('prefers saturation over degraded', () => {
    expect(
      matchRunbook({ offline: false, saturation: true, degraded: true }).id,
    ).toBe('saturation')
  })

  it('falls back to investigate', () => {
    expect(
      matchRunbook({ offline: false, saturation: false, degraded: false }).id,
    ).toBe('investigate')
  })

  it('exposes steps for every runbook', () => {
    for (const runbook of Object.values(RUNBOOKS)) {
      expect(runbook.steps.length).toBeGreaterThan(0)
    }
  })
})

describe('signalsForDevices', () => {
  it('detects an offline device', () => {
    expect(
      signalsForDevices([baseDevice('dev_1', { status: 'offline' })]),
    ).toMatchObject({ offline: true })
  })

  it('detects high utilisation as saturation', () => {
    const signals = signalsForDevices([
      baseDevice('dev_1', { throughputMbps: 900, capacityMbps: 1000 }),
    ])
    expect(signals).toMatchObject({ saturation: true, offline: false })
  })

  it('detects a degraded device', () => {
    expect(
      signalsForDevices([baseDevice('dev_1', { status: 'degraded' })]),
    ).toMatchObject({ degraded: true, offline: false, saturation: false })
  })

  it('honours an active saturation fault', () => {
    const signals = signalsForDevices(
      [baseDevice('dev_1')],
      [fault({ kind: 'saturate', target: 'dev_1' })],
      0,
    )
    expect(signals.saturation).toBe(true)
  })

  it('honours an active device-offline fault', () => {
    const signals = signalsForDevices(
      [baseDevice('dev_1')],
      [fault({ kind: 'device-offline', target: 'dev_1' })],
      0,
    )
    expect(signals.offline).toBe(true)
  })

  it('ignores expired faults', () => {
    const signals = signalsForDevices(
      [baseDevice('dev_1')],
      [fault({ kind: 'device-offline', target: 'dev_1', expiresAt: 5 })],
      10,
    )
    expect(signals.offline).toBe(false)
  })
})

describe('runbookForIncident', () => {
  it('only inspects the incident devices', () => {
    const runbook = runbookForIncident({
      incident: baseIncident,
      devices: [
        baseDevice('dev_1', { status: 'degraded' }),
        baseDevice('dev_2', { status: 'offline' }),
      ],
    })
    expect(runbook.id).toBe('degraded')
  })

  it('selects offline for an impacted offline device', () => {
    const runbook = runbookForIncident({
      incident: { ...baseIncident, deviceIds: ['dev_2'] },
      devices: [baseDevice('dev_2', { status: 'offline' })],
    })
    expect(runbook.id).toBe('offline')
  })

  it('falls back to investigate when the incident has no devices', () => {
    const runbook = runbookForIncident({
      incident: { ...baseIncident, deviceIds: [] },
      devices: [baseDevice('dev_1', { status: 'offline' })],
    })
    expect(runbook.id).toBe('investigate')
  })
})

describe('runRemediation', () => {
  beforeEach(() => {
    useNetworkStore.getState().resetDemo()
  })

  it('recovers devices, clears faults and resolves the incident', () => {
    const id = useNetworkStore.getState().devices[0].id
    const now = Date.now()

    useNetworkStore.setState((state) => ({
      devices: state.devices.map((device) =>
        device.id === id && device
          ? { ...device, status: 'offline', latencyMs: 500 }
          : device,
      ),
      incidents: [
        {
          id: 'inc_remed',
          title: 'Offline host',
          description: 'down',
          severity: 'high',
          status: 'open',
          deviceIds: [id],
          createdAt: now,
          updatedAt: now,
        },
      ],
    }))
    useNetworkStore.getState().injectFault('device-offline', id)

    useNetworkStore.getState().runRemediation('inc_remed')

    const state = useNetworkStore.getState()
    expect(state.devices.find((device) => device.id === id)?.status).toBe(
      'online',
    )
    expect(state.faults).toHaveLength(0)
    expect(state.incidents.find((i) => i.id === 'inc_remed')?.status).toBe(
      'resolved',
    )
  })

  it('is a no-op for an unknown incident', () => {
    const before = useNetworkStore.getState().devices
    useNetworkStore.getState().runRemediation('missing')
    expect(useNetworkStore.getState().devices).toBe(before)
  })
})
