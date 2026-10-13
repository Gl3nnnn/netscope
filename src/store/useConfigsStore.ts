import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Device } from '@/types'
import { createId } from '@/lib/id'
import {
  generateConfig,
  type ConfigVersion,
  type DeviceConfig,
} from '@/lib/configs'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

const MAX_VERSIONS = 30

interface ConfigsState {
  /** Per-device overrides; devices without an entry use a generated config. */
  overrides: Record<string, DeviceConfig>
  /** Replace the running config, recording the previous state as a version. */
  updateConfig: (device: Device, content: string, note?: string) => void
  /** Approve the running config as the new baseline (clears drift). */
  acceptBaseline: (device: Device) => void
  /** Restore a previous version into the running config. */
  rollback: (device: Device, versionId: string) => void
  /** Forget the override and fall back to the generated config. */
  resetDevice: (deviceId: string) => void
  clearAll: () => void
}

interface ConfigsPersisted {
  overrides: Record<string, DeviceConfig>
}

function current(device: Device, overrides: Record<string, DeviceConfig>) {
  return overrides[device.id] ?? generateConfig(device)
}

export const useConfigsStore = create<ConfigsState>()(
  persist(
    (set, get) => ({
      overrides: {},

      updateConfig: (device, content, note = 'Manual edit') => {
        const base = current(device, get().overrides)
        const version: ConfigVersion = {
          id: createId('cfg'),
          at: Date.now(),
          note,
          content: base.current,
        }
        const next: DeviceConfig = {
          ...base,
          current: content,
          versions: [version, ...base.versions].slice(0, MAX_VERSIONS),
          updatedAt: Date.now(),
        }
        set((state) => ({
          overrides: { ...state.overrides, [device.id]: next },
        }))
      },

      acceptBaseline: (device) => {
        const base = current(device, get().overrides)
        const next: DeviceConfig = {
          ...base,
          baseline: base.current,
          updatedAt: Date.now(),
        }
        set((state) => ({
          overrides: { ...state.overrides, [device.id]: next },
        }))
      },

      rollback: (device, versionId) => {
        const base = current(device, get().overrides)
        const version = base.versions.find((entry) => entry.id === versionId)
        if (!version) return
        const snapshot: ConfigVersion = {
          id: createId('cfg'),
          at: Date.now(),
          note: `Rolled back to ${version.note}`,
          content: base.current,
        }
        const next: DeviceConfig = {
          ...base,
          current: version.content,
          versions: [snapshot, ...base.versions].slice(0, MAX_VERSIONS),
          updatedAt: Date.now(),
        }
        set((state) => ({
          overrides: { ...state.overrides, [device.id]: next },
        }))
      },

      resetDevice: (deviceId) =>
        set((state) => {
          const next = { ...state.overrides }
          delete next[deviceId]
          return { overrides: next }
        }),

      clearAll: () => set({ overrides: {} }),
    }),
    {
      name: 'netscope:configs',
      version: 1,
      storage: createDebouncedStorage<ConfigsPersisted>(1000),
      partialize: (state) => ({ overrides: state.overrides }),
    },
  ),
)
