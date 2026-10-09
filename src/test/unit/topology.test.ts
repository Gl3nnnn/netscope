import { describe, expect, it } from 'vitest'
import {
  deriveLinks,
  focusGroup,
  type TopoLink,
} from '@/components/topology/topology'
import type { Device } from '@/types'

const links: TopoLink[] = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'd', target: 'b' },
]

describe('focusGroup', () => {
  it('includes the focused node and its one-hop neighbours', () => {
    const group = focusGroup(['a', 'b', 'c', 'd'], links, 'b')
    expect(group.has('b')).toBe(true)
    expect(group.has('a')).toBe(true)
    expect(group.has('c')).toBe(true)
    expect(group.has('d')).toBe(true)
    expect(group.has('a')).toBe(true)
  })

  it('does not include two-hop neighbours', () => {
    const group = focusGroup(
      ['a', 'b', 'c', 'd', 'e'],
      [...links, { source: 'c', target: 'e' }],
      'b',
    )
    expect(group.has('e')).toBe(false)
  })

  it('filters ids that are not present in the node list', () => {
    const group = focusGroup(['b', 'd'], links, 'b')
    expect(group.has('a')).toBe(false)
    expect(group.has('d')).toBe(true)
  })
})

describe('deriveLinks', () => {
  const device = (id: string, type: Device['type'], site: string): Device =>
    ({
      id,
      type,
      site,
    }) as unknown as Device

  it('connects site devices to a hub and hubs to the core', () => {
    const links = deriveLinks([
      device('r1', 'router', 'HQ'),
      device('s1', 'switch', 'HQ'),
      device('s2', 'switch', 'Branch'),
    ])
    const keys = links
      .map((link) => [link.source, link.target].sort().join('|'))
      .sort()
    expect(keys).toEqual(['r1|s1', 'r1|s2'])
  })

  it('returns no links for a single device', () => {
    expect(deriveLinks([device('r1', 'router', 'HQ')])).toEqual([])
  })
})
