import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  DOOR_OPEN_LIMIT_MIN,
  HUMIDITY_BAND_PCT,
  HOT_SPOT_TEMP_C,
  TEMP_BAND_C,
  generateSensors,
  readSensor,
  runFacility,
  sensorFinding,
  type FacilitySensor,
} from '@/lib/facility'

const SEED = 41

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

const DEVICES: Device[] = [
  makeDevice({ id: 'r1', name: 'r1', type: 'router' }),
  makeDevice({ id: 'srv1', name: 'srv1' }),
  makeDevice({ id: 'sw1', name: 'sw1', type: 'switch', site: 'Data Center A' }),
  makeDevice({
    id: 'fw1',
    name: 'fw1',
    type: 'firewall',
    site: 'Branch - West',
  }),
]

function draftSensor(overrides: Partial<FacilitySensor> = {}): FacilitySensor {
  return {
    id: 'sen-x-temp',
    site: 'HQ - Floor 1',
    kind: 'temp',
    zone: 'return',
    label: 'Hot-aisle return temp',
    reading: 22,
    minThreshold: TEMP_BAND_C[0],
    maxThreshold: TEMP_BAND_C[1],
    inBand: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Generation & readings
// ---------------------------------------------------------------------------

describe('generateSensors', () => {
  it('creates six unique sensors covering all kinds', () => {
    const sensors = generateSensors('HQ - Floor 1')
    expect(sensors).toHaveLength(6)
    const ids = new Set(sensors.map((s) => s.id))
    expect(ids.size).toBe(6)
    const kinds = new Set(sensors.map((s) => s.kind))
    expect([...kinds].sort()).toEqual([
      'door',
      'humidity',
      'leak',
      'smoke',
      'temp',
    ])
    expect(sensors.filter((s) => s.kind === 'temp')).toHaveLength(2)
    // Two temps with the ASHRAE band.
    for (const temp of sensors.filter((s) => s.kind === 'temp')) {
      expect(temp.minThreshold).toBe(TEMP_BAND_C[0])
      expect(temp.maxThreshold).toBe(TEMP_BAND_C[1])
    }
    const humidity = sensors.find((s) => s.kind === 'humidity')!
    expect(humidity.minThreshold).toBe(HUMIDITY_BAND_PCT[0])
    expect(humidity.maxThreshold).toBe(HUMIDITY_BAND_PCT[1])
  })

  it('gives different sites different ids', () => {
    const a = generateSensors('HQ - Floor 1')
    const b = generateSensors('Data Center A')
    expect(a[0]!.id).not.toBe(b[0]!.id)
  })
})

describe('readSensor', () => {
  it('is deterministic per (sensor, seed, tick) and changes with tick', () => {
    const sensor = generateSensors('HQ - Floor 1')[1]!
    const a = readSensor(sensor, SEED, 5)
    const b = readSensor(sensor, SEED, 5)
    const c = readSensor(sensor, SEED, 6)
    expect(a).toEqual(b)
    expect(a.reading).not.toBe(c.reading)
  })

  it('keeps supply temps in-band and inside 18–22 °C', () => {
    const supply = generateSensors('HQ - Floor 1').find(
      (s) => s.zone === 'supply',
    )!
    for (const tick of [1, 2, 3, 4, 5]) {
      const read = readSensor(supply, SEED, tick)
      expect(read.reading).toBeGreaterThanOrEqual(18)
      expect(read.reading).toBeLessThanOrEqual(22)
      expect(read.inBand).toBe(true)
    }
  })

  it('keeps leak/smoke readings as 0/1', () => {
    for (const kind of ['leak', 'smoke'] as const) {
      const sensor = generateSensors('HQ - Floor 1').find(
        (s) => s.kind === kind,
      )!
      for (let tick = 1; tick <= 40; tick += 1) {
        const read = readSensor(sensor, SEED, tick)
        expect([0, 1]).toContain(read.reading)
        expect(read.inBand).toBe(read.reading === 0)
      }
    }
  })

  it('bounds door open-minutes under 15', () => {
    const door = generateSensors('HQ - Floor 1').find((s) => s.kind === 'door')!
    for (let tick = 1; tick <= 30; tick += 1) {
      expect(readSensor(door, SEED, tick).reading).toBeLessThan(15)
    }
  })
})

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

describe('sensorFinding', () => {
  it('flags a hot spot above the ASHRAE maximum', () => {
    const finding = sensorFinding(draftSensor({ reading: 28 }))
    expect(finding).not.toBeNull()
    expect(finding!.kind).toBe('temp-high')
    expect(finding!.severity).toBe('high')
  })

  it('escalates extreme heat to critical', () => {
    const finding = sensorFinding(draftSensor({ reading: HOT_SPOT_TEMP_C + 3 }))
    expect(finding!.severity).toBe('critical')
  })

  it('flags over-cooling, humidity, leak, smoke and door-open', () => {
    expect(sensorFinding(draftSensor({ reading: 16 }))!.kind).toBe('temp-low')
    expect(
      sensorFinding(
        draftSensor({
          kind: 'humidity',
          reading: 70,
          minThreshold: HUMIDITY_BAND_PCT[0],
          maxThreshold: HUMIDITY_BAND_PCT[1],
          inBand: false,
        }),
      )!.kind,
    ).toBe('humidity')
    const leak = sensorFinding(
      draftSensor({ kind: 'leak', reading: 1, inBand: false }),
    )!
    expect(leak.kind).toBe('leak')
    expect(leak.severity).toBe('critical')
    const smoke = sensorFinding(
      draftSensor({ kind: 'smoke', reading: 1, inBand: false }),
    )!
    expect(smoke.kind).toBe('smoke')
    expect(smoke.severity).toBe('critical')
    const door = sensorFinding(
      draftSensor({
        kind: 'door',
        reading: DOOR_OPEN_LIMIT_MIN + 2,
        maxThreshold: DOOR_OPEN_LIMIT_MIN,
        inBand: false,
      }),
    )!
    expect(door.kind).toBe('door-open')
    expect(door.severity).toBe('low')
  })

  it('returns null for healthy readings', () => {
    expect(sensorFinding(draftSensor({ reading: 22 }))).toBeNull()
    expect(
      sensorFinding(
        draftSensor({
          kind: 'humidity',
          reading: 50,
          inBand: true,
          minThreshold: HUMIDITY_BAND_PCT[0],
          maxThreshold: HUMIDITY_BAND_PCT[1],
        }),
      ),
    ).toBeNull()
    expect(
      sensorFinding(draftSensor({ kind: 'leak', reading: 0, inBand: true })),
    ).toBeNull()
    expect(
      sensorFinding(
        draftSensor({
          kind: 'door',
          reading: 3,
          inBand: true,
          maxThreshold: DOOR_OPEN_LIMIT_MIN,
        }),
      ),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Full view
// ---------------------------------------------------------------------------

describe('runFacility', () => {
  it('is deterministic and covers every site', () => {
    const a = runFacility(DEVICES, SEED, 7)
    const b = runFacility(DEVICES, SEED, 7)
    expect(a).toEqual(b)
    const siteNames = new Set(DEVICES.map((d) => d.site))
    expect(a.summary.sites).toBe(siteNames.size)
    expect(a.sensors).toHaveLength(siteNames.size * 6)
    expect(a.sites.map((s) => s.site).sort()).toEqual([...siteNames].sort())
  })

  it('partitions sites into ok/warning/critical status', () => {
    const result = runFacility(DEVICES, SEED, 7)
    expect(
      result.summary.ok + result.summary.warning + result.summary.critical,
    ).toBe(result.summary.sites)
    for (const site of result.sites) {
      expect(['ok', 'warning', 'critical']).toContain(site.status)
      expect(site.hottestTempC).toBeGreaterThanOrEqual(0)
      expect(site.facilityWatts).toBeGreaterThanOrEqual(0)
    }
    expect(result.summary.findings).toBe(result.findings.length)
  })

  it('changes with the tick', () => {
    const a = runFacility(DEVICES, SEED, 1)
    const b = runFacility(DEVICES, SEED, 2)
    const readingA = a.sensors.map((s) => s.reading).join()
    const readingB = b.sensors.map((s) => s.reading).join()
    expect(readingA).not.toBe(readingB)
  })

  it('is safe on an empty fleet', () => {
    const result = runFacility([], SEED, 1)
    expect(result.sensors).toEqual([])
    expect(result.summary.sites).toBe(0)
    expect(result.summary.avgTempC).toBe(0)
    expect(result.findings).toEqual([])
  })
})
