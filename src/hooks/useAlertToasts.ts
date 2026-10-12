import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAlertsStore } from '@/store/useAlertsStore'
import { metricMeta, type AlertInstance } from '@/lib/alerts'

function notify(instance: AlertInstance, metricLabel: string): void {
  const title = `Alert: ${instance.ruleName}`
  const description = `${instance.deviceName} - ${metricLabel} at ${instance.value}`
  if (instance.severity === 'critical') {
    toast.error(title, { description })
  } else if (instance.severity === 'high') {
    toast.warning(title, { description })
  } else {
    toast(title, { description })
  }
}

/**
 * Surface newly firing alerts as deduped sonner toasts. Alerts already firing
 * when the hook mounts (e.g. a restored session) are marked seen so the app does
 * not fire a burst of stale notifications on load. Resolved ids are forgotten so
 * a later re-fire notifies again.
 */
export function useAlertToasts(): void {
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    const initial = useAlertsStore.getState().states
    for (const instance of Object.values(initial)) {
      if (instance.status === 'firing') seen.current.add(instance.id)
    }

    const rules = useAlertsStore.getState().rules
    const metricByRule = new Map(rules.map((rule) => [rule.id, rule.metric]))

    return useAlertsStore.subscribe((state, previous) => {
      if (state.states === previous.states) return

      const firingIds = new Set<string>()
      for (const instance of Object.values(state.states)) {
        if (instance.status === 'firing') firingIds.add(instance.id)
      }
      for (const id of seen.current) {
        if (!firingIds.has(id)) seen.current.delete(id)
      }

      for (const instance of Object.values(state.states)) {
        if (instance.status !== 'firing') continue
        if (seen.current.has(instance.id)) continue
        seen.current.add(instance.id)
        const metric = metricByRule.get(instance.ruleId)
        notify(instance, metric ? metricMeta(metric).label : 'metric')
      }
    })
  }, [])
}
