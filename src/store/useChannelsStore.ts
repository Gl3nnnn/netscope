import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AlertInstance } from '@/lib/alerts'
import {
  DEFAULT_CHANNELS,
  DEFAULT_ESCALATION,
  escalationLevel,
  shouldDeliver,
  type Delivery,
  type EscalationConfig,
  type NotificationChannel,
} from '@/lib/channels'
import { createId } from '@/lib/id'
import { createDebouncedStorage } from '@/storage/debouncedStorage'

interface ChannelsState {
  channels: NotificationChannel[]
  deliveries: Delivery[]
  escalation: EscalationConfig
  /** Last delivered escalation level per alert, so we only send on changes. */
  lastLevels: Record<string, number>
  addChannel: (input: Omit<NotificationChannel, 'id'>) => void
  updateChannel: (
    id: string,
    patch: Partial<Omit<NotificationChannel, 'id'>>,
  ) => void
  deleteChannel: (id: string) => void
  resetChannels: () => void
  setEscalation: (patch: Partial<EscalationConfig>) => void
  runEscalation: (instances: AlertInstance[], now: number) => Delivery[]
  clearDeliveries: () => void
}

interface ChannelsPersisted {
  channels: NotificationChannel[]
  escalation: EscalationConfig
}

export const useChannelsStore = create<ChannelsState>()(
  persist(
    (set, get) => ({
      channels: DEFAULT_CHANNELS.map((channel) => ({ ...channel })),
      deliveries: [],
      escalation: { ...DEFAULT_ESCALATION },
      lastLevels: {},

      addChannel: (input) => {
        const channel: NotificationChannel = { ...input, id: createId('ch') }
        set((state) => ({ channels: [...state.channels, channel] }))
      },

      updateChannel: (id, patch) =>
        set((state) => ({
          channels: state.channels.map((channel) =>
            channel.id === id ? { ...channel, ...patch } : channel,
          ),
        })),

      deleteChannel: (id) =>
        set((state) => ({
          channels: state.channels.filter((channel) => channel.id !== id),
        })),

      resetChannels: () =>
        set({
          channels: DEFAULT_CHANNELS.map((channel) => ({ ...channel })),
          escalation: { ...DEFAULT_ESCALATION },
          deliveries: [],
          lastLevels: {},
        }),

      setEscalation: (patch) =>
        set((state) => ({
          escalation: { ...state.escalation, ...patch },
        })),

      runEscalation: (instances, now) => {
        const { channels, escalation, lastLevels } = get()
        const sent: Delivery[] = []
        const firing = instances.filter(
          (instance) => instance.status === 'firing',
        )
        const firingIds = new Set(firing.map((instance) => instance.id))
        // Forget alerts that are no longer firing so a re-fire starts fresh.
        const nextLevels: Record<string, number> = {}
        for (const [id, level] of Object.entries(lastLevels)) {
          if (firingIds.has(id)) nextLevels[id] = level
        }
        for (const instance of firing) {
          const level = escalationLevel(now - instance.startedAt, escalation)
          if (level === nextLevels[instance.id]) continue
          nextLevels[instance.id] = level
          for (const channel of channels) {
            if (!shouldDeliver(channel, instance.severity, level)) continue
            sent.push({
              id: createId('dly'),
              at: now,
              channelId: channel.id,
              channelName: channel.name,
              kind: channel.kind,
              target: channel.target,
              alertInstanceId: instance.id,
              alertName: instance.ruleName,
              severity: instance.severity,
              level,
            })
          }
        }
        if (sent.length > 0) {
          set({
            lastLevels: nextLevels,
            deliveries: [...sent.reverse(), ...get().deliveries].slice(0, 120),
          })
        } else if (
          Object.keys(nextLevels).length !== Object.keys(lastLevels).length
        ) {
          set({ lastLevels: nextLevels })
        }
        return sent
      },

      clearDeliveries: () => set({ deliveries: [] }),
    }),
    {
      name: 'netscope:channels',
      version: 1,
      storage: createDebouncedStorage<ChannelsPersisted>(1000),
      partialize: (state) => ({
        channels: state.channels,
        escalation: state.escalation,
      }),
    },
  ),
)
