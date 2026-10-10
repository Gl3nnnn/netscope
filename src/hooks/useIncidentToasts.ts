import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useNetworkStore } from '@/store/useNetworkStore'
import type { Incident } from '@/types'

function notify(incident: Incident): void {
  const description = `${incident.deviceIds.length} device(s) - ${incident.severity} severity`
  const title = `New incident: ${incident.title}`
  if (incident.severity === 'critical') {
    toast.error(title, { description })
  } else if (incident.severity === 'high') {
    toast.warning(title, { description })
  } else {
    toast(title, { description })
  }
}

/**
 * Surfaces newly opened incidents as deduped sonner toasts. Incidents already
 * present when the hook mounts (e.g. a restored backup) are marked as seen so
 * the app does not fire a burst of stale notifications on load.
 */
export function useIncidentToasts(): void {
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const incident of useNetworkStore.getState().incidents) {
      seen.current.add(incident.id)
    }
    return useNetworkStore.subscribe((state, previous) => {
      if (state.incidents === previous.incidents) return
      for (const incident of state.incidents) {
        if (incident.status === 'resolved') continue
        if (seen.current.has(incident.id)) continue
        seen.current.add(incident.id)
        notify(incident)
      }
    })
  }, [])
}
