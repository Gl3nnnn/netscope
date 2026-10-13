import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

interface ComplianceState {
  /** Waiver keys from `waiverKey(ruleId, deviceId)`. */
  waivers: string[]
  waive: (key: string) => void
  unwaive: (key: string) => void
  toggleWaiver: (key: string) => void
  clearWaivers: () => void
}

interface CompliancePersisted {
  waivers: string[]
}

export const useComplianceStore = create<ComplianceState>()(
  persist(
    (set) => ({
      waivers: [],

      waive: (key) =>
        set((state) =>
          state.waivers.includes(key)
            ? state
            : { waivers: [...state.waivers, key] },
        ),

      unwaive: (key) =>
        set((state) => ({
          waivers: state.waivers.filter((entry) => entry !== key),
        })),

      toggleWaiver: (key) =>
        set((state) => ({
          waivers: state.waivers.includes(key)
            ? state.waivers.filter((entry) => entry !== key)
            : [...state.waivers, key],
        })),

      clearWaivers: () => set({ waivers: [] }),
    }),
    {
      name: 'netscope:compliance',
      version: 1,
      storage: createDebouncedStorage<CompliancePersisted>(1000),
      partialize: (state) => ({ waivers: state.waivers }),
    },
  ),
)
