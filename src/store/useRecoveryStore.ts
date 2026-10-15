import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useChangeStore } from '@/store/useChangeStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import {
  runDrill,
  type BackupJob,
  type DrillRecord,
  type RecoveryOverrides,
  type RestoreTest,
} from '@/lib/recovery'

/**
 * Recovery store.
 *
 * The backup estate is regenerated from the fleet on every render — this store
 * only persists operator overrides (forced status) and the drill history across
 * reloads. Every drill files a CAB change and writes a timeline event so DR
 * exercises show up in the audit feed and the War Room.
 */

export interface RecoveryState {
  /** Persisted operator patches keyed by backup job id. */
  overrides: RecoveryOverrides
  /** Completed DR drills, newest first (capped). */
  drills: DrillRecord[]

  /** Run a DR drill across P1/P2 jobs; files a CAB change. */
  drill: (
    jobs: BackupJob[],
    tests: RestoreTest[],
    now: number,
  ) => DrillRecord | null
  /** Force a job's status (simulates an operator acknowledging a failure). */
  forceStatus: (jobId: string, status: BackupJob['status']) => void
  /** Clear overrides and drill history (fresh DR programme). */
  reset: () => void
}

const MAX_DRILLS = 10

export const useRecoveryStore = create<RecoveryState>()(
  persist(
    (set) => ({
      overrides: {},
      drills: [],

      drill: (jobs, tests, now) => {
        if (jobs.length === 0) return null
        const record = runDrill(jobs, tests, now)
        set((state) => ({
          drills: [record, ...state.drills].slice(0, MAX_DRILLS),
        }))

        const change = useChangeStore.getState().addChange(
          {
            title: `DR drill — ${record.jobsTested} critical backup jobs`,
            description: `Simulated restore of all P1/P2 backup jobs. ${record.jobsPassed} met their RTO targets, ${record.rtoBreaches} breached. ${record.note}`,
            type: 'standard',
            deviceIds: [],
            siteNames: [],
            plannedStart: now,
            plannedEnd: now + 3_600_000,
            requestedBy: 'Resilience Team',
            status: 'closed',
            note: record.note,
          },
          now,
        )

        useNetworkStore.getState().pushEvent({
          timestamp: now,
          type: 'config',
          severity: record.rtoBreaches > 0 ? 'high' : 'low',
          deviceId: '',
          message: `DR drill complete: ${record.jobsPassed}/${record.jobsTested} restores within RTO — change ${change.id}.`,
        })

        return record
      },

      forceStatus: (jobId, status) =>
        set((state) => ({
          overrides: {
            ...state.overrides,
            [jobId]: { ...state.overrides[jobId], status },
          },
        })),

      reset: () => set({ overrides: {}, drills: [] }),
    }),
    {
      name: 'netscope:recovery',
      version: 1,
      storage: createDebouncedStorage<{
        overrides: RecoveryOverrides
        drills: DrillRecord[]
      }>(1000),
      partialize: (state) => ({
        overrides: state.overrides,
        drills: state.drills,
      }),
    },
  ),
)
