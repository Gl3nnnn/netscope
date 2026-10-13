import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId, seededId } from '@/lib/id'
import {
  transitionChange,
  type ChangeRequest,
  type ChangeStatus,
  type ChangeTransitionResult,
} from '@/lib/changes'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

export type ChangeDraft = Omit<
  ChangeRequest,
  'id' | 'createdAt' | 'updatedAt' | 'status'
> & { status?: ChangeStatus }

interface ChangesState {
  changes: ChangeRequest[]
  addChange: (draft: ChangeDraft, now: number) => ChangeRequest
  updateChange: (id: string, patch: Partial<ChangeRequest>) => void
  transition: (
    id: string,
    to: ChangeStatus,
    options: { now: number; actor?: string },
  ) => ChangeTransitionResult | null
  deleteChange: (id: string) => void
  resetChanges: () => void
}

interface ChangesPersisted {
  changes: ChangeRequest[]
}

function seed(now: number): ChangeRequest[] {
  const draft = (
    title: string,
    description: string,
    type: ChangeRequest['type'],
    status: ChangeStatus,
    deviceNumbers: number[],
    dayOffset: number,
    requestedBy: string,
  ): ChangeRequest => {
    const start = now + dayOffset * 3_600_000
    return {
      id: createId('chg'),
      title,
      description,
      type,
      status,
      deviceIds: deviceNumbers.map((n) => seededId('dev', n)),
      siteNames: [],
      plannedStart: start,
      plannedEnd: start + 2 * 3_600_000,
      requestedBy,
      createdAt: now - 86_400_000,
      updatedAt: now - 3_600_000,
    }
  }

  return [
    draft(
      'Firewall firmware upgrade',
      'Stage the vendor firmware on the perimeter pair and fail over.',
      'normal',
      'review',
      [1, 2],
      1,
      'Network Engineering',
    ),
    draft(
      'Add VLAN for new floor',
      'Provision VLAN 30 and trunk uplinks at HQ.',
      'standard',
      'scheduled',
      [8, 9],
      2,
      'Network Engineering',
    ),
    draft(
      'Emergency TLS certificate rotation',
      'Rotate the expiring cert on the public load balancer.',
      'emergency',
      'closed',
      [14, 15],
      -2,
      'Platform',
    ),
    draft(
      'Core switch stack replacement',
      'Replace the end-of-life stack at Data Center A.',
      'normal',
      'draft',
      [20, 21],
      5,
      'Infrastructure',
    ),
  ]
}

export const useChangeStore = create<ChangesState>()(
  persist(
    (set, get) => ({
      changes: [],

      addChange: (draft, now) => {
        const created: ChangeRequest = {
          ...draft,
          id: createId('chg'),
          status: draft.status ?? 'draft',
          createdAt: now,
          updatedAt: now,
        }
        set((state) => ({ changes: [created, ...state.changes] }))
        return created
      },

      updateChange: (id, patch) =>
        set((state) => ({
          changes: state.changes.map((change) =>
            change.id === id ? { ...change, ...patch } : change,
          ),
        })),

      transition: (id, to, options) => {
        const current = get().changes.find((change) => change.id === id)
        if (!current) return null
        const result = transitionChange(current, to, options)
        if (result.ok) {
          set((state) => ({
            changes: state.changes.map((change) =>
              change.id === id ? result.change : change,
            ),
          }))
        }
        return result
      },

      deleteChange: (id) =>
        set((state) => ({
          changes: state.changes.filter((change) => change.id !== id),
        })),

      resetChanges: () => set({ changes: seed(Date.now()) }),
    }),
    {
      name: 'netscope:changes',
      version: 1,
      storage: createDebouncedStorage<ChangesPersisted>(1000),
      partialize: (state) => ({ changes: state.changes }),
      onRehydrateStorage: () => (state) => {
        if (state && state.changes.length === 0) {
          state.resetChanges()
        }
      },
    },
  ),
)
