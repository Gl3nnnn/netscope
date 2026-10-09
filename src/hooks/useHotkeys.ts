import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store/useSettingsStore'

export interface HotkeyHandlers {
  onOpenPalette: () => void
  onOpenHelp: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

/**
 * Global keyboard shortcuts:
 * - Ctrl/Cmd + K : open the command palette (works even while typing)
 * - ?            : show the shortcuts help dialog
 * - t            : toggle light/dark theme
 * - p            : pause / resume the simulation
 */
export function useHotkeys(handlers: HotkeyHandlers): void {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  }, [handlers])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ((event.metaKey || event.ctrlKey) && key === 'k') {
        event.preventDefault()
        ref.current.onOpenPalette()
        return
      }
      if (isTypingTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === '?') {
        event.preventDefault()
        ref.current.onOpenHelp()
      } else if (key === 't') {
        useSettingsStore.getState().toggleTheme()
      } else if (key === 'p') {
        useSettingsStore.getState().toggleSimulation()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
