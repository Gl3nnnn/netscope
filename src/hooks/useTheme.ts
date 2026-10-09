import { useEffect } from 'react'
import { useSettingsStore } from '@/store/useSettingsStore'

/** Applies the persisted theme to <html> and keeps the meta theme-color synced. */
export function useTheme(): void {
  const theme = useSettingsStore((state) => state.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.classList.toggle('light', theme === 'light')
    const meta = document.querySelector('meta[name="theme-color"]')
    meta?.setAttribute('content', theme === 'dark' ? '#0a0f1e' : '#f4f7fb')
  }, [theme])
}
