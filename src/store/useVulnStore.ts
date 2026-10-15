import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useNetworkStore } from '@/store/useNetworkStore'
import type { Severity } from '@/types'
import type { Vulnerability, VulnStatus } from '@/lib/vulnerabilities'

/**
 * Vulnerability store.
 *
 * Findings are rescanned from the live fleet every render — this store only
 * persists operator dispositions (patched / accepted risk / reopened) across
 * reloads. Remediation writes a real timeline event so patches show up in the
 * audit feed and the War Room.
 */

export interface VulnState {
  /** Persisted disposition per finding id (`${deviceId}:${cveId}`). */
  dispositions: Record<string, VulnStatus>

  applyStatus: (vuln: Vulnerability, status: VulnStatus) => void
  /** Clear all dispositions (simulates a fresh credentialed rescan). */
  rescan: () => void
}

function timelineSeverity(severity: Severity): Severity {
  return severity === 'critical' ? 'medium' : 'low'
}

export const useVulnStore = create<VulnState>()(
  persist(
    (set, get) => ({
      dispositions: {},

      applyStatus: (vuln, status) => {
        const current = get().dispositions[vuln.id] ?? 'open'
        if (current === status) return

        set((state) => ({
          dispositions: { ...state.dispositions, [vuln.id]: status },
        }))

        const push = useNetworkStore.getState().pushEvent
        if (status === 'patched') {
          push({
            timestamp: Date.now(),
            type: 'config',
            severity: timelineSeverity(vuln.severity),
            deviceId: vuln.deviceId,
            message: `Patch applied on ${vuln.deviceName}: ${vuln.cveId} (${vuln.title}).`,
          })
        } else if (status === 'accepted') {
          push({
            timestamp: Date.now(),
            type: 'config',
            severity: timelineSeverity(vuln.severity),
            deviceId: vuln.deviceId,
            message: `Risk accepted on ${vuln.deviceName}: ${vuln.cveId} (no patch scheduled).`,
          })
        } else if (current !== 'open') {
          push({
            timestamp: Date.now(),
            type: 'config',
            severity: 'medium',
            deviceId: vuln.deviceId,
            message: `Finding reopened on ${vuln.deviceName}: ${vuln.cveId}.`,
          })
        }
      },

      rescan: () => set({ dispositions: {} }),
    }),
    {
      name: 'netscope:vulns',
      version: 1,
      storage: createDebouncedStorage<{
        dispositions: Record<string, VulnStatus>
      }>(1000),
      partialize: (state) => ({ dispositions: state.dispositions }),
    },
  ),
)

/** Convenience action used by the page to patch a finding. */
export function patchFinding(vuln: Vulnerability): void {
  useVulnStore.getState().applyStatus(vuln, 'patched')
}
