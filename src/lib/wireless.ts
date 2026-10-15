/**
 * Wireless / RF engine.
 *
 * Deterministic model of the WLAN estate: SSID profiles per site, dual-radio
 * (2.4 / 5 GHz) channel plans with co-channel interference, simulated client
 * density, RSSI/SNR, rogue-AP detection and per-site coverage planning.
 *
 * Pure and dependency-free — derive it from the inventory (`accessPoint`
 * devices + site list) and a seed.
 */
import type { Device, DeviceStatus, Severity } from '@/types'
import { clamp, clamp01, formatPct, round } from '@/lib/format'
import { hashSeed } from '@/simulation/random'

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type Band = '2.4GHz' | '5GHz'

export type WifiSecurity = 'wpa3-enterprise' | 'wpa3' | 'wpa2' | 'open' | 'wep'

export interface SsidProfile {
  name: string
  security: WifiSecurity
  vlan: number
  /** True for a guest network that is allowed to run open (captive portal). */
  guest: boolean
  bands: Band[]
}

export interface WlanRadio {
  band: Band
  channel: number
  /** Channel width in MHz. */
  widthMhz: 20 | 40
  /** Other managed APs on the same site + channel. */
  coChannel: number
  /** Simulated channel utilisation (0..100). */
  utilisationPct: number
  /** Split of the AP's clients that associate to this radio. */
  clients: number
  noiseFloorDbm: number
  txPowerDbm: number
}

export interface WlanAccessPoint {
  id: string
  deviceId: string
  name: string
  site: string
  status: DeviceStatus
  model: string
  /** Total simulated clients associated with this AP. */
  clients: number
  /** Area-average RSSI in dBm (negative). */
  avgRssiDbm: number
  /** Signal-to-noise ratio in dB. */
  snrDbm: number
  /** Percentage of clients with a weak (-70 dBm or worse) signal. */
  weakClientPct: number
  radios: WlanRadio[]
  /** SSIDs broadcast at this AP's site. */
  ssids: string[]
}

export interface RogueAp {
  id: string
  site: string
  ssid: string
  mac: string
  band: Band
  channel: number
  /** 0..1 analyst confidence that this AP is unauthorised. */
  confidence: number
  security: WifiSecurity
  severity: Severity
}

export interface SiteCoverage {
  site: string
  /** Simulated wireless clients that need coverage at this site. */
  clients: number
  apsDeployed: number
  /** Minimum APs required for the client density (25 clients/AP). */
  apsRequired: number
  coveragePct: number
  status: 'covered' | 'partial' | 'none'
}

export type WirelessFindingKind =
  | 'co-channel-interference'
  | 'congestion'
  | 'coverage-gap'
  | 'rogue-ap'
  | 'weak-clients'
  | 'insecure-ssid'
  | 'ap-offline'

export interface WirelessFinding {
  id: string
  kind: WirelessFindingKind
  severity: Severity
  site: string
  apId: string | null
  apName: string | null
  message: string
}

export interface WirelessSummary {
  aps: number
  onlineAps: number
  radios: number
  clients: number
  avgClientsPerAp: number
  /** Mean utilisation across every radio. */
  avgUtilisationPct: number
  /** Radios above the congestion threshold. */
  congested: number
  rogues: number
  sitesCovered: number
  sitesTotal: number
  coveragePct: number
  findings: number
  score: number
  grade: 'healthy' | 'degraded' | 'critical'
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/** Non-overlapping 2.4 GHz channels (20 MHz). */
export const CHANNELS_24 = [1, 6, 11] as const

/** Common 5 GHz channels for a 40 MHz plan. */
export const CHANNELS_5 = [36, 40, 44, 149, 153, 157] as const

/** Utilisation at or above which a radio is considered congested. */
export const CONGESTION_THRESHOLD = 75

/** Clients per AP guideline used by the coverage planner. */
export const CLIENTS_PER_AP = 25

/** RSSI at or below which a client is classed as weak. */
export const WEAK_RSSI_DBM = -70

export const WIFI_SECURITY_LABELS: Record<WifiSecurity, string> = {
  'wpa3-enterprise': 'WPA3-Enterprise',
  wpa3: 'WPA3',
  wpa2: 'WPA2',
  open: 'Open',
  wep: 'WEP',
}

export const BAND_LABELS: Record<Band, string> = {
  '2.4GHz': '2.4 GHz',
  '5GHz': '5 GHz',
}

/** Catalogue of SSIDs the organisation is allowed to broadcast. */
export const SSID_CATALOG: SsidProfile[] = [
  {
    name: 'CorpNet-Ent',
    security: 'wpa3-enterprise',
    vlan: 10,
    guest: false,
    bands: ['2.4GHz', '5GHz'],
  },
  {
    name: 'VoWiFi',
    security: 'wpa3',
    vlan: 20,
    guest: false,
    bands: ['5GHz'],
  },
  {
    name: 'IoT-Secure',
    security: 'wpa2',
    vlan: 100,
    guest: false,
    bands: ['2.4GHz'],
  },
  {
    name: 'Guest-WiFi',
    security: 'open',
    vlan: 99,
    guest: true,
    bands: ['2.4GHz', '5GHz'],
  },
]

const AP_MODELS = ['AP-440', 'AP-635', 'AP-225']

/** Link-layer budget: noise floor per band. */
const NOISE_FLOOR: Record<Band, number> = {
  '2.4GHz': -95,
  '5GHz': -96,
}

/** Usable throughput per radio at a given width. */
function radioCapacityMbps(band: Band, widthMhz: 20 | 40): number {
  if (band === '2.4GHz') return widthMhz === 40 ? 90 : 65
  return widthMhz === 40 ? 165 : 85
}

/** Per-client demand on a radio. */
function perClientMbps(band: Band): number {
  return band === '2.4GHz' ? 1.1 : 2.6
}

// ---------------------------------------------------------------------------
// SSIDs & clients
// ---------------------------------------------------------------------------

/**
 * SSIDs broadcast at a site. CorpNet always; the rest are enabled by a
 * deterministic per-site roll so different sites show different postures.
 */
export function siteSsids(site: string, seed = 0): SsidProfile[] {
  const h = hashSeed(`ssid:${site}:${seed}`)
  return SSID_CATALOG.filter((ssid, index) => {
    if (index === 0) return true // CorpNet everywhere
    if (ssid.guest) return h % 2 === 0
    if (ssid.name === 'IoT-Secure') return h % 3 !== 0
    return h % 4 === 1 // VoWiFi
  })
}

/** Simulated wireless client population for a site. */
export function siteClientCount(site: string, seed = 0): number {
  const h = hashSeed(`clients:${site}:${seed}`)
  return 40 + (h % 160) // 40..199
}

// ---------------------------------------------------------------------------
// Access points
// ---------------------------------------------------------------------------

function apsAtSite(devices: Device[], site: string): Device[] {
  return devices.filter((d) => d.type === 'accessPoint' && d.site === site)
}

/** All sites present in the fleet. */
export function fleetSites(devices: Device[]): string[] {
  return [...new Set(devices.map((device) => device.site))].sort()
}

/**
 * Build the managed AP estate: dual radios per AP with a greedy,
 * site-local channel plan (non-overlapping where possible).
 */
export function buildAccessPoints(
  devices: Device[],
  seed = 0,
): WlanAccessPoint[] {
  const apDevices = devices
    .filter((device) => device.type === 'accessPoint')
    .sort((a, b) => a.id.localeCompare(b.id))

  const sites = [...new Set(apDevices.map((device) => device.site))]

  const aps: WlanAccessPoint[] = apDevices.map((device) => {
    const h = hashSeed(`${device.id}:${seed}`)
    const siteAps = apsAtSite(devices, device.site)
    const siteClients = siteClientCount(device.site, seed)
    // Distribute the site's clients across its APs with a small seeded wobble.
    const share = Math.max(
      1,
      Math.round(siteClients / Math.max(1, siteAps.length)),
    )
    const clients = clamp(share + ((h % 9) - 4), 1, siteClients)

    const avgRssiDbm = -48 - (h % 25) // -48..-72 dBm
    const weakClientPct = h % 30 // 0..29%

    return {
      id: `ap-${device.id}`,
      deviceId: device.id,
      name: device.name,
      site: device.site,
      status: device.status,
      model: AP_MODELS[h % AP_MODELS.length]!,
      clients,
      avgRssiDbm,
      // Worst-case SNR: measured against the noisier 2.4 GHz floor.
      snrDbm: avgRssiDbm - NOISE_FLOOR['2.4GHz'],
      weakClientPct,
      ssids: siteSsids(device.site, seed).map((ssid) => ssid.name),
      radios: [] as WlanRadio[],
    }
  })

  // Channel plan (pass 1): per site, per band, greedy least-used with a
  // seeded offset. Channels land in a lookup so co-channel counts can be
  // computed accurately in pass 2.
  const channelOf = new Map<string, number>()
  for (const site of sites) {
    const siteAps = aps.filter((ap) => ap.site === site)
    for (const band of ['2.4GHz', '5GHz'] as const) {
      const pool = band === '2.4GHz' ? CHANNELS_24 : CHANNELS_5
      const usage = new Array<number>(pool.length).fill(0)
      for (const ap of siteAps) {
        const offset = hashSeed(`${ap.id}:${band}:${seed}`) % pool.length
        let bestIndex = offset
        for (let step = 1; step < pool.length; step += 1) {
          const index = (offset + step) % pool.length
          if (usage[index]! < usage[bestIndex]!) bestIndex = index
        }
        usage[bestIndex]! += 1
        channelOf.set(`${ap.id}:${band}`, pool[bestIndex]!)
      }
    }
  }

  // Radios (pass 2): clients split ~40/60 across 2.4 / 5 GHz, utilisation
  // derived from demand plus a co-channel airtime penalty.
  for (const ap of aps) {
    for (const band of ['2.4GHz', '5GHz'] as const) {
      const channel = channelOf.get(`${ap.id}:${band}`) ?? -1
      const widthMhz: 20 | 40 = band === '2.4GHz' ? 20 : 40
      const clients24 = Math.round(ap.clients * 0.4)
      const clients = band === '2.4GHz' ? clients24 : ap.clients - clients24
      const coChannel = aps.filter(
        (other) =>
          other.id !== ap.id &&
          other.site === ap.site &&
          channelOf.get(`${other.id}:${band}`) === channel,
      ).length
      const demand =
        (clients * perClientMbps(band)) / radioCapacityMbps(band, widthMhz)
      const cciPenalty = band === '2.4GHz' ? coChannel * 0.06 : coChannel * 0.03
      const utilisationPct = Math.round(clamp01(demand + cciPenalty) * 100)

      ap.radios.push({
        band,
        channel,
        widthMhz,
        coChannel,
        utilisationPct,
        clients,
        noiseFloorDbm: NOISE_FLOOR[band],
        txPowerDbm: band === '2.4GHz' ? 16 : 20,
      })
    }
  }

  return aps
}

// ---------------------------------------------------------------------------
// Rogue detection
// ---------------------------------------------------------------------------

/** SSIDs an attacker typically broadcasts. */
const ROGUE_SSIDS = ['Free-WiFi', 'linksys', 'CoffeeShop-Guest', 'NETGEAR-EXT']

/**
 * Simulated rogue APs. Roughly one in three sites hosts a rogue; the
 * confidence and severity depend on how badly it collides with the plan.
 */
export function detectRogues(devices: Device[], seed = 0): RogueAp[] {
  const sites = fleetSites(devices)
  const rogues: RogueAp[] = []

  for (const site of sites) {
    const h = hashSeed(`rogue:${site}:${seed}`)
    if (h % 3 !== 0) continue

    const band: Band = h % 2 === 0 ? '2.4GHz' : '5GHz'
    const pool = band === '2.4GHz' ? CHANNELS_24 : CHANNELS_5
    const channel = pool[h % pool.length]!
    const security: WifiSecurity =
      h % 5 === 0 ? 'wep' : h % 4 === 0 ? 'open' : 'wpa2'
    const confidence = round(0.55 + (h % 40) / 100, 2)

    rogues.push({
      id: `rogue-${site.replace(/[^A-Za-z0-9]/g, '')}-${h.toString(36)}`,
      site,
      ssid: ROGUE_SSIDS[h % ROGUE_SSIDS.length]!,
      mac: `${(h % 256).toString(16).padStart(2, '0')}:${((h >> 8) % 256)
        .toString(16)
        .padStart(2, '0')}:5E:CA:FE:${((h >> 16) % 256)
        .toString(16)
        .padStart(2, '0')}`.toUpperCase(),
      band,
      channel,
      confidence,
      security,
      severity:
        security === 'wep' ? 'critical' : confidence >= 0.8 ? 'high' : 'medium',
    })
  }

  return rogues
}

// ---------------------------------------------------------------------------
// Coverage planning
// ---------------------------------------------------------------------------

/**
 * Per-site coverage: how many APs are deployed against how many the client
 * density demands.
 */
export function coverageReport(
  devices: Device[],
  aps: WlanAccessPoint[],
  seed = 0,
): SiteCoverage[] {
  return fleetSites(devices).map((site) => {
    const clients = siteClientCount(site, seed)
    const apsDeployed = aps.filter((ap) => ap.site === site).length
    const apsRequired = Math.max(1, Math.ceil(clients / CLIENTS_PER_AP))
    const coveragePct = Math.min(
      100,
      Math.round((apsDeployed / apsRequired) * 100),
    )
    const status: SiteCoverage['status'] =
      apsDeployed === 0
        ? 'none'
        : apsDeployed < apsRequired
          ? 'partial'
          : 'covered'
    return { site, clients, apsDeployed, apsRequired, coveragePct, status }
  })
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

/** Derive RF and security findings across the wireless estate. */
export function wirelessFindings(
  aps: WlanAccessPoint[],
  rogues: RogueAp[],
  coverage: SiteCoverage[],
  ssidsBySite: Record<string, SsidProfile[]>,
): WirelessFinding[] {
  const findings: WirelessFinding[] = []

  for (const ap of aps) {
    if (ap.status === 'offline') {
      findings.push({
        id: `wf-offline-${ap.id}`,
        kind: 'ap-offline',
        severity: 'high',
        site: ap.site,
        apId: ap.id,
        apName: ap.name,
        message: `${ap.name} is offline — ${ap.clients} clients need to roam.`,
      })
    }

    for (const radio of ap.radios) {
      const cci =
        radio.band === '2.4GHz' ? radio.coChannel >= 1 : radio.coChannel >= 2
      if (cci) {
        findings.push({
          id: `wf-cci-${ap.id}-${radio.band}`,
          kind: 'co-channel-interference',
          severity: radio.band === '2.4GHz' ? 'medium' : 'low',
          site: ap.site,
          apId: ap.id,
          apName: ap.name,
          message: `${ap.name} ${BAND_LABELS[radio.band]} ch${radio.channel}: ${radio.coChannel} co-channel neighbours share airtime.`,
        })
      }
      if (radio.utilisationPct >= CONGESTION_THRESHOLD) {
        findings.push({
          id: `wf-congestion-${ap.id}-${radio.band}`,
          kind: 'congestion',
          severity: radio.utilisationPct >= 90 ? 'critical' : 'high',
          site: ap.site,
          apId: ap.id,
          apName: ap.name,
          message: `${ap.name} ${BAND_LABELS[radio.band]} ch${radio.channel} at ${radio.utilisationPct}% utilisation.`,
        })
      }
    }

    if (ap.weakClientPct > 15) {
      findings.push({
        id: `wf-weak-${ap.id}`,
        kind: 'weak-clients',
        severity: 'low',
        site: ap.site,
        apId: ap.id,
        apName: ap.name,
        message: `${ap.weakClientPct}% of ${ap.name} clients sit at or below ${WEAK_RSSI_DBM} dBm.`,
      })
    }
  }

  for (const site of coverage) {
    if (site.status === 'none') {
      findings.push({
        id: `wf-coverage-${site.site}`,
        kind: 'coverage-gap',
        severity: site.clients > 80 ? 'high' : 'medium',
        site: site.site,
        apId: null,
        apName: null,
        message: `No wireless coverage at ${site.site} — ${site.clients} clients unsupported (needs ${site.apsRequired} APs).`,
      })
    } else if (site.status === 'partial') {
      findings.push({
        id: `wf-coverage-${site.site}`,
        kind: 'coverage-gap',
        severity: 'medium',
        site: site.site,
        apId: null,
        apName: null,
        message: `${site.site} is under-deployed: ${site.apsDeployed}/${site.apsRequired} APs for ${site.clients} clients.`,
      })
    }
  }

  for (const rogue of rogues) {
    findings.push({
      id: `wf-rogue-${rogue.id}`,
      kind: 'rogue-ap',
      severity: rogue.severity,
      site: rogue.site,
      apId: null,
      apName: null,
      message: `Rogue "${rogue.ssid}" on ${rogue.site} (${BAND_LABELS[rogue.band]} ch${rogue.channel}, ${WIFI_SECURITY_LABELS[rogue.security]}) — ${Math.round(rogue.confidence * 100)}% confidence.`,
    })
  }

  for (const [site, ssids] of Object.entries(ssidsBySite)) {
    for (const ssid of ssids) {
      if (ssid.guest || ssid.security !== 'open') continue
      findings.push({
        id: `wf-insecure-${site}-${ssid.name}`,
        kind: 'insecure-ssid',
        severity: 'high',
        site,
        apId: null,
        apName: null,
        message: `SSID "${ssid.name}" broadcasts open at ${site} (VLAN ${ssid.vlan}).`,
      })
    }
    for (const ssid of ssids) {
      if (ssid.security !== 'wep') continue
      findings.push({
        id: `wf-wep-${site}-${ssid.name}`,
        kind: 'insecure-ssid',
        severity: 'critical',
        site,
        apId: null,
        apName: null,
        message: `SSID "${ssid.name}" uses broken WEP encryption at ${site}.`,
      })
    }
  }

  return findings.sort((a, b) => {
    const diff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    if (diff !== 0) return diff
    return a.id.localeCompare(b.id)
  })
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function wirelessSummary(
  aps: WlanAccessPoint[],
  rogues: RogueAp[],
  coverage: SiteCoverage[],
  findings: WirelessFinding[],
): WirelessSummary {
  const radios = aps.flatMap((ap) => ap.radios)
  const clients = aps.reduce((sum, ap) => sum + ap.clients, 0)
  const avgUtilisationPct =
    radios.length > 0
      ? round(
          radios.reduce((sum, radio) => sum + radio.utilisationPct, 0) /
            radios.length,
          1,
        )
      : 0
  const congested = radios.filter(
    (radio) => radio.utilisationPct >= CONGESTION_THRESHOLD,
  ).length
  const sitesCovered = coverage.filter((site) => site.status !== 'none').length

  let score = 100
  score -= findings.filter((f) => f.severity === 'critical').length * 12
  score -= findings.filter((f) => f.severity === 'high').length * 7
  score -= findings.filter((f) => f.severity === 'medium').length * 3
  score -= findings.filter((f) => f.severity === 'low').length * 1
  score = clamp(score, 0, 100)

  const grade: WirelessSummary['grade'] =
    score >= 85 ? 'healthy' : score >= 60 ? 'degraded' : 'critical'

  return {
    aps: aps.length,
    onlineAps: aps.filter((ap) => ap.status !== 'offline').length,
    radios: radios.length,
    clients,
    avgClientsPerAp: aps.length > 0 ? round(clients / aps.length, 1) : 0,
    avgUtilisationPct,
    congested,
    rogues: rogues.length,
    sitesCovered,
    sitesTotal: coverage.length,
    coveragePct:
      coverage.length > 0
        ? Math.round((sitesCovered / coverage.length) * 100)
        : 0,
    findings: findings.length,
    score,
    grade,
  }
}

/** Format utilisation for a card or table cell. */
export function formatRadioUtil(utilisationPct: number): string {
  return formatPct(utilisationPct, 0)
}

/** SNR helper: signal above the band's noise floor. */
export function signalToNoise(rssiDbm: number, band: Band): number {
  return Math.max(0, rssiDbm - NOISE_FLOOR[band])
}
