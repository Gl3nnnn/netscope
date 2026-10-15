import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useNetworkStore } from '@/store/useNetworkStore'
import type { Problem } from '@/lib/correlation'

/**
 * Problem store.
 *
 * Correlated problems are recomputed from the live signal stream each render —
 * this store only persists acknowledgements (problem id → epoch ms) across
 * reloads. Acknowledging writes a real timeline event so the response is
 * visible in the audit feed.
 */

export interface ProblemState {
  /** Persisted acknowledgement timestamp per problem id. */
  acks: Record<string, number>

  acknowledge: (problem: Problem) => void
  clearAcks: () => void
}

export const useProblemStore = create<ProblemState>()(
  persist(
    (set, get) => ({
      acks: {},

      acknowledge: (problem) => {
        if (get().acks[problem.id] !== undefined) return
        set((state) => ({ acks: { ...state.acks, [problem.id]: Date.now() } }))

        const root = problem.rootCause?.deviceName ?? 'fleet'
        useNetworkStore.getState().pushEvent({
          timestamp: Date.now(),
          type: 'status',
          severity: problem.severity,
          deviceId: problem.rootCause?.deviceId,
          message: `Problem acknowledged: ${problem.title} — ${problem.members.length} correlated signals (root cause ${root}, ${(problem.confidence * 100).toFixed(0)}% confidence).`,
        })
      },

      clearAcks: () => set({ acks: {} }),
    }),
    {
      name: 'netscope:problems',
      version: 1,
      storage: createDebouncedStorage<{ acks: Record<string, number> }>(1000),
      partialize: (state) => ({ acks: state.acks }),
    },
  ),
)
