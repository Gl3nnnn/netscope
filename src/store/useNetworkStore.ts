import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Device,
  DeviceInput,
  Incident,
  MetricSample,
  TimelineEvent,
} from '@/types'
import { createId } from '@/lib/id'
import { round, clamp } from '@/lib/format'
import { mulberry32, type Rng } from '@/simulation/random'
import { buildSeedDevices, deviceFromInput } from '@/simulation/seed'
import { runTick } from '@/simulation/engine'
import { exportDevicesJson, STORAGE_VERSION, migratePersistedNetwork, type PersistedNetwork } from '@/storage/persistence'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useSettingsStore } from './useSettingsStore'

const BASE_SEED = 0x5eed1234
const MAX_EVENTS = 500
const MAX_INCIDENTS = 200

let rng: Rng = mulberry32(BASE_SEED)

export interface NetworkState {
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
  history: Record<string, MetricSample[]>
  lastTick: number
  initialized: boolean

  initialize: () => void
  tick: () => void
  addDevice: (input: DeviceInput) => Device
  updateDevice: (id: string, patch: Partial<DeviceInput>) => void
  deleteDevice: (id: string) => void
  importDevices: (devices: Device[], mode: 'merge' | 'replace') => void
  exportDevices: () => string
  acknowledgeIncident: (id: string) => void
  resolveIncident: (id: string) => void
  clearResolvedIncidents: () => void
  clearEvents: () => void
  pushEvent: (event: Omit<TimelineEvent, 'id'>) => void
  resetDemo: () => void
}

function bootEvent(now: number): TimelineEvent {
  return {
    id: createId('evt'),
    timestamp: now,
    type: 'config',
    message: 'Simulated monitoring engine started (DEMO data).',
  }
}

/** Produce a plausible back-history so charts are populated on first load. */
function seedHistory(
  devices: Device[],
  generator: Rng,
  points: number,
  stepMs: number,
  now: number,
): Record<string, MetricSample[]> {
  const history: Record<string, MetricSample[]> = {}
  const step = Math.max(1000, stepMs)
  for (const device of devices) {
    const samples: MetricSample[] = []
    for (let i = points - 1; i >= 0; i -= 1) {
      const factor = 1 + generator.noise(0.25)
      samples.push({
        t: now - i * step,
        latencyMs: round(Math.max(0.2, device.latencyMs * factor), 2),
        packetLossPct: round(clamp(device.packetLossPct * factor, 0, 100), 2),
        availabilityPct: round(
          clamp(device.availabilityPct + generator.noise(0.15), 0, 100),
          3,
        ),
      })
    }
    history[device.id] = samples
  }
  return history
}

function boundEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.length > MAX_EVENTS ? events.slice(0, MAX_EVENTS) : events
}

function toPersisted(state: NetworkState): PersistedNetwork {
  return {
    devices: state.devices,
    incidents: state.incidents.slice(0, MAX_INCIDENTS),
    events: state.events.slice(0, MAX_EVENTS),
  }
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set, get) => ({
      devices: [],
      incidents: [],
      events: [],
      history: {},
      lastTick: 0,
      initialized: false,

      initialize: () => {
        if (get().initialized) return
        const now = Date.now()
        let { devices, incidents, events } = get()

        if (devices.length === 0) {
          rng = mulberry32(BASE_SEED)
          devices = buildSeedDevices(rng, now)
          incidents = []
          events = [bootEvent(now)]
        }

        const settings = useSettingsStore.getState()
        const history = seedHistory(
          devices,
          rng,
          Math.min(48, settings.maxHistoryPoints),
          settings.refreshIntervalMs,
          now,
        )

        set({
          devices,
          incidents,
          events: boundEvents(events),
          history,
          lastTick: now,
          initialized: true,
        })
      },

      tick: () => {
        const settings = useSettingsStore.getState()
        if (!settings.simulationRunning) return
        const now = Date.now()
        const steps = Math.max(1, Math.round(settings.simulationSpeed))
        const result = runTick({
          devices: get().devices,
          incidents: get().incidents,
          thresholds: settings.thresholds,
          steps,
          incidentFrequency: settings.incidentFrequency,
          now,
          rng,
        })

        set((state) => {
          const history = { ...state.history }
          const max = settings.maxHistoryPoints
          for (const [id, sample] of Object.entries(result.samples)) {
            const next = history[id] ? [...history[id], sample] : [sample]
            history[id] =
              next.length > max ? next.slice(next.length - max) : next
          }
          return {
            devices: result.devices,
            incidents: result.incidents.slice(0, MAX_INCIDENTS),
            events: boundEvents([...result.events, ...state.events]),
            history,
            lastTick: now,
          }
        })
      },

      addDevice: (input) => {
        const now = Date.now()
        const device = deviceFromInput(input, rng, now)
        set((state) => ({
          devices: [...state.devices, device],
          history: { ...state.history, [device.id]: [] },
          events: boundEvents([
            {
              id: createId('evt'),
              timestamp: now,
              type: 'device',
              deviceId: device.id,
              message: `Device added: ${device.name} (${device.ip})`,
            },
            ...state.events,
          ]),
        }))
        return device
      },

      updateDevice: (id, patch) => {
        const now = Date.now()
        set((state) => ({
          devices: state.devices.map((device) =>
            device.id === id ? { ...device, ...patch } : device,
          ),
          events: boundEvents([
            {
              id: createId('evt'),
              timestamp: now,
              type: 'config',
              deviceId: id,
              message: `Device updated: ${patch.name ?? state.devices.find((d) => d.id === id)?.name ?? id}`,
            },
            ...state.events,
          ]),
        }))
      },

      deleteDevice: (id) => {
        const now = Date.now()
        set((state) => {
          const target = state.devices.find((device) => device.id === id)
          const history = { ...state.history }
          delete history[id]
          return {
            devices: state.devices.filter((device) => device.id !== id),
            history,
            incidents: state.incidents.map((incident) => {
              if (!incident.deviceIds.includes(id)) return incident
              const deviceIds = incident.deviceIds.filter((d) => d !== id)
              return {
                ...incident,
                deviceIds,
                status: deviceIds.length === 0 ? 'resolved' : incident.status,
                resolvedAt: deviceIds.length === 0 ? now : incident.resolvedAt,
                updatedAt: now,
              }
            }),
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'device',
                deviceId: id,
                message: `Device deleted: ${target?.name ?? id}`,
              },
              ...state.events,
            ]),
          }
        })
      },

      importDevices: (incoming, mode) => {
        const now = Date.now()
        set((state) => {
          let devices: Device[]
          if (mode === 'replace') {
            const seen = new Set<string>()
            devices = incoming.map((device, index) => {
              let id = device.id
              if (seen.has(id)) id = `${id}_${index}`
              seen.add(id)
              return { ...device, id }
            })
          } else {
            const map = new Map(state.devices.map((d) => [d.id, d]))
            for (const device of incoming) map.set(device.id, device)
            devices = [...map.values()]
          }

          const history = { ...state.history }
          for (const device of devices) {
            if (!history[device.id]) history[device.id] = []
          }

          return {
            devices,
            history,
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'device',
                message: `Imported ${incoming.length} device(s) (${mode}).`,
              },
              ...state.events,
            ]),
          }
        })
      },

      exportDevices: () => exportDevicesJson(get().devices),

      acknowledgeIncident: (id) => {
        const now = Date.now()
        set((state) => {
          const incident = state.incidents.find((i) => i.id === id)
          if (!incident || incident.status !== 'open') return state
          return {
            incidents: state.incidents.map((i) =>
              i.id === id
                ? {
                    ...i,
                    status: 'acknowledged',
                    acknowledgedAt: now,
                    updatedAt: now,
                  }
                : i,
            ),
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'incident',
                severity: incident.severity,
                deviceId: incident.deviceIds[0],
                message: `Incident acknowledged: ${incident.title}`,
              },
              ...state.events,
            ]),
          }
        })
      },

      resolveIncident: (id) => {
        const now = Date.now()
        set((state) => {
          const incident = state.incidents.find((i) => i.id === id)
          if (!incident || incident.status === 'resolved') return state
          return {
            incidents: state.incidents.map((i) =>
              i.id === id
                ? { ...i, status: 'resolved', resolvedAt: now, updatedAt: now }
                : i,
            ),
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'incident',
                severity: incident.severity,
                deviceId: incident.deviceIds[0],
                message: `Incident resolved: ${incident.title}`,
              },
              ...state.events,
            ]),
          }
        })
      },

      clearResolvedIncidents: () =>
        set((state) => ({
          incidents: state.incidents.filter((i) => i.status !== 'resolved'),
        })),

      clearEvents: () => set({ events: [] }),

      pushEvent: (event) =>
        set((state) => ({
          events: boundEvents([
            { id: createId('evt'), ...event },
            ...state.events,
          ]),
        })),

      resetDemo: () => {
        const now = Date.now()
        rng = mulberry32(BASE_SEED)
        const devices = buildSeedDevices(rng, now)
        const settings = useSettingsStore.getState()
        set({
          devices,
          incidents: [],
          events: [bootEvent(now)],
          history: seedHistory(
            devices,
            rng,
            Math.min(48, settings.maxHistoryPoints),
            settings.refreshIntervalMs,
            now,
          ),
          lastTick: now,
          initialized: true,
        })
      },
    }),
    {
      name: 'netscope:network',
      version: STORAGE_VERSION,
      storage: createDebouncedStorage<PersistedNetwork>(1500),
      partialize: (state) => toPersisted(state),
      migrate: (persisted, version) =>
        migratePersistedNetwork(persisted, version),
    },
  ),
)
