import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { SITES } from '@/simulation/seed'
import { generateIpam } from '@/lib/ipam'
import type { Subnet, Vlan, IpAllocation } from '@/lib/ipam'

interface IpamState {
  subnets: Subnet[]
  vlans: Vlan[]
  allocations: IpAllocation[]
  addSubnet: (subnet: Subnet) => void
  updateSubnet: (id: string, patch: Partial<Subnet>) => void
  removeSubnet: (id: string) => void
  addAllocation: (allocation: IpAllocation) => void
  setAllocationStatus: (ip: string, status: IpAllocation['status']) => void
  removeAllocation: (ip: string) => void
  reset: () => void
}

interface IpamPersisted {
  subnets: Subnet[]
  vlans: Vlan[]
  allocations: IpAllocation[]
}

function seed(): Pick<IpamState, 'subnets' | 'vlans' | 'allocations'> {
  const generated = generateIpam(SITES, 1)
  return {
    subnets: generated.subnets,
    vlans: generated.vlans,
    allocations: generated.allocations,
  }
}

export const useIpamStore = create<IpamState>()(
  persist(
    (set) => ({
      ...seed(),

      addSubnet: (subnet) =>
        set((state) => ({
          subnets: state.subnets.some((entry) => entry.id === subnet.id)
            ? state.subnets
            : [...state.subnets, subnet],
        })),

      updateSubnet: (id, patch) =>
        set((state) => ({
          subnets: state.subnets.map((entry) =>
            entry.id === id ? { ...entry, ...patch, id: entry.id } : entry,
          ),
        })),

      removeSubnet: (id) =>
        set((state) => ({
          subnets: state.subnets.filter((entry) => entry.id !== id),
          allocations: state.allocations.filter(
            (entry) => entry.subnetId !== id,
          ),
        })),

      addAllocation: (allocation) =>
        set((state) => ({
          allocations: state.allocations.some(
            (entry) => entry.ip === allocation.ip,
          )
            ? state.allocations
            : [...state.allocations, allocation],
        })),

      setAllocationStatus: (ip, status) =>
        set((state) => ({
          allocations: state.allocations.map((entry) =>
            entry.ip === ip ? { ...entry, status } : entry,
          ),
        })),

      removeAllocation: (ip) =>
        set((state) => ({
          allocations: state.allocations.filter((entry) => entry.ip !== ip),
        })),

      reset: () => set(seed()),
    }),
    {
      name: 'netscope:ipam',
      version: 1,
      storage: createDebouncedStorage<IpamPersisted>(1000),
      partialize: (state) => ({
        subnets: state.subnets,
        vlans: state.vlans,
        allocations: state.allocations,
      }),
    },
  ),
)
