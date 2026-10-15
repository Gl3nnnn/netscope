import { describe, expect, it } from 'vitest'
import type { Device, DeviceStatus } from '@/types'
import { hashSeed } from '@/simulation/random'
import {
  BAND_LABELS,
  CHANNELS_24,
  CHANNELS_5,
  CLIENTS_PER_AP,
  CONGESTION_THRESHOLD,
  SSID_CATALOG,
  WIFI_SECURITY_LABELS,
  WEAK_RSSI_DBM,
  buildAccessPoints,
  coverageReport,
  detectRogues,
  fleetSites,
  formatRadioUtil,
  signalToNoise,
  siteClientCount,
  siteSsids,
  wirelessFindings,
  wirelessSummary,
  type SsidProfile,
} from '@/lib/wireless'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STATUSES: DeviceStatus[] = ['online', 'degraded', 'offline']

function makeDevice(overrides: Partial<Device> & { id: string }): Device {
  return {
    name: overrides.id,
    type: 'accessPoint',
    site: 'HQ - Floor 1',
    ip: '10.0.0.1',
    mac: '00:00:00:00:00:00',
    status: 'online',
    tags: [],
    latencyMs: 5,
    packetLossPct: 0,
    availabilityPct: 100,
    throughputMbps: 20,
    capacityMbps: 1000,
    cpuPct: 25,
    memoryPct: 40,
    uptimeSec: 500_000,
    lastSeen: 0,
    ...overrides,
  }
}

/**
 * Four APs at HQ - Floor 1 (forces 2.4 GHz co-channel overlap), two at
 * Branch - East, none at HQ - Floor 2 (coverage gap), plus a lone AP at
 * Data Center A that will be offline.
 */
function wirelessFleet(): Device[] {
  const devices: Device[] = []
  for (let i = 1; i <= 4; i += 1) {
    devices.push(
      makeDevice({
        id: `ap-hq-${i}`,
        name: `ap-hq1-${i}`,
        site: 'HQ - Floor 1',
        status: i === 4 ? 'offline' : STATUSES[i % 3]!,
      }),
    )
  }
  for (let i = 1; i <= 2; i += 1) {
    devices.push(
      makeDevice({
        id: `ap-be-${i}`,
        name: `ap-east-${i}`,
        site: 'Branch - East',
      }),
    )
  }
  // Wired-only site: no APs at all.
  devices.push(
    makeDevice({
      id: 'sw-hq2',
      name: 'sw-hq2-1',
      type: 'switch',
      site: 'HQ - Floor 2',
    }),
  )
  // Solo AP site with heavy implied client load.
  devices.push(
    makeDevice({ id: 'ap-dca', name: 'ap-dca-1', site: 'Data Center A' }),
  )
  return devices
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

describe('channel pools', () => {
  it('2.4 GHz uses only the non-overlapping channels', () => {
    expect([...CHANNELS_24]).toEqual([1, 6, 11])
  })

  it('both pools are unique and disjoint', () => {
    expect(new Set(CHANNELS_24).size).toBe(CHANNELS_24.length)
    expect(new Set(CHANNELS_5).size).toBe(CHANNELS_5.length)
    for (const channel of CHANNELS_5) {
      expect(CHANNELS_24).not.toContain(channel)
    }
  })
})

describe('SSID catalog', () => {
  it('has unique names and valid vlans', () => {
    const names = SSID_CATALOG.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
    for (const ssid of SSID_CATALOG) {
      expect(ssid.vlan).toBeGreaterThan(0)
      expect(ssid.bands.length).toBeGreaterThan(0)
    }
  })

  it('only guest profiles may run open', () => {
    for (const ssid of SSID_CATALOG) {
      if (ssid.security === 'open') expect(ssid.guest).toBe(true)
    }
  })
})

describe('siteSsids', () => {
  it('always includes CorpNet-Ent', () => {
    for (const site of ['HQ - Floor 1', 'Branch - West', 'Data Center A']) {
      expect(siteSsids(site, 1).map((s) => s.name)).toContain('CorpNet-Ent')
    }
  })

  it('is deterministic per site+seed', () => {
    expect(siteSsids('HQ - Floor 1', 3)).toEqual(siteSsids('HQ - Floor 1', 3))
    expect(siteSsids('HQ - Floor 1', 3)).not.toEqual(
      siteSsids('HQ - Floor 1', 4),
    )
  })

  it('never broadcasts a non-guest open SSID from the catalog', () => {
    for (const site of ['HQ - Floor 1', 'Branch - East', 'HQ - Floor 2']) {
      for (const ssid of siteSsids(site, 5)) {
        if (ssid.security === 'open') expect(ssid.guest).toBe(true)
      }
    }
  })
})

describe('siteClientCount', () => {
  it('stays within the simulated population band', () => {
    for (const site of ['HQ - Floor 1', 'Branch - East', 'Data Center B']) {
      const clients = siteClientCount(site, 7)
      expect(clients).toBeGreaterThanOrEqual(40)
      expect(clients).toBeLessThanOrEqual(199)
    }
  })

  it('is deterministic and seed-sensitive', () => {
    expect(siteClientCount('HQ - Floor 1', 2)).toBe(
      siteClientCount('HQ - Floor 1', 2),
    )
    expect(siteClientCount('HQ - Floor 1', 2)).not.toBe(
      siteClientCount('HQ - Floor 1', 3),
    )
  })
})

describe('fleetSites', () => {
  it('returns sorted unique sites', () => {
    const sites = fleetSites(wirelessFleet())
    expect(sites).toEqual([...sites].sort((a, b) => a.localeCompare(b)))
    expect(sites).toContain('HQ - Floor 2')
  })
})

// ---------------------------------------------------------------------------
// Access points & channel plan
// ---------------------------------------------------------------------------

describe('buildAccessPoints', () => {
  const devices = wirelessFleet()
  const aps = buildAccessPoints(devices, 7)

  it('creates one entry per accessPoint device', () => {
    expect(aps).toHaveLength(
      devices.filter((d) => d.type === 'accessPoint').length,
    )
  })

  it('is deterministic for the same seed', () => {
    expect(buildAccessPoints(devices, 7)).toEqual(buildAccessPoints(devices, 7))
  })

  it('varies across seeds', () => {
    expect(JSON.stringify(buildAccessPoints(devices, 1))).not.toBe(
      JSON.stringify(buildAccessPoints(devices, 2)),
    )
  })

  it('gives every AP two radios (2.4 and 5 GHz)', () => {
    for (const ap of aps) {
      expect(ap.radios).toHaveLength(2)
      expect(ap.radios.map((r) => r.band).sort()).toEqual(['2.4GHz', '5GHz'])
    }
  })

  it('draws channels from the right pool per band', () => {
    for (const ap of aps) {
      for (const radio of ap.radios) {
        const pool = radio.band === '2.4GHz' ? CHANNELS_24 : CHANNELS_5
        expect(pool).toContain(radio.channel)
        expect(radio.widthMhz).toBe(radio.band === '2.4GHz' ? 20 : 40)
      }
    }
  })

  it('balances the channel plan within each site/band', () => {
    const site = 'HQ - Floor 1'
    const channels24 = aps
      .filter((ap) => ap.site === site)
      .map((ap) => ap.radios.find((r) => r.band === '2.4GHz')!.channel)
    const counts = new Map<number, number>()
    for (const channel of channels24) {
      counts.set(channel, (counts.get(channel) ?? 0) + 1)
    }
    const values = [...counts.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
  })

  it('reports accurate co-channel neighbour counts', () => {
    for (const ap of aps) {
      for (const radio of ap.radios) {
        const expected = aps.filter(
          (other) =>
            other.id !== ap.id &&
            other.site === ap.site &&
            other.radios.find((r) => r.band === radio.band)!.channel ===
              radio.channel,
        ).length
        expect(radio.coChannel).toBe(expected)
      }
    }
  })

  it('keeps utilisation inside 0..100', () => {
    for (const ap of aps) {
      for (const radio of ap.radios) {
        expect(radio.utilisationPct).toBeGreaterThanOrEqual(0)
        expect(radio.utilisationPct).toBeLessThanOrEqual(100)
      }
    }
  })

  it('four co-located APs force co-channel overlap on 2.4 GHz', () => {
    const hq = aps.filter((ap) => ap.site === 'HQ - Floor 1')
    const overlap = hq.some(
      (ap) => ap.radios.find((r) => r.band === '2.4GHz')!.coChannel > 0,
    )
    expect(overlap).toBe(true)
  })

  it('carries a positive client count and valid RSSI/SNR', () => {
    for (const ap of aps) {
      expect(ap.clients).toBeGreaterThan(0)
      expect(ap.avgRssiDbm).toBeLessThanOrEqual(-48)
      expect(ap.avgRssiDbm).toBeGreaterThanOrEqual(-72)
      expect(ap.snrDbm).toBe(signalToNoise(ap.avgRssiDbm, '2.4GHz'))
      expect(ap.weakClientPct).toBeGreaterThanOrEqual(0)
      expect(ap.weakClientPct).toBeLessThanOrEqual(99)
    }
  })

  it('returns an empty estate for a fleet with no APs', () => {
    expect(
      buildAccessPoints([makeDevice({ id: 's1', type: 'switch' })], 0),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Rogue detection
// ---------------------------------------------------------------------------

describe('detectRogues', () => {
  const devices = wirelessFleet()

  it('is deterministic per seed', () => {
    expect(detectRogues(devices, 4)).toEqual(detectRogues(devices, 4))
    expect(detectRogues(devices, 4)).not.toEqual(detectRogues(devices, 5))
  })

  it('places rogues only at fleet sites', () => {
    const sites = new Set(fleetSites(devices))
    for (const rogue of detectRogues(devices, 9)) {
      expect(sites.has(rogue.site)).toBe(true)
    }
  })

  it('assigns valid channels and confidence bounds', () => {
    for (const rogue of detectRogues(devices, 9)) {
      const pool = rogue.band === '2.4GHz' ? CHANNELS_24 : CHANNELS_5
      expect(pool).toContain(rogue.channel)
      expect(rogue.confidence).toBeGreaterThanOrEqual(0.55)
      expect(rogue.confidence).toBeLessThanOrEqual(1)
      expect(['critical', 'high', 'medium']).toContain(rogue.severity)
    }
  })

  it('escalates WEP to critical', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      for (const rogue of detectRogues(devices, seed)) {
        if (rogue.security === 'wep') expect(rogue.severity).toBe('critical')
      }
    }
  })

  it('returns an empty list for an empty fleet', () => {
    expect(detectRogues([], 1)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe('coverageReport', () => {
  const devices = wirelessFleet()
  const aps = buildAccessPoints(devices, 7)
  const coverage = coverageReport(devices, aps, 7)

  it('covers every fleet site', () => {
    expect(coverage.map((c) => c.site)).toEqual(fleetSites(devices))
  })

  it('marks a site with no APs as uncovered', () => {
    const hq2 = coverage.find((c) => c.site === 'HQ - Floor 2')!
    expect(hq2.status).toBe('none')
    expect(hq2.apsDeployed).toBe(0)
    expect(hq2.coveragePct).toBe(0)
    expect(hq2.apsRequired).toBe(
      Math.max(1, Math.ceil(hq2.clients / CLIENTS_PER_AP)),
    )
  })

  it('requires at least one AP everywhere', () => {
    for (const site of coverage) {
      expect(site.apsRequired).toBeGreaterThanOrEqual(1)
    }
  })

  it('covered sites meet or exceed their requirement', () => {
    for (const site of coverage) {
      if (site.status === 'covered') {
        expect(site.apsDeployed).toBeGreaterThanOrEqual(site.apsRequired)
        expect(site.coveragePct).toBe(100)
      }
      if (site.status === 'partial') {
        expect(site.apsDeployed).toBeLessThan(site.apsRequired)
        expect(site.coveragePct).toBeLessThan(100)
      }
    }
  })

  it('is deterministic', () => {
    expect(coverageReport(devices, aps, 7)).toEqual(
      coverageReport(devices, aps, 7),
    )
  })
})

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function ssidsBySite(devices: Device[], seed: number) {
  return Object.fromEntries(
    fleetSites(devices).map((site) => [site, siteSsids(site, seed)]),
  )
}

describe('wirelessFindings', () => {
  const devices = wirelessFleet()
  const aps = buildAccessPoints(devices, 7)
  const rogues = detectRogues(devices, 7)
  const coverage = coverageReport(devices, aps, 7)
  const ssids = ssidsBySite(devices, 7)
  const findings = wirelessFindings(aps, rogues, coverage, ssids)

  it('flags uncovered sites', () => {
    expect(
      findings.some(
        (f) => f.kind === 'coverage-gap' && f.site === 'HQ - Floor 2',
      ),
    ).toBe(true)
  })

  it('flags the offline access point', () => {
    expect(
      findings.some((f) => f.kind === 'ap-offline' && f.apName === 'ap-hq1-4'),
    ).toBe(true)
  })

  it('produces unique ids', () => {
    const ids = findings.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sorts by severity (critical first)', () => {
    const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const
    const severities = findings.map((f) => rank[f.severity])
    expect(severities).toEqual([...severities].sort((a, b) => a - b))
  })

  it('flags co-channel interference where it exists', () => {
    const cci = findings.filter((f) => f.kind === 'co-channel-interference')
    expect(cci.length).toBeGreaterThan(0)
    for (const finding of cci) expect(finding.apId).not.toBeNull()
  })

  it('does not flag an empty estate', () => {
    const empty = wirelessFindings([], [], [], {})
    expect(empty).toEqual([])
  })
})

describe('wirelessFindings · insecure SSIDs', () => {
  const openNet: SsidProfile = {
    name: 'OpenNet',
    security: 'open',
    vlan: 7,
    guest: false,
    bands: ['2.4GHz'],
  }
  const guest: SsidProfile = {
    name: 'Guest-WiFi',
    security: 'open',
    vlan: 99,
    guest: true,
    bands: ['2.4GHz', '5GHz'],
  }
  const legacy: SsidProfile = {
    name: 'Legacy',
    security: 'wep',
    vlan: 3,
    guest: false,
    bands: ['2.4GHz'],
  }

  it('flags non-guest open and WEP, but not the captive guest network', () => {
    const findings = wirelessFindings([], [], [], {
      'HQ - Floor 1': [openNet, guest, legacy],
    })
    expect(findings).toHaveLength(2)
    expect(findings.map((f) => f.kind)).toEqual([
      'insecure-ssid',
      'insecure-ssid',
    ])
    const wep = findings.find((f) => f.message.includes('WEP'))!
    expect(wep.severity).toBe('critical')
    const open = findings.find((f) => f.message.includes('OpenNet'))!
    expect(open.severity).toBe('high')
    expect(findings.some((f) => f.message.includes('Guest-WiFi'))).toBe(false)
  })

  it('flags congestion on a lone AP serving a dense site', () => {
    // Client population is hash-derived per site, so probe names until we find
    // one that is dense enough to saturate a single AP.
    let denseSite = ''
    for (let i = 0; i < 500 && denseSite === ''; i += 1) {
      const candidate = `Dense Site ${i}`
      if (siteClientCount(candidate, 7) >= 160) denseSite = candidate
    }
    expect(denseSite).not.toBe('')

    const dense = [makeDevice({ id: 'ap-dense', site: denseSite })]
    const aps = buildAccessPoints(dense, 7)
    const findings = wirelessFindings(
      aps,
      [],
      coverageReport(dense, aps, 7),
      {},
    )
    const congested = findings.filter((f) => f.kind === 'congestion')
    expect(congested.length).toBeGreaterThan(0)
    for (const finding of congested) expect(finding.message).toContain('%')
  })

  it('exposes the congestion threshold as a documented constant', () => {
    expect(CONGESTION_THRESHOLD).toBeGreaterThan(50)
    expect(CONGESTION_THRESHOLD).toBeLessThanOrEqual(100)
    expect(WEAK_RSSI_DBM).toBe(-70)
  })
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe('wirelessSummary', () => {
  const devices = wirelessFleet()
  const aps = buildAccessPoints(devices, 7)
  const rogues = detectRogues(devices, 7)
  const coverage = coverageReport(devices, aps, 7)
  const findings = wirelessFindings(
    aps,
    rogues,
    coverage,
    ssidsBySite(devices, 7),
  )
  const summary = wirelessSummary(aps, rogues, coverage, findings)

  it('counts APs, radios and clients consistently', () => {
    expect(summary.aps).toBe(aps.length)
    expect(summary.radios).toBe(aps.length * 2)
    expect(summary.clients).toBe(aps.reduce((sum, ap) => sum + ap.clients, 0))
    expect(summary.onlineAps).toBeLessThanOrEqual(summary.aps)
  })

  it('reports coverage across every site', () => {
    expect(summary.sitesTotal).toBe(coverage.length)
    expect(summary.sitesCovered).toBe(
      coverage.filter((c) => c.status !== 'none').length,
    )
    expect(summary.coveragePct).toBeLessThanOrEqual(100)
  })

  it('grade matches score thresholds', () => {
    expect(summary.score).toBeGreaterThanOrEqual(0)
    expect(summary.score).toBeLessThanOrEqual(100)
    if (summary.score >= 85) expect(summary.grade).toBe('healthy')
    else if (summary.score >= 60) expect(summary.grade).toBe('degraded')
    else expect(summary.grade).toBe('critical')
  })

  it('findings count matches the input list', () => {
    expect(summary.findings).toBe(findings.length)
  })

  it('an empty estate summarises to zeroes', () => {
    const empty = wirelessSummary([], [], [], [])
    expect(empty.aps).toBe(0)
    expect(empty.clients).toBe(0)
    expect(empty.avgUtilisationPct).toBe(0)
    expect(empty.score).toBe(100)
    expect(empty.grade).toBe('healthy')
  })
})

describe('helpers', () => {
  it('formatRadioUtil renders a percentage', () => {
    expect(formatRadioUtil(42)).toBe('42%')
    expect(formatRadioUtil(0)).toBe('0%')
  })

  it('signalToNoise clamps negatives to zero', () => {
    expect(signalToNoise(-60, '2.4GHz')).toBe(35) // -60 - (-95)
    expect(signalToNoise(-120, '2.4GHz')).toBe(0)
  })

  it('label maps cover every enum value', () => {
    expect(Object.keys(BAND_LABELS)).toEqual(['2.4GHz', '5GHz'])
    expect(Object.keys(WIFI_SECURITY_LABELS).sort()).toEqual(
      ['open', 'wpa2', 'wpa3', 'wpa3-enterprise', 'wep'].sort(),
    )
  })

  it('hash-based fixtures stay stable across runs', () => {
    expect(hashSeed('wireless-stability')).toBe(hashSeed('wireless-stability'))
  })
})
