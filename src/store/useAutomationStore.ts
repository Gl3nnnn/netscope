import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Device } from '@/types'
import type { AlertInstance } from '@/lib/alerts'
import {
  DEFAULT_PLAYBOOKS,
  maintenanceTargets,
  planAutomation,
  withRunKeys,
  type MaintenanceWindow,
  type Playbook,
  type PlaybookRun,
} from '@/lib/playbooks'
import { createId } from '@/lib/id'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

const MAX_RUNS = 60

interface AutomationState {
  playbooks: Playbook[]
  windows: MaintenanceWindow[]
  enabled: boolean
  /** Recent playbook executions, newest first (ephemeral). */
  runs: PlaybookRun[]
  /** Last run epoch per `${playbookId}:${deviceId}` (ephemeral). */
  lastRunByKey: Record<string, number>
  addPlaybook: (input: Omit<Playbook, 'id'>) => Playbook
  updatePlaybook: (id: string, patch: Partial<Omit<Playbook, 'id'>>) => void
  deletePlaybook: (id: string) => void
  togglePlaybook: (id: string) => void
  resetPlaybooks: () => void
  addWindow: (input: Omit<MaintenanceWindow, 'id'>) => MaintenanceWindow
  updateWindow: (
    id: string,
    patch: Partial<Omit<MaintenanceWindow, 'id'>>,
  ) => void
  deleteWindow: (id: string) => void
  setEnabled: (enabled: boolean) => void
  clearRuns: () => void
  plan: (input: {
    devices: Device[]
    alerts: AlertInstance[]
    now: number
  }) => PlaybookRun[]
  maintenanceTargets: (devices: Device[], now: number) => string[]
}

interface AutomationPersisted {
  playbooks: Playbook[]
  windows: MaintenanceWindow[]
  enabled: boolean
}

export const useAutomationStore = create<AutomationState>()(
  persist(
    (set, get) => ({
      playbooks: DEFAULT_PLAYBOOKS.map((playbook) => ({ ...playbook })),
      windows: [],
      enabled: true,
      runs: [],
      lastRunByKey: {},

      addPlaybook: (input) => {
        const created: Playbook = { ...input, id: createId('pb') }
        set((state) => ({ playbooks: [...state.playbooks, created] }))
        return created
      },

      updatePlaybook: (id, patch) =>
        set((state) => ({
          playbooks: state.playbooks.map((playbook) =>
            playbook.id === id ? { ...playbook, ...patch } : playbook,
          ),
        })),

      deletePlaybook: (id) =>
        set((state) => ({
          playbooks: state.playbooks.filter((playbook) => playbook.id !== id),
        })),

      togglePlaybook: (id) =>
        set((state) => ({
          playbooks: state.playbooks.map((playbook) =>
            playbook.id === id
              ? { ...playbook, enabled: !playbook.enabled }
              : playbook,
          ),
        })),

      resetPlaybooks: () =>
        set({
          playbooks: DEFAULT_PLAYBOOKS.map((playbook) => ({ ...playbook })),
        }),

      addWindow: (input) => {
        const created: MaintenanceWindow = { ...input, id: createId('win') }
        set((state) => ({ windows: [...state.windows, created] }))
        return created
      },

      updateWindow: (id, patch) =>
        set((state) => ({
          windows: state.windows.map((window) =>
            window.id === id ? { ...window, ...patch } : window,
          ),
        })),

      deleteWindow: (id) =>
        set((state) => ({
          windows: state.windows.filter((window) => window.id !== id),
        })),

      setEnabled: (enabled) => set({ enabled }),

      clearRuns: () => set({ runs: [] }),

      plan: ({ devices, alerts, now }) => {
        const { playbooks, windows, lastRunByKey, enabled } = get()
        if (!enabled) return []
        const runs = planAutomation(playbooks, {
          now,
          devices,
          alerts,
          windows,
          lastRunByKey,
        })
        if (runs.length === 0) return []
        set((state) => ({
          runs: [...runs, ...state.runs].slice(0, MAX_RUNS),
          lastRunByKey: withRunKeys(state.lastRunByKey, runs),
        }))
        return runs
      },

      maintenanceTargets: (devices, now) =>
        maintenanceTargets(get().windows, devices, now),
    }),
    {
      name: 'netscope:automation',
      version: 1,
      storage: createDebouncedStorage<AutomationPersisted>(1000),
      partialize: (state) => ({
        playbooks: state.playbooks,
        windows: state.windows,
        enabled: state.enabled,
      }),
    },
  ),
)
