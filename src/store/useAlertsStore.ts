import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Device } from '@/types'
import { createId } from '@/lib/id'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import {
  DEFAULT_RULES,
  evaluateAlerts,
  type AlertChange,
  type AlertInstance,
  type AlertRule,
} from '@/lib/alerts'

const MAX_HISTORY = 200

interface AlertsState {
  rules: AlertRule[]
  enabled: boolean
  /** Live (pending + firing) alert states keyed by instance id. */
  states: Record<string, AlertInstance>
  /** Recently resolved alerts, newest first. */
  history: AlertInstance[]
  lastEvalAt: number
  addRule: (rule: Omit<AlertRule, 'id'>) => AlertRule
  updateRule: (id: string, patch: Partial<Omit<AlertRule, 'id'>>) => void
  deleteRule: (id: string) => void
  resetRules: () => void
  setEnabled: (enabled: boolean) => void
  evaluate: (input: { devices: Device[]; now: number }) => AlertChange[]
  clearHistory: () => void
}

interface AlertsPersisted {
  rules: AlertRule[]
  enabled: boolean
}

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set, get) => ({
      rules: DEFAULT_RULES.map((rule) => ({ ...rule })),
      enabled: true,
      states: {},
      history: [],
      lastEvalAt: 0,

      addRule: (rule) => {
        const created: AlertRule = { ...rule, id: createId('rule') }
        set((state) => ({ rules: [...state.rules, created] }))
        return created
      },

      updateRule: (id, patch) =>
        set((state) => ({
          rules: state.rules.map((rule) =>
            rule.id === id ? { ...rule, ...patch } : rule,
          ),
        })),

      deleteRule: (id) =>
        set((state) => {
          const states: Record<string, AlertInstance> = {}
          for (const [key, instance] of Object.entries(state.states)) {
            if (instance.ruleId !== id) states[key] = instance
          }
          return {
            rules: state.rules.filter((rule) => rule.id !== id),
            states,
          }
        }),

      resetRules: () => set({ rules: DEFAULT_RULES.map((r) => ({ ...r })) }),

      setEnabled: (enabled) =>
        set((state) =>
          enabled
            ? { enabled }
            : { enabled, states: {}, history: state.history },
        ),

      evaluate: ({ devices, now }) => {
        const { rules, enabled, states } = get()
        if (!enabled) return []
        const result = evaluateAlerts({ devices, rules, states, now })
        const resolved = result.changes
          .filter((change) => change.kind === 'resolved')
          .map((change) => ({ ...change.instance, resolvedAt: now }))
        set((state) => ({
          states: result.states,
          lastEvalAt: now,
          history:
            resolved.length > 0
              ? [...resolved, ...state.history].slice(0, MAX_HISTORY)
              : state.history,
        }))
        return result.changes
      },

      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'netscope:alerts',
      version: 1,
      storage: createDebouncedStorage<AlertsPersisted>(1000),
      partialize: (state) => ({ rules: state.rules, enabled: state.enabled }),
    },
  ),
)

export { DEFAULT_RULES }
