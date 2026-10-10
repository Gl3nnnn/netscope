import { describe, expect, it } from 'vitest'
import { runTick } from '../../simulation/engine'
import { advanceDevice } from '../../simulation/metrics'
import { buildSeedDevices } from '../../simulation/seed'
import { mulberry32, type Rng } from '../../simulation/random'
import { DEFAULT_THRESHOLDS } from '../../store/useSettingsStore'

const NOW = 1_700_000_000_000

/** RNG that is calm on purpose: every chance() fails, noise/range are zero. */
const calm: Rng = {
  next: () => 0,
  range: () => 0,
  int: () => 0,
  pick: <T>(items: readonly T[]) => items[0] as T,
  chance: () => false,
  noise: () => 0,
}

/** RNG that never fails a chance and returns the mid-point of ranges. */
const steady: Rng = {
  ...calm,
  range: (min, max) => (min + max) / 2,
}

/**
 * RNG that always succeeds meaningful chance rolls (used to force incidents).
 * Tiny rolls such as the random maintenance window stay false so faults, not
 * maintenance, drive the scenario under test.
 */
const force: Rng = {
  ...calm,
  range: (_min, max) => max,
  chance: (p) => p >= 0.01,
}

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

  it('staggers inner-step event timestamps across the tick window', () => {
    const devices = buildSeedDevices(mulberry32(7), NOW)
    const stepMs = 5000
    const steps = 3
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps,
      incidentFrequency: 0.8,
      now: NOW,
      stepMs,
      rng: mulberry32(77),
    })
    const earliest = NOW - (steps - 1) * stepMs
    for (const event of result.events) {
      expect(event.timestamp).toBeGreaterThanOrEqual(earliest)
      expect(event.timestamp).toBeLessThanOrEqual(NOW)
    }
    for (const device of result.devices) {
      expect(result.samples[device.id].t).toBe(NOW)
    }
  })
})

describe('fault injection', () => {
  it('forces a faulted device offline and keeps its uptime at zero', () => {
    const devices = buildSeedDevices(mulberry32(7), NOW)
    const target = devices[0]
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 1,
      incidentFrequency: 0,
      now: NOW,
      rng: steady,
      faults: [
        {
          id: 'f1',
          kind: 'device-offline',
          target: target.id,
          appliedAt: NOW,
          expiresAt: null,
        },
      ],
    })
    const faulted = result.devices.find((device) => device.id === target.id)
    expect(faulted?.status).toBe('offline')
    expect(faulted?.uptimeSec).toBe(0)
    const untouched = result.devices.find((device) => device.id !== target.id)
    expect(untouched?.status).not.toBe('offline')
  })

  it('merges every device of a severed site into one incident', () => {
    const devices = buildSeedDevices(mulberry32(9), NOW)
    const site = devices[0].site
    const siteCount = devices.filter((device) => device.site === site).length
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 1,
      incidentFrequency: 1,
      now: NOW,
      rng: force,
      faults: [
        {
          id: 'f2',
          kind: 'site-outage',
          target: site,
          appliedAt: NOW,
          expiresAt: null,
        },
      ],
    })
    const merged = result.incidents.find((incident) =>
      incident.title.includes(site),
    )
    expect(merged).toBeDefined()
    expect(merged?.deviceIds).toHaveLength(siteCount)
    expect(
      result.devices
        .filter((device) => device.site === site)
        .every((device) => device.status === 'offline'),
    ).toBe(true)
  })

  it('drives a saturated link toward its capacity ceiling', () => {
    const devices = buildSeedDevices(mulberry32(13), NOW)
    const target = devices[0]
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 1,
      incidentFrequency: 0,
      now: NOW,
      rng: steady,
      faults: [
        {
          id: 'f3',
          kind: 'saturate',
          target: target.id,
          appliedAt: NOW,
          expiresAt: null,
        },
      ],
    })
    const sample = result.samples[target.id]
    const utilization = (sample.throughputMbps / target.capacityMbps) * 100
    expect(utilization).toBeGreaterThan(80)
    expect(utilization).toBeLessThanOrEqual(100)
  })

  it('ignores faults that have already expired', () => {
    const devices = buildSeedDevices(mulberry32(13), NOW)
    const target = devices[0]
    const result = runTick({
      devices,
      incidents: [],
      thresholds: DEFAULT_THRESHOLDS,
      steps: 1,
      incidentFrequency: 0,
      now: NOW,
      rng: steady,
      faults: [
        {
          id: 'f4',
          kind: 'device-offline',
          target: target.id,
          appliedAt: NOW - 10_000,
          expiresAt: NOW - 1,
        },
      ],
    })
    const faulted = result.devices.find((device) => device.id === target.id)
    expect(faulted?.status).not.toBe('offline')
  })
})

describe('advanceDevice', () => {
  it('accumulates uptime by stepMs while a device stays online', () => {
    const online = buildSeedDevices(mulberry32(7), NOW)[0]
    const advanced = advanceDevice(online, calm, DEFAULT_THRESHOLDS, NOW, {
      stepMs: 10000,
    })
    expect(advanced.device.status).toBe('online')
    expect(advanced.device.uptimeSec).toBe(online.uptimeSec + 10)
    expect(advanced.device.lastSeen).toBe(NOW)
  })

  it('keeps uptime at zero while a device stays offline', () => {
    const device = {
      ...buildSeedDevices(mulberry32(7), NOW)[0],
      status: 'offline' as const,
      uptimeSec: 0,
      lastSeen: NOW - 60_000,
    }
    const advanced = advanceDevice(device, calm, DEFAULT_THRESHOLDS, NOW, {
      stepMs: 10000,
    })
    expect(advanced.device.status).toBe('offline')
    expect(advanced.device.uptimeSec).toBe(0)
    expect(advanced.device.lastSeen).toBe(device.lastSeen)
  })
})
