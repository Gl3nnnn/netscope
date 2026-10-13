import type { Device, DeviceType } from '@/types'
import { selectorMatches, type PolicyRule } from './policy'

/**
 * Compliance & hardening audit.
 *
 * A dependency-free rule engine that grades the fleet against a mash-up of
 * hardening benchmarks (config hygiene), segmentation policy, device health and
 * inventory hygiene. Each rule is a pure predicate over a device, its running
 * config text and the firewall policy, so the whole audit is deterministic and
 * unit-testable. Rules can be **waived** per device with a documented exception.
 */

export type ComplianceCategory =
  'hardening' | 'segmentation' | 'availability' | 'hygiene'

export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low'

export type ComplianceStatus = 'pass' | 'fail' | 'waived' | 'na'

export const COMPLIANCE_CATEGORY_LABELS: Record<ComplianceCategory, string> = {
  hardening: 'Hardening',
  segmentation: 'Segmentation',
  availability: 'Availability',
  hygiene: 'Hygiene',
}

export const COMPLIANCE_SEVERITY_LABELS: Record<ComplianceSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export const COMPLIANCE_SEVERITY_WEIGHT: Record<ComplianceSeverity, number> = {
  critical: 8,
  high: 4,
  medium: 2,
  low: 1,
}

export interface RuleContext {
  device: Device
  /** The device's running configuration text. */
  config: string
  policyRules: PolicyRule[]
}

export interface ComplianceRule {
  id: string
  title: string
  category: ComplianceCategory
  severity: ComplianceSeverity
  description: string
  recommendation: string
  /** Device types the rule applies to; omitted means every type. */
  types?: DeviceType[]
  /** Returns true when the device complies. */
  check: (ctx: RuleContext) => boolean
  /** Optional human-readable evidence for the finding. */
  detail?: (ctx: RuleContext) => string
}

const LEGACY_REMOTE_PORTS = [23, 21, 3389]

function legacyRemoteAllowed(ctx: RuleContext): boolean {
  return ctx.policyRules.some(
    (rule) =>
      rule.enabled &&
      rule.action === 'allow' &&
      (rule.proto === 'tcp' || rule.proto === 'any') &&
      (rule.port === 0 || LEGACY_REMOTE_PORTS.includes(rule.port)) &&
      selectorMatches(rule.dst, ctx.device),
  )
}

/** The built-in benchmark packs, evaluated top-to-bottom per device. */
export const COMPLIANCE_RULES: ComplianceRule[] = [
  {
    id: 'hardening-no-telnet',
    title: 'Disable legacy telnet',
    category: 'hardening',
    severity: 'high',
    description: 'Cleartext telnet must not be enabled on managed devices.',
    recommendation: 'Remove any telnet service lines and require SSH.',
    check: (ctx) => !/telnet/i.test(ctx.config),
  },
  {
    id: 'hardening-passwords-encrypted',
    title: 'Encrypt stored passwords',
    category: 'hardening',
    severity: 'medium',
    description: 'The device should encrypt credentials in its configuration.',
    recommendation: "Enable 'service password-encryption'.",
    types: ['router'],
    check: (ctx) => ctx.config.includes('service password-encryption'),
  },
  {
    id: 'hardening-ssh-root-disabled',
    title: 'Block direct root SSH',
    category: 'hardening',
    severity: 'critical',
    description: 'Remote root logins must be refused on servers.',
    recommendation: "Set 'PermitRootLogin no'.",
    types: ['server'],
    check: (ctx) =>
      /PermitRootLogin\s+no/i.test(ctx.config) &&
      !/PermitRootLogin\s+yes/i.test(ctx.config),
    detail: () => 'Direct root SSH is permitted.',
  },
  {
    id: 'hardening-ssh-password-auth-off',
    title: 'Require key-based SSH',
    category: 'hardening',
    severity: 'high',
    description: 'Password authentication should be disabled on servers.',
    recommendation: "Set 'PasswordAuthentication no'.",
    types: ['server'],
    check: (ctx) => /PasswordAuthentication\s+no/i.test(ctx.config),
  },
  {
    id: 'hardening-ntp-configured',
    title: 'Configure time synchronisation',
    category: 'hardening',
    severity: 'low',
    description: 'Devices should sync time to a trusted NTP server.',
    recommendation: "Add an 'ntp server' entry pointing at an internal source.",
    types: ['router', 'switch', 'firewall'],
    check: (ctx) => ctx.config.includes('ntp server'),
  },
  {
    id: 'hardening-snmp-default-community',
    title: 'Remove default SNMP community',
    category: 'hardening',
    severity: 'high',
    description: "The 'public' community string is a well-known default.",
    recommendation: 'Replace with an SNMPv3 user and remove community strings.',
    types: ['router'],
    check: (ctx) => !/community\s+public/i.test(ctx.config),
  },
  {
    id: 'hardening-forwarding-disabled',
    title: 'Disable IP forwarding',
    category: 'hardening',
    severity: 'medium',
    description: 'Servers should not route traffic between networks.',
    recommendation: "Set 'net.ipv4.ip_forward=0'.",
    types: ['server'],
    check: (ctx) => /ip_forward\s*=\s*0/.test(ctx.config),
  },
  {
    id: 'hardening-firewall-default-drop',
    title: 'Firewall default-deny',
    category: 'hardening',
    severity: 'critical',
    description: 'The firewall must drop traffic that matches no rule.',
    recommendation: "Set 'policy default-action drop'.",
    types: ['firewall'],
    check: (ctx) => /default-action\s+drop/i.test(ctx.config),
  },
  {
    id: 'hardening-wireless-enterprise',
    title: 'Enterprise wireless security',
    category: 'hardening',
    severity: 'high',
    description: 'Wireless SSIDs should use WPA2/WPA3 enterprise.',
    recommendation: 'Move the SSID to WPA2/WPA3 enterprise authentication.',
    types: ['accessPoint'],
    check: (ctx) => /wpa2-enterprise|wpa3/i.test(ctx.config),
  },
  {
    id: 'segmentation-no-legacy-remote',
    title: 'No legacy remote access',
    category: 'segmentation',
    severity: 'high',
    description: 'No allow rule should expose telnet, FTP or RDP to a device.',
    recommendation:
      'Remove allow rules for ports 23/21/3389 or scope them narrowly.',
    check: (ctx) => !legacyRemoteAllowed(ctx),
    detail: () => 'A policy allow rule exposes a legacy remote-access port.',
  },
  {
    id: 'availability-device-healthy',
    title: 'Device healthy',
    category: 'availability',
    severity: 'high',
    description: 'Managed devices should be online and not degraded.',
    recommendation: 'Restore the device to a healthy state.',
    check: (ctx) => ctx.device.status === 'online',
    detail: (ctx) => `Device status is ${ctx.device.status}.`,
  },
  {
    id: 'hygiene-site-assigned',
    title: 'Site assigned',
    category: 'hygiene',
    severity: 'low',
    description: 'Every device should belong to a known site.',
    recommendation: 'Assign the device to a site.',
    check: (ctx) => ctx.device.site.trim().length > 0,
  },
]

export interface Finding {
  ruleId: string
  ruleTitle: string
  category: ComplianceCategory
  severity: ComplianceSeverity
  deviceId: string
  deviceName: string
  site: string
  status: ComplianceStatus
  detail: string
  recommendation: string
}

export interface RuleSummary {
  ruleId: string
  title: string
  category: ComplianceCategory
  severity: ComplianceSeverity
  pass: number
  fail: number
  waived: number
  total: number
}

export interface DeviceSummary {
  deviceId: string
  deviceName: string
  site: string
  pass: number
  fail: number
  waived: number
  score: number
}

export type ComplianceGrade =
  'compliant' | 'at-risk' | 'non-compliant' | 'critical'

export const COMPLIANCE_GRADE_LABELS: Record<ComplianceGrade, string> = {
  compliant: 'Compliant',
  'at-risk': 'At risk',
  'non-compliant': 'Non-compliant',
  critical: 'Critical',
}

export function complianceGrade(score: number): ComplianceGrade {
  if (score >= 90) return 'compliant'
  if (score >= 75) return 'at-risk'
  if (score >= 55) return 'non-compliant'
  return 'critical'
}

export interface ComplianceReport {
  score: number
  grade: ComplianceGrade
  findings: Finding[]
  failures: Finding[]
  pass: number
  fail: number
  waived: number
  /** Failing findings counted by severity, weighted for risk scoring. */
  bySeverity: Record<ComplianceSeverity, number>
  byCategory: Record<ComplianceCategory, RuleSummary>
  ruleSummaries: RuleSummary[]
  deviceSummaries: DeviceSummary[]
}

export interface ComplianceInput {
  devices: Device[]
  /** Running configuration text for a device. */
  configFor: (device: Device) => string
  policyRules: PolicyRule[]
  /** Waiver keys from `waiverKey(ruleId, deviceId)`. */
  waivers?: Set<string>
}

export function waiverKey(ruleId: string, deviceId: string): string {
  return `${ruleId}:${deviceId}`
}

function applies(rule: ComplianceRule, device: Device): boolean {
  return !rule.types || rule.types.includes(device.type)
}

/** Run the audit across the fleet. */
export function evaluateCompliance(input: ComplianceInput): ComplianceReport {
  const waivers = input.waivers ?? new Set<string>()
  const findings: Finding[] = []

  for (const device of input.devices) {
    const config = input.configFor(device)
    const ctx: RuleContext = { device, config, policyRules: input.policyRules }
    for (const rule of COMPLIANCE_RULES) {
      let status: ComplianceStatus
      if (!applies(rule, device)) {
        status = 'na'
      } else if (waivers.has(waiverKey(rule.id, device.id))) {
        status = 'waived'
      } else {
        status = rule.check(ctx) ? 'pass' : 'fail'
      }
      findings.push({
        ruleId: rule.id,
        ruleTitle: rule.title,
        category: rule.category,
        severity: rule.severity,
        deviceId: device.id,
        deviceName: device.name,
        site: device.site,
        status,
        detail:
          status === 'fail' ? (rule.detail?.(ctx) ?? rule.description) : '',
        recommendation: rule.recommendation,
      })
    }
  }

  const failures = findings.filter((finding) => finding.status === 'fail')
  const pass = findings.filter((finding) => finding.status === 'pass').length
  const fail = failures.length
  const waived = findings.filter(
    (finding) => finding.status === 'waived',
  ).length
  const assessed = pass + fail
  const score = assessed === 0 ? 100 : Math.round((pass / assessed) * 100)

  const bySeverity: Record<ComplianceSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const failure of failures) bySeverity[failure.severity] += 1

  const ruleSummaries: RuleSummary[] = COMPLIANCE_RULES.map((rule) => {
    const ruleFindings = findings.filter(
      (finding) => finding.ruleId === rule.id,
    )
    return {
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      severity: rule.severity,
      pass: ruleFindings.filter((finding) => finding.status === 'pass').length,
      fail: ruleFindings.filter((finding) => finding.status === 'fail').length,
      waived: ruleFindings.filter((finding) => finding.status === 'waived')
        .length,
      total: ruleFindings.filter((finding) => finding.status !== 'na').length,
    }
  })

  const byCategory = {} as Record<ComplianceCategory, RuleSummary>
  for (const category of [
    'hardening',
    'segmentation',
    'availability',
    'hygiene',
  ] as ComplianceCategory[]) {
    const rules = ruleSummaries.filter(
      (summary) => summary.category === category,
    )
    byCategory[category] = {
      ruleId: category,
      title: COMPLIANCE_CATEGORY_LABELS[category],
      category,
      severity: 'low',
      pass: rules.reduce((sum, summary) => sum + summary.pass, 0),
      fail: rules.reduce((sum, summary) => sum + summary.fail, 0),
      waived: rules.reduce((sum, summary) => sum + summary.waived, 0),
      total: rules.reduce((sum, summary) => sum + summary.total, 0),
    }
  }

  const deviceSummaries: DeviceSummary[] = input.devices
    .map((device) => {
      const deviceFindings = findings.filter(
        (finding) => finding.deviceId === device.id,
      )
      const devicePass = deviceFindings.filter(
        (finding) => finding.status === 'pass',
      ).length
      const deviceFail = deviceFindings.filter(
        (finding) => finding.status === 'fail',
      ).length
      const deviceWaived = deviceFindings.filter(
        (finding) => finding.status === 'waived',
      ).length
      const deviceAssessed = devicePass + deviceFail
      return {
        deviceId: device.id,
        deviceName: device.name,
        site: device.site,
        pass: devicePass,
        fail: deviceFail,
        waived: deviceWaived,
        score:
          deviceAssessed === 0
            ? 100
            : Math.round((devicePass / deviceAssessed) * 100),
      }
    })
    .sort(
      (a, b) =>
        b.fail - a.fail ||
        a.score - b.score ||
        a.deviceId.localeCompare(b.deviceId),
    )

  return {
    score,
    grade: complianceGrade(score),
    findings,
    failures,
    pass,
    fail,
    waived,
    bySeverity,
    byCategory,
    ruleSummaries,
    deviceSummaries,
  }
}

/** Weighted risk score (higher is worse) for the failing findings. */
export function complianceRisk(report: ComplianceReport): number {
  return (
    report.bySeverity.critical * COMPLIANCE_SEVERITY_WEIGHT.critical +
    report.bySeverity.high * COMPLIANCE_SEVERITY_WEIGHT.high +
    report.bySeverity.medium * COMPLIANCE_SEVERITY_WEIGHT.medium +
    report.bySeverity.low * COMPLIANCE_SEVERITY_WEIGHT.low
  )
}

export const COMPLIANCE_STATUS_LABELS: Record<ComplianceStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  waived: 'Waived',
  na: 'N/A',
}
