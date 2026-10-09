import { beforeEach, describe, expect, it } from 'vitest'
import { useNetworkStore } from '../../store/useNetworkStore'
import type { Incident } from '../../types'

const incident = (): Incident => ({
  id: 'inc_test',
  title: 'Test incident',
  description: 'A test incident',
  severity: 'high',
  status: 'open',
  deviceIds: ['dev_001'],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
})

describe('useNetworkStore', () => {
  beforeEach(() => {
    useNetworkStore.getState().resetDemo()
  })

  it('seeds 24 demo devices on reset', () => {
    const { devices, history } = useNetworkStore.getState()
    expect(devices).toHaveLength(24)
    expect(Object.keys(history)).toHaveLength(24)
  })

  it('adds a device and initialises its history bucket', () => {
    const before = useNetworkStore.getState().devices.length
    const device = useNetworkStore.getState().addDevice({
      name: 'test-rtr',
      type: 'router',
      site: 'Lab',
      ip: '10.9.9.9',
      mac: 'AA:BB:CC:DD:EE:01',
      tags: ['lab'],
    })
    const state = useNetworkStore.getState()
    expect(state.devices).toHaveLength(before + 1)
    expect(state.devices.find((d) => d.id === device.id)?.name).toBe('test-rtr')
    expect(state.history[device.id]).toEqual([])
  })

  it('updates a device', () => {
    const id = useNetworkStore.getState().devices[0].id
    useNetworkStore.getState().updateDevice(id, { name: 'renamed' })
    expect(
      useNetworkStore.getState().devices.find((d) => d.id === id)?.name,
    ).toBe('renamed')
  })

  it('deletes a device and its history', () => {
    const id = useNetworkStore.getState().devices[0].id
    useNetworkStore.getState().deleteDevice(id)
    const state = useNetworkStore.getState()
    expect(state.devices.find((d) => d.id === id)).toBeUndefined()
    expect(state.history[id]).toBeUndefined()
  })

  it('imports devices in replace mode', () => {
    useNetworkStore.getState().importDevices(
      [
        {
          ...useNetworkStore.getState().devices[0],
          id: 'imported_1',
          name: 'imported',
        },
      ],
      'replace',
    )
    const state = useNetworkStore.getState()
    expect(state.devices).toHaveLength(1)
    expect(state.devices[0].id).toBe('imported_1')
  })

  it('acknowledges and resolves an incident', () => {
    useNetworkStore.setState({ incidents: [incident()] })
    useNetworkStore.getState().acknowledgeIncident('inc_test')
    expect(useNetworkStore.getState().incidents[0].status).toBe('acknowledged')

    useNetworkStore.getState().resolveIncident('inc_test')
    expect(useNetworkStore.getState().incidents[0].status).toBe('resolved')
  })

  it('ignores acknowledging an already resolved incident', () => {
    useNetworkStore.setState({
      incidents: [{ ...incident(), status: 'resolved' }],
    })
    useNetworkStore.getState().acknowledgeIncident('inc_test')
    expect(useNetworkStore.getState().incidents[0].status).toBe('resolved')
  })

  it('exports devices as valid JSON', () => {
    const json = useNetworkStore.getState().exportDevices()
    const parsed = JSON.parse(json) as { devices: unknown[] }
    expect(parsed.devices).toHaveLength(24)
  })
})
