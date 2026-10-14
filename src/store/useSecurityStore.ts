import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useNetworkStore } from '@/store/useNetworkStore'
import {
  TECHNIQUES,
  withDisposition,
  type Disposition,
  type SecurityEvent,
} from '@/lib/security'

/**
 * Security Operations store.
 *
 * Holds the current detection set (recomputed each tick from the live fleet)
 * plus operator dispositions, which persist across reloads. Containment also
 * raises a real timeline event so the finding surfaces in the War Room feed.
 */

export interface SecurityState {
  /** Latest detections for the current tick (not persisted). */
  events: SecurityEvent[]
  /** Persisted disposition per event id. */
  dispositions: Record<string, Disposition>

  setEvents: (events: SecurityEvent[]) => void
  setDisposition: (id: string, disposition: Disposition) => void
  reset: () => void
}

export const useSecurityStore = create<SecurityState>()(
  persist(
    (set, get) => ({
      events: [],
      dispositions: {},

      setEvents: (events) => {
        const dispositions = get().dispositions
        set({
          events: events.map((event) =>
            dispositions[event.id]
              ? { ...event, disposition: dispositions[event.id] }
              : event,
          ),
        })
      },

      setDisposition: (id, disposition) => {
        set((state) => ({
          dispositions: { ...state.dispositions, [id]: disposition },
          events: withDisposition(state.events, id, disposition),
        }))

        // Containment is an operational action — record it on the timeline.
        if (disposition === 'contained') {
          const event = get().events.find((item) => item.id === id)
          if (event) {
            const meta = TECHNIQUES[event.technique]
            useNetworkStore.getState().pushEvent({
              timestamp: Date.now(),
              type: 'incident',
              severity: meta.severity,
              deviceId: event.deviceId,
              message: `Security: contained ${meta.label} (${meta.mitre}) on ${event.deviceName}.`,
            })
          }
        }
      },

      reset: () => set({ events: [], dispositions: {} }),
    }),
    {
      name: 'netscope:security',
      version: 1,
      storage: createDebouncedStorage<{
        dispositions: Record<string, Disposition>
      }>(1000),
      partialize: (state) => ({ dispositions: state.dispositions }),
    },
  ),
)

/** Convenience action used by the page to contain a finding. */
export function containFinding(id: string): void {
  useSecurityStore.getState().setDisposition(id, 'contained')
}
