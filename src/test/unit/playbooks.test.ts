import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import type { AlertInstance } from '@/lib/alerts'
import {
  DEFAULT_PLAYBOOKS,
  activeWindows,
  describeTrigger,
  isSuppressed,
  maintenanceTargets,
  matchPlaybook,
  planAutomation,
  severityAtLeast,
  windowActive,
  windowMatchesDevice,
  withRunKeys,
  type MaintenanceWindow,
  type Playbook,
  type PlaybookContext,
} from '@/lib/playbooks'

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
    throughputMbps: 500,
    capacityMbps: 1000,
    cpuPct: 20,
    memoryPct: 30,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

function alert(overrides: Partial<AlertInstance> = {}): AlertInstance {
  return {
    id: 'rule1:d1',
    ruleId: 'rule1',
    ruleName: 'High latency',
    deviceId: 'd1',
    deviceName: 'Device 1',
    severity: 'high',
    status: 'firing',
    startedAt: 0,
    firedAt: 0,
    value: 200,
    ...overrides,
  }
}

function playbook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    id: 'pb1',
    name: 'Test playbook',
    description: '',
    enabled: true,
    trigger: { kind: 'offline' },
    actions: [{ kind: 'notify' }],
    cooldownMs: 0,
    ...overrides,
  }
}

function window(overrides: Partial<MaintenanceWindow> = {}): MaintenanceWindow {
  return {
    id: 'w1',
    name: 'Window',
    site: 'HQ',
    deviceIds: [],
    startsAt: 0,
    endsAt: 10_000,
    suppressAlerts: true,
    ...overrides,
  }
}

function context(overrides: Partial<PlaybookContext> = {}): PlaybookContext {
  return {
    now: 1000,
    devices: [device()],
    alerts: [],
    windows: [],
    lastRunByKey: {},
    ...overrides,
  }
}

describe('severityAtLeast', () => {
  it('ranks severities', () => {
    expect(severityAtLeast('critical', 'high')).toBe(true)
    expect(severityAtLeast('medium', 'high')).toBe(false)
    expect(severityAtLeast('low', 'low')).toBe(true)
  })
})

describe('maintenance windows', () => {
  it('reports whether a window is active', () => {
    expect(windowActive(window(), 5000)).toBe(true)
    expect(windowActive(window(), 10_000)).toBe(false)
    expect(windowActive(window(), 0)).toBe(true)
  })

  it('matches windows by site or device id', () => {
    expect(windowMatchesDevice(window({ site: 'HQ' }), device())).toBe(true)
    expect(windowMatchesDevice(window({ site: 'DC' }), device())).toBe(false)
    expect(
      windowMatchesDevice(window({ site: null, deviceIds: ['d1'] }), device()),
    ).toBe(true)
  })

  it('suppresses matching devices inside active windows', () => {
    const windows = [window()]
    expect(isSuppressed(device(), windows, 1000)).toBe(true)
    expect(isSuppressed(device(), windows, 20_000)).toBe(false)
    expect(isSuppressed(device({ site: 'DC' }), windows, 1000)).toBe(false)
  })

  it('ignores windows that do not suppress alerts', () => {
    const windows = [window({ suppressAlerts: false })]
    expect(isSuppressed(device(), windows, 1000)).toBe(false)
  })

  it('collects active windows and maintenance targets', () => {
    const windows = [window(), window({ id: 'w2', site: 'DC' })]
    expect(activeWindows(windows, 5000)).toHaveLength(2)
    expect(activeWindows(windows, 20_000)).toHaveLength(0)
    const targets = maintenanceTargets(
      windows,
      [device(), device({ id: 'd2', site: 'DC' })],
      5000,
    )
    expect(targets.sort()).toEqual(['d1', 'd2'])
    expect(maintenanceTargets(windows, [device()], 20_000)).toEqual([])
  })
})

describe('describeTrigger', () => {
  it('labels alert triggers with severity and scope', () => {
    expect(describeTrigger({ kind: 'alert', minSeverity: 'high' })).toBe(
      'Alert fires (high+)',
    )
    expect(describeTrigger({ kind: 'offline', type: 'router' })).toBe(
      'Device goes offline (router)',
    )
  })
})

describe('matchPlaybook', () => {
  it('matches offline devices', () => {
    const match = matchPlaybook(
      playbook(),
      context({ devices: [device({ status: 'offline' })] }),
    )
    expect(match?.deviceIds).toEqual(['d1'])
  })

  it('matches saturated devices', () => {
    const match = matchPlaybook(
      playbook({ trigger: { kind: 'saturation' } }),
      context({ devices: [device({ throughputMbps: 900 })] }),
    )
    expect(match?.deviceIds).toEqual(['d1'])
  })

  it('honours trigger scope', () => {
    const pb = playbook({ trigger: { kind: 'offline', site: 'DC' } })
    expect(
      matchPlaybook(pb, context({ devices: [device({ status: 'offline' })] })),
    ).toBeNull()
  })

  it('matches firing alerts by severity', () => {
    const pb = playbook({ trigger: { kind: 'alert', minSeverity: 'high' } })
    const match = matchPlaybook(
      pb,
      context({ alerts: [alert({ severity: 'high' })] }),
    )
    expect(match?.deviceIds).toEqual(['d1'])
    expect(match?.alertIds).toEqual(['rule1:d1'])
  })

  it('ignores alerts below the severity floor', () => {
    const pb = playbook({ trigger: { kind: 'alert', minSeverity: 'critical' } })
    expect(matchPlaybook(pb, context({ alerts: [alert()] }))).toBeNull()
  })

  it('skips devices that are in maintenance or suppressed', () => {
    const pb = playbook()
    expect(
      matchPlaybook(
        pb,
        context({
          devices: [device({ status: 'offline', inMaintenance: true })],
        }),
      ),
    ).toBeNull()
    expect(
      matchPlaybook(
        pb,
        context({
          devices: [device({ status: 'offline' })],
          windows: [window()],
        }),
      ),
    ).toBeNull()
  })

  it('does not match disabled playbooks', () => {
    expect(
      matchPlaybook(
        playbook({ enabled: false }),
        context({ devices: [device({ status: 'offline' })] }),
      ),
    ).toBeNull()
  })
})

describe('planAutomation', () => {
  it('produces one run per matching playbook', () => {
    const runs = planAutomation(
      [playbook()],
      context({ devices: [device({ status: 'offline' })] }),
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]?.playbookId).toBe('pb1')
    expect(runs[0]?.deviceIds).toEqual(['d1'])
    expect(runs[0]?.id).toBe('run_pb1_1000')
  })

  it('respects the per-device cooldown', () => {
    const pb = playbook({ cooldownMs: 60_000 })
    const ctx = context({
      now: 1000,
      devices: [device({ status: 'offline' })],
      lastRunByKey: { 'pb1:d1': 900 },
    })
    expect(planAutomation([pb], ctx)).toHaveLength(0)
    expect(planAutomation([pb], { ...ctx, now: 61_000 })).toHaveLength(1)
  })

  it('is a no-op when nothing matches', () => {
    expect(planAutomation([playbook()], context())).toHaveLength(0)
  })
})

describe('withRunKeys', () => {
  it('records the latest run per playbook and device', () => {
    const runs = planAutomation(
      [playbook()],
      context({ now: 5000, devices: [device({ status: 'offline' })] }),
    )
    expect(withRunKeys({}, runs)).toEqual({ 'pb1:d1': 5000 })
  })
})

describe('DEFAULT_PLAYBOOKS', () => {
  it('seeds enabled notify-only playbooks', () => {
    expect(DEFAULT_PLAYBOOKS.length).toBeGreaterThan(0)
    for (const pb of DEFAULT_PLAYBOOKS) {
      expect(pb.enabled).toBe(true)
      expect(pb.actions.every((action) => action.kind === 'notify')).toBe(true)
    }
  })
})
