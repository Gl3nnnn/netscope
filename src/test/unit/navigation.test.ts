import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, NAV_SECTIONS, SETTINGS_ITEM } from '@/config/navigation'

/** The routes that existed before the grouped-nav refactor. */
const ORIGINAL_ROUTES = [
  '/',
  '/topology',
  '/geo',
  '/tracer',
  '/planner',
  '/resilience',
  '/policy',
  '/configs',
  '/compliance',
  '/devices',
  '/services',
  '/performance',
  '/sla',
  '/incidents',
  '/alerts',
  '/explorer',
  '/monitors',
  '/notifications',
  '/oncall',
  '/automation',
  '/changes',
  '/replay',
  '/reports',
  '/assistant',
  '/timeline',
  '/settings',
]

describe('navigation config', () => {
  it('preserves every original route', () => {
    const routes = new Set(NAV_ITEMS.map((item) => item.to))
    for (const route of ORIGINAL_ROUTES) {
      expect(routes.has(route), `missing route ${route}`).toBe(true)
    }
  })

  it('has no duplicate routes across sections', () => {
    const routes = NAV_ITEMS.map((item) => item.to)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('uses unique section ids', () => {
    const ids = NAV_SECTIONS.map((section) => section.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('derives NAV_ITEMS from the sections plus the pinned settings item', () => {
    const derived = [
      ...NAV_SECTIONS.flatMap((section) => section.items),
      SETTINGS_ITEM,
    ]
      .map((item) => item.to)
      .sort()
    expect(NAV_ITEMS.map((item) => item.to).sort()).toEqual(derived)
  })

  it('includes a deep-dive section for the new features', () => {
    expect(NAV_SECTIONS.some((section) => section.id === 'deep-dive')).toBe(
      true,
    )
  })

  it('gives every section a label and icon', () => {
    for (const section of NAV_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(0)
      expect(section.icon).toBeTruthy()
    }
  })

  it('gives every item a label, route and description', () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0)
      expect(item.to.startsWith('/')).toBe(true)
      expect(item.description.length).toBeGreaterThan(0)
    }
  })
})
