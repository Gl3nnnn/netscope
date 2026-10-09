import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

const MAX_READ_IDS = 500

interface NotificationsPersisted {
  readIds: string[]
}

interface NotificationsState {
  /** Incident ids the user has already seen/caught up on. */
  readIds: string[]
  markRead: (id: string) => void
  markManyRead: (ids: string[]) => void
  clearRead: () => void
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set) => ({
      readIds: [],
      markRead: (id) =>
        set((state) =>
          state.readIds.includes(id)
            ? state
            : { readIds: [id, ...state.readIds].slice(0, MAX_READ_IDS) },
        ),
      markManyRead: (ids) =>
        set((state) => {
          const merged = new Set([...ids, ...state.readIds])
          return { readIds: [...merged].slice(0, MAX_READ_IDS) }
        }),
      clearRead: () => set({ readIds: [] }),
    }),
    {
      name: 'netscope:notifications',
      version: 1,
      storage: createDebouncedStorage<NotificationsPersisted>(1000),
      partialize: (state) => ({ readIds: state.readIds }),
    },
  ),
)
