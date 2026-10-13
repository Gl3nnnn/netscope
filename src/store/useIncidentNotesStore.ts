import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from '@/lib/id'
import type { IncidentNote } from '@/lib/warroom'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

const MAX_NOTES = 300

interface IncidentNotesState {
  notes: IncidentNote[]
  addNote: (incidentId: string, body: string, author?: string) => void
  deleteNote: (id: string) => void
  clearIncident: (incidentId: string) => void
}

interface NotesPersisted {
  notes: IncidentNote[]
}

export const useIncidentNotesStore = create<IncidentNotesState>()(
  persist(
    (set) => ({
      notes: [],

      addNote: (incidentId, body, author = 'You') => {
        const trimmed = body.trim()
        if (!trimmed) return
        const note: IncidentNote = {
          id: createId('note'),
          incidentId,
          at: Date.now(),
          author,
          body: trimmed,
        }
        set((state) => ({ notes: [...state.notes, note].slice(-MAX_NOTES) }))
      },

      deleteNote: (id) =>
        set((state) => ({
          notes: state.notes.filter((note) => note.id !== id),
        })),

      clearIncident: (incidentId) =>
        set((state) => ({
          notes: state.notes.filter((note) => note.incidentId !== incidentId),
        })),
    }),
    {
      name: 'netscope:warroom',
      version: 1,
      storage: createDebouncedStorage<NotesPersisted>(1000),
      partialize: (state) => ({ notes: state.notes }),
    },
  ),
)
