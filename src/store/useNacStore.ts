import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useNetworkStore } from '@/store/useNetworkStore'
import type { Endpoint } from '@/lib/nac'

/**
 * NAC store.
 *
 * The endpoint estate is regenerated from the live fleet on every render —
 * this store only persists operator quarantine decisions across reloads.
 * Every action writes a real timeline event so access changes show up in the
 * audit feed and the War Room.
 */

export interface NacState {
  /** Persisted endpoint ids quarantined by the operator. */
  quarantined: string[]

  quarantine: (endpoint: Endpoint) => void
  release: (id: string) => void
  /** Clear all quarantine decisions (simulates a fresh RADIUS sync). */
  sync: () => void
}

export const useNacStore = create<NacState>()(
  persist(
    (set, get) => ({
      quarantined: [],

      quarantine: (endpoint) => {
        if (get().quarantined.includes(endpoint.id)) return
        set((state) => ({
          quarantined: [...state.quarantined, endpoint.id],
        }))
        useNetworkStore.getState().pushEvent({
          timestamp: Date.now(),
          type: 'device',
          severity: 'high',
          deviceId: endpoint.deviceId,
          message: `Endpoint ${endpoint.mac} (${endpoint.kind}) quarantined on ${endpoint.deviceName} — posture/auth violation.`,
        })
      },

      release: (id) => {
        if (!get().quarantined.includes(id)) return
        set((state) => ({
          quarantined: state.quarantined.filter((item) => item !== id),
        }))
        useNetworkStore.getState().pushEvent({
          timestamp: Date.now(),
          type: 'device',
          severity: 'low',
          deviceId: '',
          message: `Endpoint ${id} released from quarantine and returned to the data VLAN.`,
        })
      },

      sync: () => set({ quarantined: [] }),
    }),
    {
      name: 'netscope:nac',
      version: 1,
      storage: createDebouncedStorage<{ quarantined: string[] }>(1000),
      partialize: (state) => ({ quarantined: state.quarantined }),
    },
  ),
)
