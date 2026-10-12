import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Device } from '@/types'
import { createId } from '@/lib/id'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import {
  runCheck,
  trimChecks,
  type Monitor,
  type MonitorCheck,
  type NewMonitorInput,
} from '@/lib/monitors'

export const DEFAULT_MONITORS: Monitor[] = [
  {
    id: 'monitor_global',
    name: 'Global availability',
    target: 'fleet',
    targetId: null,
    intervalMs: 10_000,
    latencyThresholdMs: 120,
    lossThresholdPct: 5,
    enabled: true,
    lastCheckedAt: 0,
  },
  {
    id: 'monitor_hq',
    name: 'HQ network edge',
    target: 'site',
    targetId: 'HQ',
    intervalMs: 10_000,
    latencyThresholdMs: 150,
    lossThresholdPct: 5,
    enabled: true,
    lastCheckedAt: 0,
  },
]

interface MonitorsState {
  monitors: Monitor[]
  checks: Record<string, MonitorCheck[]>
  lastRunAt: number
  addMonitor: (input: NewMonitorInput) => Monitor
  updateMonitor: (id: string, patch: Partial<Omit<Monitor, 'id'>>) => void
  deleteMonitor: (id: string) => void
  resetMonitors: () => void
  runAll: (devices: Device[], now: number) => number
  clearChecks: (id?: string) => void
}

interface MonitorsPersisted {
  monitors: Monitor[]
}

export const useMonitorsStore = create<MonitorsState>()(
  persist(
    (set) => ({
      monitors: DEFAULT_MONITORS.map((monitor) => ({ ...monitor })),
      checks: {},
      lastRunAt: 0,

      addMonitor: (input) => {
        const monitor: Monitor = {
          ...input,
          id: createId('mon'),
          enabled: true,
          lastCheckedAt: 0,
        }
        set((state) => ({ monitors: [...state.monitors, monitor] }))
        return monitor
      },

      updateMonitor: (id, patch) =>
        set((state) => ({
          monitors: state.monitors.map((monitor) =>
            monitor.id === id ? { ...monitor, ...patch } : monitor,
          ),
        })),

      deleteMonitor: (id) =>
        set((state) => {
          const checks = { ...state.checks }
          delete checks[id]
          return { monitors: state.monitors.filter((m) => m.id !== id), checks }
        }),

      resetMonitors: () =>
        set({
          monitors: DEFAULT_MONITORS.map((m) => ({ ...m })),
          checks: {},
        }),

      runAll: (devices, now) => {
        let ran = 0
        set((state) => {
          let nextChecks = state.checks
          const nextMonitors = state.monitors.map((monitor) => {
            if (!monitor.enabled) return monitor
            if (now - monitor.lastCheckedAt < monitor.intervalMs) return monitor
            const result = runCheck({ monitor, devices, now })
            if (!result) return monitor
            ran += 1
            const history = trimChecks([
              ...(nextChecks[monitor.id] ?? []),
              result,
            ])
            if (nextChecks === state.checks) {
              nextChecks = { ...state.checks, [monitor.id]: history }
            } else {
              nextChecks = { ...nextChecks, [monitor.id]: history }
            }
            return { ...monitor, lastCheckedAt: now }
          })
          return { monitors: nextMonitors, checks: nextChecks, lastRunAt: now }
        })
        return ran
      },

      clearChecks: (id) =>
        set((state) => {
          if (id) {
            const checks = { ...state.checks, [id]: [] }
            return { checks }
          }
          return { checks: {} }
        }),
    }),
    {
      name: 'netscope:monitors',
      version: 1,
      storage: createDebouncedStorage<MonitorsPersisted>(1000),
      partialize: (state) => ({ monitors: state.monitors }),
    },
  ),
)
