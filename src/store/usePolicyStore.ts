import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from '@/lib/id'
import { DEFAULT_POLICY, type PolicyRule } from '@/lib/policy'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

interface PolicyState {
  rules: PolicyRule[]
  addRule: (input: Partial<Omit<PolicyRule, 'id'>>) => PolicyRule
  updateRule: (id: string, patch: Partial<Omit<PolicyRule, 'id'>>) => void
  deleteRule: (id: string) => void
  toggleRule: (id: string) => void
  /** Move a rule up (-1) or down (+1) in evaluation order. */
  moveRule: (id: string, direction: -1 | 1) => void
  resetPolicy: () => void
}

interface PolicyPersisted {
  rules: PolicyRule[]
}

function seed(): PolicyRule[] {
  return DEFAULT_POLICY.map((rule) => ({ ...rule, id: createId('pr') }))
}

/** Rewrite `order` to match array position. */
function reindex(rules: PolicyRule[]): PolicyRule[] {
  return rules.map((rule, index) => ({ ...rule, order: index }))
}

export const usePolicyStore = create<PolicyState>()(
  persist(
    (set) => ({
      rules: seed(),

      addRule: (input) => {
        const created: PolicyRule = {
          id: createId('pr'),
          order: 0,
          action: 'allow',
          src: '*',
          dst: '*',
          port: 0,
          proto: 'any',
          enabled: true,
          ...input,
        }
        set((state) => ({ rules: reindex([...state.rules, created]) }))
        return created
      },

      updateRule: (id, patch) =>
        set((state) => ({
          rules: state.rules.map((rule) =>
            rule.id === id ? { ...rule, ...patch } : rule,
          ),
        })),

      deleteRule: (id) =>
        set((state) => ({
          rules: reindex(state.rules.filter((rule) => rule.id !== id)),
        })),

      toggleRule: (id) =>
        set((state) => ({
          rules: state.rules.map((rule) =>
            rule.id === id ? { ...rule, enabled: !rule.enabled } : rule,
          ),
        })),

      moveRule: (id, direction) =>
        set((state) => {
          const index = state.rules.findIndex((rule) => rule.id === id)
          const target = index + direction
          if (index < 0 || target < 0 || target >= state.rules.length) {
            return state
          }
          const next = [...state.rules]
          const [item] = next.splice(index, 1)
          next.splice(target, 0, item)
          return { rules: reindex(next) }
        }),

      resetPolicy: () => set({ rules: seed() }),
    }),
    {
      name: 'netscope:policy',
      version: 1,
      storage: createDebouncedStorage<PolicyPersisted>(1000),
      partialize: (state) => ({ rules: state.rules }),
    },
  ),
)
