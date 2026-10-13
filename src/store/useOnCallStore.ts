import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createId } from '@/lib/id'
import {
  WEEK_MS,
  type OnCallMember,
  type Rotation,
  type Team,
} from '@/lib/oncall'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

/** Fixed anchor so the demo schedule is deterministic across reloads. */
export const ONCALL_ANCHOR = 1_700_000_000_000

interface OnCallState {
  teams: Team[]
  rotations: Rotation[]
  addTeam: (name: string) => Team
  updateTeam: (id: string, patch: Partial<Omit<Team, 'id' | 'members'>>) => void
  deleteTeam: (id: string) => void
  addMember: (teamId: string, member: Omit<OnCallMember, 'id'>) => void
  updateMember: (
    teamId: string,
    memberId: string,
    patch: Partial<Omit<OnCallMember, 'id'>>,
  ) => void
  deleteMember: (teamId: string, memberId: string) => void
  addRotation: (input: Partial<Omit<Rotation, 'id'>>) => Rotation
  updateRotation: (id: string, patch: Partial<Omit<Rotation, 'id'>>) => void
  deleteRotation: (id: string) => void
  resetOnCall: () => void
}

interface OnCallPersisted {
  teams: Team[]
  rotations: Rotation[]
}

function seedTeams(): Team[] {
  const platform: Team = {
    id: createId('team'),
    name: 'Platform',
    members: [
      { id: createId('mem'), name: 'Ada Lovelace', email: 'ada@netscope.dev' },
      {
        id: createId('mem'),
        name: 'Grace Hopper',
        email: 'grace@netscope.dev',
      },
      {
        id: createId('mem'),
        name: 'Alan Turing',
        email: 'alan@netscope.dev',
      },
    ],
  }
  const network: Team = {
    id: createId('team'),
    name: 'Network',
    members: [
      {
        id: createId('mem'),
        name: 'Radia Perlman',
        email: 'radia@netscope.dev',
      },
      { id: createId('mem'), name: 'Vint Cerf', email: 'vint@netscope.dev' },
    ],
  }
  return [platform, network]
}

function seedRotations(teams: Team[]): Rotation[] {
  const [platform, network] = teams
  return [
    {
      id: createId('rot'),
      teamId: platform.id,
      name: 'Primary',
      startsAt: ONCALL_ANCHOR,
      intervalMs: WEEK_MS,
      members: platform.members.map((member) => member.id),
    },
    {
      id: createId('rot'),
      teamId: network.id,
      name: 'Network Primary',
      startsAt: ONCALL_ANCHOR,
      intervalMs: WEEK_MS,
      members: network.members.map((member) => member.id),
    },
  ]
}

function seed(): Pick<OnCallState, 'teams' | 'rotations'> {
  const teams = seedTeams()
  return { teams, rotations: seedRotations(teams) }
}

export const useOnCallStore = create<OnCallState>()(
  persist(
    (set) => ({
      ...seed(),

      addTeam: (name) => {
        const created: Team = {
          id: createId('team'),
          name: name.trim() || 'New team',
          members: [],
        }
        set((state) => ({ teams: [...state.teams, created] }))
        return created
      },

      updateTeam: (id, patch) =>
        set((state) => ({
          teams: state.teams.map((team) =>
            team.id === id ? { ...team, ...patch } : team,
          ),
        })),

      deleteTeam: (id) =>
        set((state) => ({
          teams: state.teams.filter((team) => team.id !== id),
          rotations: state.rotations.filter(
            (rotation) => rotation.teamId !== id,
          ),
        })),

      addMember: (teamId, member) =>
        set((state) => ({
          teams: state.teams.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  members: [
                    ...team.members,
                    { ...member, id: createId('mem') },
                  ],
                }
              : team,
          ),
        })),

      updateMember: (teamId, memberId, patch) =>
        set((state) => ({
          teams: state.teams.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  members: team.members.map((member) =>
                    member.id === memberId ? { ...member, ...patch } : member,
                  ),
                }
              : team,
          ),
        })),

      deleteMember: (teamId, memberId) =>
        set((state) => ({
          teams: state.teams.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  members: team.members.filter(
                    (member) => member.id !== memberId,
                  ),
                }
              : team,
          ),
          rotations: state.rotations.map((rotation) =>
            rotation.teamId === teamId
              ? {
                  ...rotation,
                  members: rotation.members.filter((id) => id !== memberId),
                }
              : rotation,
          ),
        })),

      addRotation: (input) => {
        const team = input.teamId
        const created: Rotation = {
          id: createId('rot'),
          teamId: team ?? '',
          name: input.name ?? 'Primary',
          startsAt: input.startsAt ?? ONCALL_ANCHOR,
          intervalMs: input.intervalMs ?? WEEK_MS,
          members: input.members ?? [],
        }
        set((state) => ({ rotations: [...state.rotations, created] }))
        return created
      },

      updateRotation: (id, patch) =>
        set((state) => ({
          rotations: state.rotations.map((rotation) =>
            rotation.id === id ? { ...rotation, ...patch } : rotation,
          ),
        })),

      deleteRotation: (id) =>
        set((state) => ({
          rotations: state.rotations.filter((rotation) => rotation.id !== id),
        })),

      resetOnCall: () => set(seed()),
    }),
    {
      name: 'netscope:oncall',
      version: 1,
      storage: createDebouncedStorage<OnCallPersisted>(1000),
      partialize: (state) => ({
        teams: state.teams,
        rotations: state.rotations,
      }),
    },
  ),
)
