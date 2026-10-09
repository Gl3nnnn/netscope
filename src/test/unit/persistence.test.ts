import { describe, expect, it } from 'vitest'
import {
  coerceDevices,
  exportDevicesJson,
  exportFullState,
  isValidDeviceType,
  isValidIp,
  isValidMac,
  isValidPersistedState,
  migratePersistedNetwork,
  parseDeviceImport,
  parseFullState,
  STORAGE_VERSION,
} from '../../storage/persistence'
import { DEFAULT_SETTINGS } from '../../store/useSettingsStore'
import { buildSeedDevices } from '../../simulation/seed'
import { mulberry32 } from '../../simulation/random'

describe('validators', () => {
  it('validates IPv4 addresses', () => {
    expect(isValidIp('10.0.0.1')).toBe(true)
    expect(isValidIp('192.168.1.255')).toBe(true)
    expect(isValidIp('256.1.1.1')).toBe(false)
    expect(isValidIp('not-an-ip')).toBe(false)
  })

  it('validates MAC addresses', () => {
    expect(isValidMac('AA:BB:CC:DD:EE:FF')).toBe(true)
    expect(isValidMac('aa-bb-cc-dd-ee-ff')).toBe(true)
    expect(isValidMac('ZZ:BB:CC:DD:EE:FF')).toBe(false)
  })

  it('validates device types', () => {
    expect(isValidDeviceType('router')).toBe(true)
    expect(isValidDeviceType('toaster')).toBe(false)
    expect(isValidDeviceType(42)).toBe(false)
  })
})

describe('parseDeviceImport', () => {
  it('accepts a JSON array of devices', () => {
    const result = parseDeviceImport(
      JSON.stringify([{ name: 'rtr-1', type: 'router', ip: '10.0.0.1' }]),
    )
    expect(result.ok).toBe(true)
    expect(result.devices).toHaveLength(1)
    expect(result.devices?.[0].site).toBe('Imported')
  })

  it('accepts an object with a devices array', () => {
    const result = parseDeviceImport(
      JSON.stringify({
        devices: [{ name: 'sw-1', type: 'switch', ip: '10.0.0.2' }],
      }),
    )
    expect(result.ok).toBe(true)
    expect(result.devices).toHaveLength(1)
  })

  it('rejects invalid JSON', () => {
    const result = parseDeviceImport('{ not json')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/valid JSON/i)
  })

  it('rejects empty input', () => {
    expect(parseDeviceImport('   ').ok).toBe(false)
  })

  it('rejects missing name', () => {
    const result = parseDeviceImport(
      JSON.stringify([{ type: 'router', ip: '10.0.0.1' }]),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/name/i)
  })

  it('rejects an invalid type', () => {
    const result = parseDeviceImport(
      JSON.stringify([{ name: 'x', type: 'toaster', ip: '10.0.0.1' }]),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/type/i)
  })

  it('rejects an invalid IP', () => {
    const result = parseDeviceImport(
      JSON.stringify([{ name: 'x', type: 'router', ip: '999.1.1.1' }]),
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/ip/i)
  })

  it('rejects an empty devices array', () => {
    expect(parseDeviceImport('[]').ok).toBe(false)
  })

  it('does not partially apply on mixed valid/invalid items', () => {
    const result = parseDeviceImport(
      JSON.stringify([
        { name: 'good', type: 'router', ip: '10.0.0.1' },
        { name: 'bad', type: 'router', ip: 'nope' },
      ]),
    )
    expect(result.ok).toBe(false)
    expect(result.devices).toBeUndefined()
  })

  it('round-trips an export', () => {
    const devices = buildSeedDevices(mulberry32(1), Date.now())
    const json = exportDevicesJson(devices)
    const result = parseDeviceImport(json)
    expect(result.ok).toBe(true)
    expect(result.devices).toHaveLength(devices.length)
  })
})

describe('isValidPersistedState', () => {
  it('accepts a well-formed state', () => {
    expect(
      isValidPersistedState({
        version: 1,
        devices: [],
        incidents: [],
        events: [],
        settings: {},
      }),
    ).toBe(true)
  })

  it('rejects malformed state', () => {
    expect(isValidPersistedState(null)).toBe(false)
    expect(isValidPersistedState({ version: 1, devices: 'nope' })).toBe(false)
  })
})

describe('migratePersistedNetwork', () => {
  it('coerces devices and fills missing optional flags', () => {
    const devices = buildSeedDevices(mulberry32(1), Date.now())
    const migrated = migratePersistedNetwork(
      { devices, incidents: [], events: [] },
      1,
    )
    expect(migrated.devices).toHaveLength(devices.length)
    expect(migrated.devices[0].flapping).toBe(false)
    expect(migrated.devices[0].inMaintenance).toBe(false)
  })

  it('drops invalid device records without throwing', () => {
    const migrated = migratePersistedNetwork(
      {
        devices: [
          { name: 'ok', type: 'router', ip: '10.0.0.1' },
          { nope: true },
        ],
        incidents: [],
        events: [],
      },
      1,
    )
    expect(migrated.devices).toHaveLength(1)
  })

  it('tolerates totally malformed input', () => {
    expect(migratePersistedNetwork(null, 1)).toEqual({
      devices: [],
      incidents: [],
      events: [],
    })
  })
})

describe('coerceDevices', () => {
  it('returns an empty array for non-arrays', () => {
    expect(coerceDevices('nope')).toEqual([])
    expect(coerceDevices(undefined)).toEqual([])
  })
})

describe('full-state backup', () => {
  it('round-trips a backup file', () => {
    const devices = buildSeedDevices(mulberry32(2), Date.now())
    const json = exportFullState({
      devices,
      incidents: [],
      events: [],
      settings: DEFAULT_SETTINGS,
    })
    const result = parseFullState(json)
    expect(result.ok).toBe(true)
    expect(result.data?.devices).toHaveLength(devices.length)
    expect(result.data?.settings).toBeDefined()
  })

  it('stamps the current storage version', () => {
    const json = exportFullState({
      devices: [],
      incidents: [],
      events: [],
      settings: DEFAULT_SETTINGS,
    })
    expect((JSON.parse(json) as { version: number }).version).toBe(
      STORAGE_VERSION,
    )
  })

  it('falls back to default settings when a backup omits them', () => {
    const json = JSON.stringify({ devices: [], incidents: [], events: [] })
    const result = parseFullState(json)
    expect(result.ok).toBe(true)
    expect(result.data?.settings).toMatchObject({
      theme: 'dark',
      maxHistoryPoints: 120,
    })
  })

  it('normalises invalid settings in a backup', () => {
    const json = JSON.stringify({
      devices: [],
      incidents: [],
      events: [],
      settings: {
        theme: 'neon',
        refreshIntervalMs: -5,
        maxHistoryPoints: 'lots',
      },
    })
    const result = parseFullState(json)
    expect(result.ok).toBe(true)
    expect(result.data?.settings.theme).toBe('dark')
    expect(result.data?.settings.refreshIntervalMs).toBe(1000)
    expect(result.data?.settings.maxHistoryPoints).toBe(120)
  })

  it('rejects non-JSON and empty input', () => {
    expect(parseFullState('   ').ok).toBe(false)
    expect(parseFullState('{ not json').ok).toBe(false)
  })
})
