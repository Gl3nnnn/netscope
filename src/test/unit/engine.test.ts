import { describe, expect, it } from 'vitest'
import { runTick } from '../../simulation/engine'
import { buildSeedDevices } from '../../simulation/seed'
import { mulberry32 } from '../../simulation/random'
import { DEFAULT_THRESHOLDS } from '../../store/useSettingsStore'

const NOW = 1_700_000_000_000

describe('runTick', () => {
  it('advances every device and emits a sample for each', () => {
    const devices = buildSeedDevices(mulberry32(7), NOW)
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 1,
      incidentFrequency: 0,
      now: NOW,
      rng: mulberry32(99),
    })

    expect(result.devices).toHaveLength(devices.length)
    expect(Object.keys(result.samples)).toHaveLength(devices.length)
    for (const device of result.devices) {
      expect(result.samples[device.id]).toBeDefined()
      expect(result.samples[device.id].t).toBe(NOW)
    }
  })

  it('records throughput, CPU and memory in each sample', () => {
    const devices = buildSeedDevices(mulberry32(7), NOW)
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 1,
      incidentFrequency: 0,
      now: NOW,
      rng: mulberry32(99),
    })
    const sample = result.samples[devices[0].id]
    expect(typeof sample.throughputMbps).toBe('number')
    expect(typeof sample.cpuPct).toBe('number')
    expect(typeof sample.memoryPct).toBe('number')
  })

  it('is deterministic for the same seed and inputs', () => {
    const devices = buildSeedDevices(mulberry32(7), NOW)
    const run = () =>
      runTick({
        devices,
        incidents: [],
        thresholds: DEFAULT_THRESHOLDS,
        steps: 3,
        incidentFrequency: 0.6,
        now: NOW,
        rng: mulberry32(2024),
      })

    expect(run().devices).toEqual(run().devices)
    expect(run().samples).toEqual(run().samples)
  })

  it('does not mutate the input devices array', () => {
    const devices = buildSeedDevices(mulberry32(7), NOW)
    const snapshot = JSON.parse(JSON.stringify(devices))
    runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 2,
      incidentFrequency: 0,
      now: NOW,
      rng: mulberry32(5),
    })
    expect(JSON.parse(JSON.stringify(devices))).toEqual(snapshot)
  })

  it('can generate incidents when frequency is high', () => {
    const devices = buildSeedDevices(mulberry32(11), NOW).map((device) => ({
      ...device,
      status: 'offline' as const,
      availabilityPct: 80,
      latencyMs: 250,
      packetLossPct: 30,
      cpuPct: 90,
    }))
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 1,
      incidentFrequency: 1,
      now: NOW,
      rng: mulberry32(3),
    })
    expect(result.incidents.length).toBeGreaterThan(0)
    expect(result.events.some((event) => event.type === 'incident')).toBe(true)
  })
})
