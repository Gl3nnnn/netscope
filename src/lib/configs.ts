import type { Device, DeviceType } from '@/types'
import { diffLines, summarizeDiff, type DiffSummary } from './configdiff'

/**
 * Synthetic device configuration snapshots and drift detection.
 *
 * Each device type has a plausible pseudo-CLI template. A deterministic hash of
 * the device id decides whether the running config has drifted from the
 * baseline, so the demo shows a realistic mix out of the box. Pure functions —
 * the caller supplies the device and any override.
 */

export interface ConfigVersion {
  id: string
  at: number
  note: string
  content: string
}

export interface DeviceConfig {
  deviceId: string
  /** The approved/reference configuration. */
  baseline: string
  /** The running configuration. */
  current: string
  versions: ConfigVersion[]
  updatedAt: number
}

/** FNV-1a style hash so drift assignment is stable per device. */
export function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const TYPE_HEADERS: Record<DeviceType, string[]> = {
  router: [
    'service timestamps debug datetime msec',
    'service password-encryption',
  ],
  firewall: [': Hardware acceleration enabled', 'set session ttl 3600'],
  switch: ['spanning-tree mode rapid-pvst', 'lldp run'],
  server: ['# managed by netscope', 'SELINUX=enforcing'],
  accessPoint: ['# wireless controller profile', 'country US'],
}

function templateFor(device: Device): string[] {
  const lines: string[] = [
    `# ${device.name} (${device.type}) — ${device.site}`,
    `hostname ${device.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    ...TYPE_HEADERS[device.type],
    '!',
  ]

  switch (device.type) {
    case 'router':
      lines.push(
        'interface GigabitEthernet0/0',
        ` ip address ${device.ip} 255.255.255.0`,
        ' no shutdown',
        '!',
        'router ospf 1',
        ' network 10.0.0.0 0.0.0.255 area 0',
        ' passive-interface default',
        '!',
        'ntp server 10.0.0.1 prefer',
        'snmp-server community public RO',
      )
      break
    case 'firewall':
      lines.push(
        'policy default-action drop',
        'rule 10 {',
        '  action accept',
        '  protocol tcp',
        '  destination port 443',
        '}',
        'rule 20 {',
        '  action drop',
        '  protocol tcp',
        '  destination port 22',
        '}',
        'ntp server 10.0.0.1',
      )
      break
    case 'switch':
      lines.push(
        'vlan 10',
        ' name users',
        'vlan 20',
        ' name servers',
        'interface GigabitEthernet0/1',
        ' switchport mode trunk',
        ' switchport trunk allowed vlan 10,20',
        '!',
        'ntp server 10.0.0.1',
      )
      break
    case 'server':
      lines.push(
        'sshd: PermitRootLogin no',
        'sshd: PasswordAuthentication no',
        'nginx: worker_processes auto',
        'nginx: listen 443 ssl',
        'sysctl net.ipv4.ip_forward=0',
        `resolv: nameserver 10.0.0.1`,
      )
      break
    case 'accessPoint':
      lines.push(
        'ssid Netscope-Corp',
        ' security wpa2-enterprise',
        ' channel 36',
        ' channel-width 80',
        ' max-clients 60',
      )
      break
  }

  lines.push('!', 'end')
  return lines
}

/** Deterministic baseline configuration for a device. */
export function baselineConfig(device: Device): string {
  return templateFor(device).join('\n')
}

/**
 * Deterministically perturb a baseline to model configuration drift. Roughly a
 * third of devices drift; the exact edit is derived from the id.
 */
export function driftConfig(
  device: Device,
  baseline = baselineConfig(device),
): string {
  const lines = baseline.split('\n')
  if (hashString(device.id) % 3 !== 0) return baseline

  const seed = hashString(`${device.id}:drift`)
  const mutation = seed % 3

  if (mutation === 0) {
    // Smuggle in an unauthorised NTP / DNS server.
    return lines
      .map((line) =>
        line.includes('ntp server')
          ? line.replace(/ntp server \S+/, 'ntp server 203.0.113.7')
          : line,
      )
      .join('\n')
  }

  if (mutation === 1) {
    // Add a stray line (e.g. a debug/telnet enable) that wasn't approved.
    const index = lines.findIndex((line) => line.trim() === 'end')
    const insertAt = index >= 0 ? index : lines.length
    const extra =
      device.type === 'server'
        ? 'sshd: PermitRootLogin yes'
        : 'service telnet enabled'
    lines.splice(insertAt, 0, extra)
    return lines.join('\n')
  }

  // Drop a hardening line.
  const removable = lines.filter(
    (line) =>
      line.includes('passive-interface') ||
      line.includes('PermitRootLogin') ||
      line.includes('PasswordAuthentication'),
  )
  const target =
    removable.length > 0
      ? removable[seed % removable.length]
      : (lines.find((line) => line.includes('ntp server')) ??
        lines[Math.floor(lines.length / 2)])
  return lines.filter((line) => line !== target).join('\n')
}

export interface DriftSummary extends DiffSummary {
  deviceId: string
  drifted: boolean
}

/** Compare a config's running state against its baseline. */
export function detectDrift(config: DeviceConfig): DriftSummary {
  const summary = summarizeDiff(diffLines(config.baseline, config.current))
  return { ...summary, deviceId: config.deviceId, drifted: summary.changed }
}

/** A freshly generated (in-memory) config for a device. */
export function generateConfig(device: Device): DeviceConfig {
  const baseline = baselineConfig(device)
  return {
    deviceId: device.id,
    baseline,
    current: driftConfig(device, baseline),
    versions: [],
    updatedAt: 0,
  }
}

/** The effective config: a stored override, or a freshly generated one. */
export function resolveConfig(
  overrides: Record<string, DeviceConfig>,
  device: Device,
): DeviceConfig {
  return overrides[device.id] ?? generateConfig(device)
}

/** Drift across a whole fleet. */
export function fleetDrift(
  devices: Device[],
  resolve: (device: Device) => DeviceConfig,
): DriftSummary[] {
  return devices.map((device) => detectDrift(resolve(device)))
}
