import { describe, expect, it } from 'vitest'
import type { Device, DeviceType } from '@/types'
import {
  COMPLIANCE_RULES,
  complianceGrade,
  complianceRisk,
  evaluateCompliance,
  waiverKey,
} from '@/lib/compliance'
import type { PolicyRule } from '@/lib/policy'

function device(
  id: string,
  type: DeviceType,
  overrides: Partial<Device> = {},
): Device {
  return {
    id,
    name: `${type}-${id}`,
    type,
    site: 'HQ',
    ip: `10.0.0.${id}`,
    mac: 'aa:bb:cc:dd:ee:ff',
    status: 'online',
    tags: [],
    latencyMs: 10,
    packetLossPct: 0.1,
    availabilityPct: 99.9,
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 30,
    memoryPct: 40,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

const CONFIGS: Record<DeviceType, string> = {
  router:
    'hostname r\nservice password-encryption\ninterface g0/0\nntp server 10.0.0.1\nsnmp-server community netscope RO\nend',
  server:
    'sshd: PermitRootLogin no\nsshd: PasswordAuthentication no\nsysctl net.ipv4.ip_forward=0\n',
  firewall: 'policy default-action drop\nntp server 10.0.0.1\n',
  accessPoint: 'ssid CORP\n security wpa2-enterprise\n',
  switch: 'spanning-tree mode rapid-pvst\nntp server 10.0.0.1\n',
}

const CONFIG_FOR = (item: Device) => CONFIGS[item.type]

function compliantFleet(): Device[] {
  return [
    device('1', 'router'),
    device('2', 'server'),
    device('3', 'firewall'),
    device('4', 'accessPoint'),
    device('5', 'switch'),
  ]
}

describe('evaluateCompliance', () => {
  it('scores a compliant fleet at 100', () => {
    const report = evaluateCompliance({
      devices: compliantFleet(),
      configFor: CONFIG_FOR,
      policyRules: [],
    })
    expect(report.score).toBe(100)
    expect(report.grade).toBe('compliant')
    expect(report.fail).toBe(0)
  })

  it('flags a missing hardening control and an offline device', () => {
    const devices = [device('2', 'server', { status: 'offline' })]
    const report = evaluateCompliance({
      devices,
      configFor: () => 'sshd: PasswordAuthentication no\n',
      policyRules: [],
    })
    const root = report.findings.find(
      (finding) => finding.ruleId === 'hardening-ssh-root-disabled',
    )
    expect(root?.status).toBe('fail')
    expect(root?.severity).toBe('critical')
    const health = report.findings.find(
      (finding) => finding.ruleId === 'availability-device-healthy',
    )
    expect(health?.status).toBe('fail')
    expect(report.bySeverity.critical).toBeGreaterThanOrEqual(1)
  })

  it('marks rules that do not apply to a type as N/A', () => {
    const report = evaluateCompliance({
      devices: [device('4', 'accessPoint')],
      configFor: CONFIG_FOR,
      policyRules: [],
    })
    const serverOnly = report.findings.find(
      (finding) => finding.ruleId === 'hardening-ssh-root-disabled',
    )
    expect(serverOnly?.status).toBe('na')
  })

  it('honours waivers without counting them as failures', () => {
    const devices = [device('1', 'router')]
    const report = evaluateCompliance({
      devices,
      configFor: () => 'hostname r\nend\n',
      policyRules: [],
      waivers: new Set([waiverKey('hardening-snmp-default-community', '1')]),
    })
    const finding = report.findings.find(
      (entry) => entry.ruleId === 'hardening-snmp-default-community',
    )
    expect(finding?.status).toBe('waived')
    expect(report.waived).toBe(1)
  })

  it('fails segmentation when a legacy remote port is allowed', () => {
    const rules: PolicyRule[] = [
      {
        id: 'r1',
        order: 0,
        action: 'allow',
        src: '*',
        dst: '*',
        port: 23,
        proto: 'tcp',
        enabled: true,
      },
    ]
    const report = evaluateCompliance({
      devices: [device('1', 'router')],
      configFor: CONFIG_FOR,
      policyRules: rules,
    })
    const finding = report.findings.find(
      (entry) => entry.ruleId === 'segmentation-no-legacy-remote',
    )
    expect(finding?.status).toBe('fail')
  })

  it('ranks the worst devices first', () => {
    const report = evaluateCompliance({
      devices: [
        device('1', 'router'),
        device('2', 'server', { status: 'offline' }),
      ],
      configFor: (item) => CONFIGS[item.type],
      policyRules: [],
    })
    expect(report.deviceSummaries[0].fail).toBeGreaterThan(0)
    expect(report.deviceSummaries[0].deviceId).toBe('2')
  })

  it('reports per-category and per-rule rollups', () => {
    const report = evaluateCompliance({
      devices: compliantFleet(),
      configFor: CONFIG_FOR,
      policyRules: [],
    })
    const total = report.ruleSummaries.reduce(
      (sum, summary) => sum + summary.pass,
      0,
    )
    expect(total).toBe(report.pass)
    expect(report.byCategory.segmentation.pass).toBe(5)
    expect(report.findings.length).toBeGreaterThan(0)
  })
})

describe('complianceGrade', () => {
  it('maps scores onto grades', () => {
    expect(complianceGrade(95)).toBe('compliant')
    expect(complianceGrade(80)).toBe('at-risk')
    expect(complianceGrade(60)).toBe('non-compliant')
    expect(complianceGrade(20)).toBe('critical')
  })
})

describe('complianceRisk', () => {
  it('weights failures by severity', () => {
    const report = evaluateCompliance({
      devices: [device('2', 'server', { status: 'offline' })],
      configFor: () => '',
      policyRules: [],
    })
    expect(complianceRisk(report)).toBeGreaterThan(0)
  })
})

describe('COMPLIANCE_RULES', () => {
  it('ships a balanced set of rule packs', () => {
    expect(COMPLIANCE_RULES.length).toBeGreaterThanOrEqual(10)
    const categories = new Set(COMPLIANCE_RULES.map((rule) => rule.category))
    expect(categories).toEqual(
      new Set(['hardening', 'segmentation', 'availability', 'hygiene']),
    )
  })
})
