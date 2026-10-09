import { useEffect } from 'react'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'

/**
 * Drives the monitoring simulation. Ensures demo data is initialized and then
 * advances the engine on the configured refresh interval.
 */
export function useSimulation(): void {
  const initialize = useNetworkStore((state) => state.initialize)
  const tick = useNetworkStore((state) => state.tick)
  const refreshIntervalMs = useSettingsStore((state) => state.refreshIntervalMs)
  const simulationRunning = useSettingsStore((state) => state.simulationRunning)

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    if (!simulationRunning) return
    const id = window.setInterval(
      () => tick(),
      Math.max(500, refreshIntervalMs),
    )
    return () => window.clearInterval(id)
  }, [tick, refreshIntervalMs, simulationRunning])
}
