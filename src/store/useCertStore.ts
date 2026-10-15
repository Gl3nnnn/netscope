import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useChangeStore } from '@/store/useChangeStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import {
  ISSUER_LABELS,
  renewCertificate,
  type CertOverrides,
  type Certificate,
} from '@/lib/certificates'

/**
 * Certificate store.
 *
 * The inventory is reseeded from the fleet each render — this store only
 * persists renewal overrides (new expiry / reissue date) across reloads.
 * Every renewal files a real CAB change request (emergency when the cert is
 * already expired) and writes a timeline event.
 */

export interface CertState {
  /** Persisted renewal patches keyed by certificate id. */
  overrides: CertOverrides

  /** Renew a certificate: +365 d validity, CAB change filed. */
  renew: (cert: Certificate, now: number) => void
  /** Discard all overrides (simulates a fresh inventory scan). */
  resetInventory: () => void
}

export const useCertStore = create<CertState>()(
  persist(
    (set, get) => ({
      overrides: {},

      renew: (cert, now) => {
        const renewed = renewCertificate(cert)
        const current = get().overrides[cert.id]
        if (
          current?.daysToExpiry === renewed.daysToExpiry &&
          current?.notBeforeDaysAgo === renewed.notBeforeDaysAgo
        ) {
          return
        }

        set((state) => ({
          overrides: {
            ...state.overrides,
            [cert.id]: {
              daysToExpiry: renewed.daysToExpiry,
              notBeforeDaysAgo: renewed.notBeforeDaysAgo,
              autoRenew: renewed.autoRenew,
            },
          },
        }))

        const wasExpired = cert.daysToExpiry < 0
        const change = useChangeStore.getState().addChange(
          {
            title: `TLS certificate rotation — ${cert.commonName}`,
            description: `Reissue ${cert.keyType}-${cert.keyBits} certificate for ${cert.deviceName} (${ISSUER_LABELS[cert.issuer]}), SANs: ${cert.sans.join(', ')}. Previous expiry in ${cert.daysToExpiry} days.`,
            type: wasExpired ? 'emergency' : 'standard',
            deviceIds: [cert.deviceId],
            siteNames: [cert.site],
            plannedStart: now,
            plannedEnd: now + 2 * 3_600_000,
            requestedBy: 'Certificate Manager',
            status: 'review',
            note: wasExpired
              ? 'Emergency rotation: certificate is expired.'
              : 'Routine rotation with CAB review.',
          },
          now,
        )

        useNetworkStore.getState().pushEvent({
          timestamp: now,
          type: 'config',
          severity: wasExpired ? 'high' : 'low',
          deviceId: cert.deviceId,
          message: `Certificate rotated: ${cert.commonName} (valid 365 d) — change ${change.id} filed.`,
        })
      },

      resetInventory: () => set({ overrides: {} }),
    }),
    {
      name: 'netscope:certs',
      version: 1,
      storage: createDebouncedStorage<{ overrides: CertOverrides }>(1000),
      partialize: (state) => ({ overrides: state.overrides }),
    },
  ),
)
