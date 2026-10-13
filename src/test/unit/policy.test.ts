import { describe, expect, it } from 'vitest'
import type { Device } from '@/types'
import {
  analyzeRules,
  describeRule,
  evaluatePolicy,
  ruleCovers,
  ruleMatches,
  selectorMatches,
  DEFAULT_POLICY,
  type PolicyRule,
} from '@/lib/policy'

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
    throughputMbps: 100,
    capacityMbps: 1000,
    cpuPct: 10,
    memoryPct: 20,
    uptimeSec: 1000,
    lastSeen: 0,
    ...overrides,
  }
}

function rule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'r1',
    order: 0,
    action: 'allow',
    src: '*',
    dst: '*',
    port: 0,
    proto: 'any',
    enabled: true,
    ...overrides,
  }
}

const SERVER = device({
  id: 'srv',
  name: 'Server',
  type: 'server',
  site: 'DC-A',
})
const SERVER2 = device({
  id: 'srv2',
  name: 'Server 2',
  type: 'server',
  site: 'DC-A',
})
const ROUTER = device({ id: 'rt', name: 'Router', type: 'router', site: 'HQ' })

describe('selectorMatches', () => {
  it('matches wildcard, id, site and type', () => {
    expect(selectorMatches('*', SERVER)).toBe(true)
    expect(selectorMatches('srv', SERVER)).toBe(true)
    expect(selectorMatches('DC-A', SERVER)).toBe(true)
    expect(selectorMatches('server', SERVER)).toBe(true)
    expect(selectorMatches('router', SERVER)).toBe(false)
  })
})

describe('ruleMatches / evaluatePolicy', () => {
  it('honours port, proto, selectors and enabled flag', () => {
    const r = rule({ port: 443, proto: 'tcp', dst: 'server' })
    expect(
      ruleMatches(r, { src: ROUTER, dst: SERVER, port: 443, proto: 'tcp' }),
    ).toBe(true)
    expect(
      ruleMatches(r, { src: ROUTER, dst: SERVER, port: 80, proto: 'tcp' }),
    ).toBe(false)
    expect(
      ruleMatches(r, { src: ROUTER, dst: SERVER, port: 443, proto: 'udp' }),
    ).toBe(false)
    expect(
      ruleMatches(
        { ...r, enabled: false },
        { src: ROUTER, dst: SERVER, port: 443, proto: 'tcp' },
      ),
    ).toBe(false)
  })

  it('first match wins and defaults to deny', () => {
    const rules = [
      rule({
        id: 'a',
        order: 0,
        action: 'deny',
        dst: 'server',
        port: 22,
        proto: 'tcp',
      }),
      rule({ id: 'b', order: 1, action: 'allow', dst: 'server' }),
    ]
    const denied = evaluatePolicy(rules, {
      src: ROUTER,
      dst: SERVER,
      port: 22,
      proto: 'tcp',
    })
    expect(denied.action).toBe('deny')
    expect(denied.rule?.id).toBe('a')
    const allowed = evaluatePolicy(rules, {
      src: ROUTER,
      dst: SERVER,
      port: 443,
      proto: 'tcp',
    })
    expect(allowed.action).toBe('allow')
    expect(allowed.rule?.id).toBe('b')
    const none = evaluatePolicy([], {
      src: ROUTER,
      dst: SERVER,
      port: 443,
      proto: 'tcp',
    })
    expect(none).toEqual({ action: 'deny', rule: null })
  })
})

describe('describeRule / ruleCovers', () => {
  it('describes a rule', () => {
    expect(
      describeRule(
        rule({
          action: 'deny',
          src: 'HQ',
          dst: 'server',
          port: 22,
          proto: 'tcp',
        }),
      ),
    ).toBe('Deny HQ → server on port 22 TCP')
    expect(describeRule(rule({ action: 'allow' }))).toBe(
      'Allow * → * on any port',
    )
  })

  it('detects coverage', () => {
    expect(ruleCovers(rule({ src: '*' }), rule({ src: 'HQ' }))).toBe(true)
    expect(ruleCovers(rule({ port: 0 }), rule({ port: 443 }))).toBe(true)
    expect(ruleCovers(rule({ port: 443 }), rule({ port: 0 }))).toBe(false)
    expect(ruleCovers(rule({ proto: 'tcp' }), rule({ proto: 'any' }))).toBe(
      false,
    )
  })
})

describe('analyzeRules', () => {
  it('flags a deny shadowed by an earlier broader deny', () => {
    const rules = [
      rule({ id: 'broad', order: 0, action: 'deny', port: 0, proto: 'any' }),
      rule({ id: 'narrow', order: 1, action: 'deny', port: 22, proto: 'tcp' }),
    ]
    const issues = analyzeRules(rules, [SERVER, ROUTER])
    const issue = issues.find((i) => i.ruleId === 'narrow')
    expect(issue?.kind).toBe('redundant')
    expect(issue?.byRuleId).toBe('broad')
  })

  it('flags a rule shadowed by an earlier differing action', () => {
    const rules = [
      rule({ id: 'denyall', order: 0, action: 'deny', port: 0, proto: 'any' }),
      rule({ id: 'allowx', order: 1, action: 'allow', port: 80, proto: 'tcp' }),
    ]
    const issues = analyzeRules(rules, [SERVER, ROUTER])
    expect(issues.find((i) => i.ruleId === 'allowx')?.kind).toBe('shadowed')
  })

  it('flags rules that match no inventory pair', () => {
    const rules = [
      rule({ id: 'ghost', src: 'site-nowhere', dst: 'site-nowhere' }),
    ]
    const issues = analyzeRules(rules, [SERVER, ROUTER])
    expect(issues.find((i) => i.ruleId === 'ghost')?.kind).toBe('unused')
  })

  it('leaves a clean default policy issue-free', () => {
    const rules = DEFAULT_POLICY.map((r, index) => ({ ...r, id: `r${index}` }))
    expect(analyzeRules(rules, [SERVER, SERVER2, ROUTER])).toHaveLength(0)
  })
})
