import type { PersistStorage, StorageValue } from 'zustand/middleware'

/**
 * A zustand `persist` storage that coalesces writes to localStorage.
 *
 * The simulation mutates devices on every tick; without throttling that would
 * hammer localStorage. Writes are debounced and flushed on `beforeunload`, so
 * persistence stays cheap while remaining durable across reloads.
 */
export function createDebouncedStorage<S>(delayMs = 1500): PersistStorage<S> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { name: string; value: string } | null = null

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (pending && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(pending.name, pending.value)
      } catch {
        // Storage may be full or disabled (private mode); fail silently.
      }
      pending = null
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush)
  }

  return {
    getItem: (name) => {
      if (typeof localStorage === 'undefined') return null
      const raw = localStorage.getItem(name)
      if (!raw) return null
      try {
        return JSON.parse(raw) as StorageValue<S>
      } catch {
        return null
      }
    },
    setItem: (name, value) => {
      pending = { name, value: JSON.stringify(value) }
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    removeItem: (name) => {
      pending = null
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (typeof localStorage !== 'undefined') localStorage.removeItem(name)
    },
  }
}
