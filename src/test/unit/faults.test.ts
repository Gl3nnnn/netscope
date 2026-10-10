import { describe, expect, it } from 'vitest'
import type { FaultInjection } from '@/types'
import {
  activeFaults,
  describeFaultTarget,
  faultedSites,
  isFaultActive,
  resolveFaultEffect,
} from '@/simulation/faults'
import { buildSeedDevices } from '@/simulation/seed'
import { mulberry32 } from '@/simulation/random'

const NOW = 1_700_000_000_000

function fault(partial: Partial<FaultInjection>): FaultInjection {
  return {
    id: 'fault_1',
    kind: 'device-offline',
    target: 'dev_1',
    appliedAt: NOW,
    expiresAt: null,
    ...partial,
  }
}

describe('isFaultActive', () => {
  it('treats null expiry as sticky', () => {
    expect(isFaultActive(fault({}), NOW)).toBe(true)
    expect(isFaultActive(fault({}), NOW + 1_000_000)).toBe(true)
  })

  it('expires once the deadline passes', () => {
    const expiring = fault({ expiresAt: NOW + 1000 })
    expect(isFaultActive(expiring, NOW + 999)).toBe(true)
    expect(isFaultActive(expiring, NOW + 1000)).toBe(false)
  })
})

describe('activeFaults', () => {
  it('keeps only the still-active faults', () => {
    const list = [
      fault({ id: 'a', expiresAt: null }),
      fault({ id: 'b', expiresAt: NOW + 500 }),
    ]
    expect(activeFaults(list, NOW).map((f) => f.id)).toEqual(['a', 'b'])
    expect(activeFaults(list, NOW + 600).map((f) => f.id)).toEqual(['a'])
  })
})

describe('resolveFaultEffect', () => {
  const device = { id: 'dev_1', site: 'HQ' }

  it('forces the targeted device offline only', () => {
    const effect = resolveFaultEffect([fault({})], device, NOW)
    expect(effect).toEqual({ forcedOffline: true, saturated: false })
    expect(
      resolveFaultEffect([fault({})], { id: 'dev_2', site: 'Lab' }, NOW),
    ).toEqual({ forcedOffline: false, saturated: false })
  })

  it('cascades a site outage to every device at the site', () => {
    const outage = fault({ kind: 'site-outage', target: 'HQ' })
    expect(resolveFaultEffect([outage], { id: 'x', site: 'HQ' }, NOW)).toEqual({
      forcedOffline: true,
      saturated: false,
    })
    expect(
      resolveFaultEffect(
        [fault({ kind: 'site-outage', target: 'Lab' })],
        {
          id: 'y',
          site: 'HQ',
        },
        NOW,
      ).forcedOffline,
    ).toBe(false)
  })

  it('flags saturation without forcing offline', () => {
    const effect = resolveFaultEffect(
      [fault({ kind: 'saturate' })],
      {
        id: 'dev_1',
        site: 'HQ',
      },
      NOW,
    )
    expect(effect).toEqual({ forcedOffline: false, saturated: true })
  })

  it('ignores expired faults', () => {
    const expired = fault({ expiresAt: NOW - 1 })
    expect(
      resolveFaultEffect([expired], { id: 'dev_1', site: 'HQ' }, NOW),
    ).toEqual({ forcedOffline: false, saturated: false })
  })
})

describe('faultedSites', () => {
  it('returns only active site outage targets', () => {
    const list = [
      fault({ id: 'a', kind: 'site-outage', target: 'Lab' }),
      fault({ id: 'b', kind: 'site-outage', target: 'HQ', expiresAt: NOW - 1 }),
      fault({ id: 'c', kind: 'saturate', target: 'dev_9' }),
    ]
    expect(faultedSites(list, NOW)).toEqual(['Lab'])
  })
})

describe('describeFaultTarget', () => {
  it('names the device when found and the site for outages', () => {
    const devices = buildSeedDevices(mulberry32(1), NOW)
    const device = devices[0]
    expect(
      describeFaultTarget(
        { kind: 'device-offline', target: device.id },
        devices,
      ),
    ).toBe(`${device.name} (${device.site})`)
    expect(
      describeFaultTarget({ kind: 'site-outage', target: 'Lab' }, devices),
    ).toBe('site Lab')
  })

  it('falls back to the raw id for unknown devices', () => {
    expect(
      describeFaultTarget(
        { kind: 'saturate', target: 'ghost' },
        buildSeedDevices(mulberry32(1), NOW),
      ),
    ).toBe('ghost')
  })
})
