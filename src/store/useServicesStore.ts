import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from '@/lib/id'
import type { BusinessService } from '@/lib/services'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

export type ServiceDraft = Omit<BusinessService, 'id'>

interface ServicesState {
  services: BusinessService[]
  addService: (draft: ServiceDraft) => BusinessService
  updateService: (
    id: string,
    patch: Partial<Omit<BusinessService, 'id'>>,
  ) => void
  deleteService: (id: string) => void
  resetServices: () => void
}

interface ServicesPersisted {
  services: BusinessService[]
}

function seed(): BusinessService[] {
  const draft = (
    name: string,
    description: string,
    tier: BusinessService['tier'],
    impact: BusinessService['impact'],
    siteNames: string[],
    owner: string,
  ): BusinessService => ({
    id: createId('svc'),
    name,
    description,
    tier,
    impact,
    deviceIds: [],
    siteNames,
    owner,
  })

  return [
    draft(
      'Public Website',
      'Marketing and self-service portal for all customers.',
      'p1',
      'revenue',
      ['Data Center A'],
      'Platform',
    ),
    draft(
      'Payments API',
      'Card processing and settlement gateway.',
      'p1',
      'revenue',
      ['Data Center B'],
      'Platform',
    ),
    draft(
      'Corporate VPN',
      'Remote access for staff across branch offices.',
      'p2',
      'productivity',
      ['Branch - West', 'Branch - East'],
      'Network',
    ),
    draft(
      'Email & Collaboration',
      'Mail, calendar and document sharing for HQ.',
      'p2',
      'productivity',
      ['HQ - Floor 1'],
      'IT Operations',
    ),
    draft(
      'Backup & Storage',
      'Nightly backup and long-term archive retention.',
      'p3',
      'regulatory',
      ['Data Center A'],
      'Platform',
    ),
    draft(
      'Guest Wi-Fi',
      'Visitor wireless access for HQ reception.',
      'p4',
      'internal',
      ['HQ - Floor 2'],
      'Network',
    ),
  ]
}

export const useServicesStore = create<ServicesState>()(
  persist(
    (set) => ({
      services: seed(),

      addService: (draft) => {
        const created: BusinessService = { ...draft, id: createId('svc') }
        set((state) => ({ services: [...state.services, created] }))
        return created
      },

      updateService: (id, patch) =>
        set((state) => ({
          services: state.services.map((service) =>
            service.id === id ? { ...service, ...patch } : service,
          ),
        })),

      deleteService: (id) =>
        set((state) => ({
          services: state.services.filter((service) => service.id !== id),
        })),

      resetServices: () => set({ services: seed() }),
    }),
    {
      name: 'netscope:services',
      version: 1,
      storage: createDebouncedStorage<ServicesPersisted>(1000),
      partialize: (state) => ({ services: state.services }),
    },
  ),
)
