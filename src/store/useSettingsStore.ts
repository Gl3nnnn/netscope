import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Settings, Thresholds } from '@/types'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { STORAGE_VERSION } from '@/storage/persistence'

export const DEFAULT_THRESHOLDS: Thresholds = {
  latencyMs: 60,
  packetLossPct: 2,
  availabilityPct: 99,
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  refreshIntervalMs: 5000,
  simulationSpeed: 1,
  simulationRunning: true,
  incidentFrequency: 0.6,
  thresholds: { ...DEFAULT_THRESHOLDS },
  sidebarCollapsed: false,
  navSectionsOpen: {},
  maxHistoryPoints: 120,
}

export const REFRESH_OPTIONS = [2000, 5000, 10000, 30000] as const
export const SPEED_OPTIONS = [0.5, 1, 2, 5] as const

interface SettingsState extends Settings {
  setTheme: (theme: Settings['theme']) => void
  toggleTheme: () => void
  setRefreshInterval: (ms: number) => void
  setSimulationSpeed: (speed: number) => void
  setSimulationRunning: (running: boolean) => void
  toggleSimulation: () => void
  setIncidentFrequency: (frequency: number) => void
  setThreshold: (key: keyof Thresholds, value: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setNavSectionOpen: (id: string, open: boolean) => void
  setMaxHistoryPoints: (points: number) => void
  resetSettings: () => void
}

function toPersisted(state: SettingsState): Settings {
  return {
    theme: state.theme,
    refreshIntervalMs: state.refreshIntervalMs,
    simulationSpeed: state.simulationSpeed,
    simulationRunning: state.simulationRunning,
    incidentFrequency: state.incidentFrequency,
    thresholds: { ...state.thresholds },
    sidebarCollapsed: state.sidebarCollapsed,
    navSectionsOpen: { ...state.navSectionsOpen },
    maxHistoryPoints: state.maxHistoryPoints,
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setRefreshInterval: (refreshIntervalMs) => set({ refreshIntervalMs }),
      setSimulationSpeed: (simulationSpeed) => set({ simulationSpeed }),
      setSimulationRunning: (simulationRunning) => set({ simulationRunning }),
      toggleSimulation: () =>
        set({ simulationRunning: !get().simulationRunning }),
      setIncidentFrequency: (incidentFrequency) =>
        set({ incidentFrequency: Math.min(1, Math.max(0, incidentFrequency)) }),
      setThreshold: (key, value) =>
        set({ thresholds: { ...get().thresholds, [key]: value } }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setNavSectionOpen: (id, open) =>
        set({ navSectionsOpen: { ...get().navSectionsOpen, [id]: open } }),
      setMaxHistoryPoints: (maxHistoryPoints) =>
        set({
          maxHistoryPoints: Math.min(600, Math.max(10, maxHistoryPoints)),
        }),
      resetSettings: () =>
        set({
          ...DEFAULT_SETTINGS,
          thresholds: { ...DEFAULT_THRESHOLDS },
          navSectionsOpen: {},
        }),
    }),
    {
      name: 'netscope:settings',
      version: STORAGE_VERSION,
      storage: createDebouncedStorage<Settings>(1000),
      partialize: (state) => toPersisted(state),
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<Settings>
        return {
          ...DEFAULT_SETTINGS,
          ...p,
          thresholds: { ...DEFAULT_THRESHOLDS, ...(p.thresholds ?? {}) },
          navSectionsOpen: p.navSectionsOpen ?? {},
        }
      },
    },
  ),
)
