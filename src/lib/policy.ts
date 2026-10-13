import type { Device } from '@/types'

/**
 * Firewall / ACL policy model.
 *
 * A policy is an ordered list of allow/deny rules over selectors. A selector
 * matches a device by its id, site, type, or the `*`/`any` wildcard. Rules are
 * evaluated top-down and the first match wins; if nothing matches the flow is
 * denied (default-deny). Pure and inventory-agnostic so it can be unit tested.
 */

export type PolicyAction = 'allow' | 'deny'
export type PolicyProto = 'tcp' | 'udp' | 'icmp' | 'any'

export interface PolicyRule {
  id: string
  /** Evaluation order; lower runs first. */
  order: number
  action: PolicyAction
  /** Source selector: device id, site, type, or `*`. */
  src: string
  /** Destination selector. */
  dst: string
  /** Port, or 0 for any. */
  port: number
  proto: PolicyProto
  enabled: boolean
  note?: string
}

export interface Flow {
  src: Device
  dst: Device
  port: number
  proto: Exclude<PolicyProto, 'any'>
}

export interface PolicyDecision {
  action: PolicyAction
  /** The rule that matched, or null when the default-deny applies. */
  rule: PolicyRule | null
}

export const ANY_SELECTORS = new Set(['*', 'any', ''])

/** Does a selector match a device (by id, site, type or wildcard)? */
export function selectorMatches(selector: string, device: Device): boolean {
  const value = selector.trim()
  if (ANY_SELECTORS.has(value)) return true
  return value === device.id || value === device.site || value === device.type
}

/** Does a rule match a concrete flow? */
export function ruleMatches(rule: PolicyRule, flow: Flow): boolean {
  if (!rule.enabled) return false
  if (!selectorMatches(rule.src, flow.src)) return false
  if (!selectorMatches(rule.dst, flow.dst)) return false
  if (rule.port !== 0 && rule.port !== flow.port) return false
  if (rule.proto !== 'any' && rule.proto !== flow.proto) return false
  return true
}

function byOrder(a: PolicyRule, b: PolicyRule): number {
  return a.order - b.order || a.id.localeCompare(b.id)
}

/** Evaluate a flow against the policy (first match wins; default deny). */
export function evaluatePolicy(
  rules: PolicyRule[],
  flow: Flow,
): PolicyDecision {
  for (const rule of [...rules].sort(byOrder)) {
    if (ruleMatches(rule, flow)) return { action: rule.action, rule }
  }
  return { action: 'deny', rule: null }
}

export const PROTO_LABELS: Record<PolicyProto, string> = {
  tcp: 'TCP',
  udp: 'UDP',
  icmp: 'ICMP',
  any: 'Any',
}

export const ACTION_LABELS: Record<PolicyAction, string> = {
  allow: 'Allow',
  deny: 'Deny',
}

/** Human-readable one-line rule description. */
export function describeRule(rule: PolicyRule): string {
  const port = rule.port === 0 ? 'any port' : `port ${rule.port}`
  const proto = rule.proto === 'any' ? '' : ` ${PROTO_LABELS[rule.proto]}`
  return `${ACTION_LABELS[rule.action]} ${rule.src} → ${rule.dst} on ${port}${proto}`
}

/** Does `outer` fully cover `inner` (so `inner` could never add anything)? */
export function ruleCovers(outer: PolicyRule, inner: PolicyRule): boolean {
  const sel = (a: string, b: string) =>
    ANY_SELECTORS.has(a.trim()) || a.trim() === b.trim()
  return (
    sel(outer.src, inner.src) &&
    sel(outer.dst, inner.dst) &&
    (outer.port === 0 || outer.port === inner.port) &&
    (outer.proto === 'any' || outer.proto === inner.proto)
  )
}

export type PolicyIssueKind = 'shadowed' | 'redundant' | 'unused'

export interface PolicyIssue {
  kind: PolicyIssueKind
  ruleId: string
  /** The earlier rule responsible, when applicable. */
  byRuleId?: string
  message: string
}

/**
 * Static analysis of a policy:
 * - `shadowed`: a rule that can never match because an earlier, broader rule
 *   with a different action already handles those flows,
 * - `redundant`: a rule made irrelevant by an earlier rule with the same action,
 * - `unused`: a rule whose selectors match no device pair in the inventory.
 */
export function analyzeRules(
  rules: PolicyRule[],
  devices: Device[],
): PolicyIssue[] {
  const issues: PolicyIssue[] = []
  const sorted = [...rules].sort(byOrder)
  const enabled = sorted.filter((rule) => rule.enabled)

  for (const rule of enabled) {
    const earlier = enabled.filter(
      (other) => other !== rule && byOrder(other, rule) < 0,
    )
    const cover = earlier.find((other) => ruleCovers(other, rule))
    if (cover) {
      issues.push({
        kind: cover.action === rule.action ? 'redundant' : 'shadowed',
        ruleId: rule.id,
        byRuleId: cover.id,
        message:
          cover.action === rule.action
            ? `Rule is redundant: "${describeRule(cover)}" already covers it.`
            : `Rule can never match: "${describeRule(cover)}" shadows it.`,
      })
      continue
    }

    const matchesAny = devices.some((src) =>
      devices.some(
        (dst) =>
          src.id !== dst.id &&
          selectorMatches(rule.src, src) &&
          selectorMatches(rule.dst, dst),
      ),
    )
    if (!matchesAny) {
      issues.push({
        kind: 'unused',
        ruleId: rule.id,
        message: 'Rule matches no device pair in the current inventory.',
      })
    }
  }

  return issues
}

/** A sensible starter policy shipped with the demo (default-deny after). */
export const DEFAULT_POLICY: Omit<PolicyRule, 'id'>[] = [
  {
    order: 0,
    action: 'allow',
    src: '*',
    dst: 'server',
    port: 443,
    proto: 'tcp',
    enabled: true,
    note: 'Published HTTPS to servers',
  },
  {
    order: 1,
    action: 'allow',
    src: 'server',
    dst: 'server',
    port: 5432,
    proto: 'tcp',
    enabled: true,
    note: 'Database replication',
  },
  {
    order: 2,
    action: 'allow',
    src: '*',
    dst: '*',
    port: 0,
    proto: 'icmp',
    enabled: true,
    note: 'ICMP monitoring',
  },
  {
    order: 3,
    action: 'deny',
    src: '*',
    dst: 'server',
    port: 22,
    proto: 'tcp',
    enabled: true,
    note: 'Block SSH to servers',
  },
]
