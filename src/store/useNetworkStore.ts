import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Device,
  DeviceInput,
  DeviceStatus,
  FaultInjection,
  FaultKind,
  Incident,
  MetricSample,
  TimelineEvent,
} from '@/types'
import { createId } from '@/lib/id'
import { round, clamp } from '@/lib/format'
import { recoverDevice } from '@/lib/devices'
import { mulberry32, seedFromParam, type Rng } from '@/simulation/random'
import { buildSeedDevices, deviceFromInput } from '@/simulation/seed'
import { runTick } from '@/simulation/engine'
import {
  activeFaults,
  describeFaultTarget,
  FAULT_LABELS,
} from '@/simulation/faults'
import {
  coerceHistory,
  exportDevicesJson,
  STORAGE_VERSION,
  migratePersistedNetwork,
  type PersistedNetwork,
} from '@/storage/persistence'
import type { BackupPayload } from '@/types'
import { createDebouncedStorage } from '@/storage/debouncedStorage'
import { useSettingsStore } from './useSettingsStore'
import { useAlertsStore } from './useAlertsStore'
import { useMonitorsStore } from './useMonitorsStore'
import { useChannelsStore } from './useChannelsStore'
import { useAutomationStore } from './useAutomationStore'
import { firingAlerts } from '@/lib/alerts'
import type { PlaybookRun } from '@/lib/playbooks'

const BASE_SEED = 0x5eed1234
const MAX_EVENTS = 500
const MAX_INCIDENTS = 200
const FLAP_WINDOW = 8
const FLAP_MIN_TRANSITIONS = 4

/** Resolve a shareable `?seed=` query param (before the hash route). */
function readSeed(): number {
  if (typeof window === 'undefined') return BASE_SEED
  const raw = new URLSearchParams(window.location.search).get('seed')
  return seedFromParam(raw) ?? BASE_SEED
}

const ACTIVE_SEED = readSeed()
let rng: Rng = mulberry32(ACTIVE_SEED)

/** Rolling per-device status history used to detect flapping. */
const statusHistory = new Map<string, DeviceStatus[]>()

function trackFlapping(devices: Device[]): Device[] {
  return devices.map((device) => {
    const history = statusHistory.get(device.id) ?? []
    history.push(device.status)
    if (history.length > FLAP_WINDOW) history.shift()
    statusHistory.set(device.id, history)

    let transitions = 0
    for (let i = 1; i < history.length; i += 1) {
      if (history[i] !== history[i - 1]) transitions += 1
    }
    const flapping = transitions >= FLAP_MIN_TRANSITIONS
    return device.flapping === flapping ? device : { ...device, flapping }
  })
}

/** Carry out a playbook run's actions against the live network store. */
function executeAutomationRun(run: PlaybookRun, now: number): void {
  const store = useNetworkStore.getState()
  for (const action of run.actions) {
    if (action.kind === 'notify') {
      store.pushEvent({
        timestamp: now,
        type: 'config',
        severity: 'low',
        message: `Automation "${run.playbookName}" ran on ${run.deviceIds.length} device(s)${
          action.value ? ` — ${action.value}` : ''
        }.`,
      })
    } else if (action.kind === 'acknowledge') {
      for (const incident of useNetworkStore.getState().incidents) {
        if (
          incident.status === 'open' &&
          incident.deviceIds.some((id) => run.deviceIds.includes(id))
        ) {
          useNetworkStore.getState().acknowledgeIncident(incident.id)
        }
      }
    } else if (action.kind === 'remediate') {
      for (const incident of useNetworkStore.getState().incidents) {
        if (
          incident.status !== 'resolved' &&
          incident.deviceIds.some((id) => run.deviceIds.includes(id))
        ) {
          useNetworkStore.getState().runRemediation(incident.id)
        }
      }
    } else if (action.kind === 'maintenance') {
      for (const id of run.deviceIds) {
        const device = useNetworkStore
          .getState()
          .devices.find((d) => d.id === id)
        if (device && !device.inMaintenance) {
          useNetworkStore.getState().toggleMaintenance(id)
        }
      }
    } else if (action.kind === 'tag' && action.value) {
      const tag = action.value
      for (const id of run.deviceIds) {
        const device = useNetworkStore
          .getState()
          .devices.find((d) => d.id === id)
        if (device && !device.tags.includes(tag)) {
          useNetworkStore.getState().updateDevice(id, {
            tags: [...device.tags, tag],
          })
        }
      }
    }
  }
}

export interface NetworkState {
  devices: Device[]
  incidents: Incident[]
  events: TimelineEvent[]
  history: Record<string, MetricSample[]>
  /** Transient, user-injected faults (never persisted or backed up). */
  faults: FaultInjection[]
  lastTick: number
  initialized: boolean
  /** The seed driving this session (from `?seed=` or the default). */
  seed: number

  initialize: () => void
  tick: () => void
  addDevice: (input: DeviceInput) => Device
  updateDevice: (id: string, patch: Partial<DeviceInput>) => void
  deleteDevice: (id: string) => void
  toggleMaintenance: (id: string) => void
  injectFault: (
    kind: FaultKind,
    target: string,
    durationMs?: number | null,
  ) => void
  clearFault: (id: string) => void
  clearAllFaults: () => void
  importDevices: (devices: Device[], mode: 'merge' | 'replace') => void
  exportDevices: () => string
  restoreBackup: (payload: BackupPayload) => void
  acknowledgeIncident: (id: string) => void
  resolveIncident: (id: string) => void
  runRemediation: (id: string) => void
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
        throughputMbps: round(Math.max(1, device.throughputMbps * factor), 1),
        cpuPct: round(clamp(device.cpuPct * factor, 0, 100), 1),
        memoryPct: round(
          clamp(device.memoryPct * (1 + generator.noise(0.12)), 0, 100),
          1,
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
      faults: [],
      lastTick: 0,
      initialized: false,
      seed: ACTIVE_SEED,

      initialize: () => {
        if (get().initialized) return
        const now = Date.now()
        let { devices, incidents, events } = get()

        if (devices.length === 0) {
          rng = mulberry32(ACTIVE_SEED)
          statusHistory.clear()
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
          stepMs: settings.refreshIntervalMs,
          rng,
          faults: activeFaults(get().faults, now),
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
            devices: trackFlapping(result.devices),
            incidents: result.incidents.slice(0, MAX_INCIDENTS),
            events: boundEvents([...result.events, ...state.events]),
            history,
            faults: activeFaults(state.faults, now),
            lastTick: now,
          }
        })

        // Evaluate user-defined alert rules against the freshly advanced fleet.
        const changes = useAlertsStore
          .getState()
          .evaluate({ devices: get().devices, now })
        if (changes.length > 0) {
          const alertEvents: TimelineEvent[] = changes.map((change) => ({
            id: createId('evt'),
            timestamp: now,
            type: 'status',
            severity: change.instance.severity,
            deviceId: change.instance.deviceId,
            message:
              change.kind === 'firing'
                ? `Alert firing: ${change.instance.ruleName} on ${change.instance.deviceName} (${change.instance.value})`
                : `Alert resolved: ${change.instance.ruleName} on ${change.instance.deviceName}`,
          }))
          set((state) => ({
            events: boundEvents([...alertEvents, ...state.events]),
          }))
        }

        // Run any due synthetic uptime monitors against the fresh fleet.
        useMonitorsStore.getState().runAll(get().devices, now)

        // Escalate still-firing alerts through the notification channels.
        const { states } = useAlertsStore.getState()
        useChannelsStore.getState().runEscalation(firingAlerts(states), now)

        // Mark devices inside active maintenance windows (engine suppresses
        // incident noise for them), then run any due automation playbooks.
        const maintenance = new Set(
          useAutomationStore.getState().maintenanceTargets(get().devices, now),
        )
        for (const device of get().devices) {
          const desired = maintenance.has(device.id)
          if ((device.inMaintenance ?? false) !== desired) {
            get().toggleMaintenance(device.id)
          }
        }
        const runs = useAutomationStore.getState().plan({
          devices: get().devices,
          alerts: firingAlerts(states),
          now,
        })
        for (const run of runs) executeAutomationRun(run, now)
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

      toggleMaintenance: (id) => {
        const now = Date.now()
        set((state) => {
          const target = state.devices.find((device) => device.id === id)
          if (!target) return state
          const inMaintenance = !(target.inMaintenance ?? false)
          return {
            devices: state.devices.map((device) =>
              device.id === id
                ? { ...device, inMaintenance, flapping: false }
                : device,
            ),
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'config',
                deviceId: id,
                message: inMaintenance
                  ? `Maintenance started: ${target.name}`
                  : `Maintenance ended: ${target.name}`,
              },
              ...state.events,
            ]),
          }
        })
      },

      injectFault: (kind, target, durationMs = null) => {
        const now = Date.now()
        const expiresAt =
          typeof durationMs === 'number' && durationMs > 0
            ? now + durationMs
            : null
        set((state) => {
          const fault: FaultInjection = {
            id: createId('fault'),
            kind,
            target,
            appliedAt: now,
            expiresAt,
          }
          return {
            faults: [
              ...state.faults.filter(
                (existing) =>
                  !(existing.kind === kind && existing.target === target),
              ),
              fault,
            ],
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'config',
                severity: kind === 'saturate' ? 'medium' : 'high',
                deviceId: kind === 'site-outage' ? undefined : target,
                message: `Simulated fault injected: ${FAULT_LABELS[kind]} at ${describeFaultTarget(fault, state.devices)}${expiresAt ? ' (auto-clears)' : ''}`,
              },
              ...state.events,
            ]),
          }
        })
      },

      clearFault: (id) => {
        const now = Date.now()
        set((state) => {
          const fault = state.faults.find((item) => item.id === id)
          if (!fault) return state
          return {
            faults: state.faults.filter((item) => item.id !== id),
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'config',
                deviceId:
                  fault.kind === 'site-outage' ? undefined : fault.target,
                message: `Simulated fault cleared: ${FAULT_LABELS[fault.kind]} at ${describeFaultTarget(fault, state.devices)}`,
              },
              ...state.events,
            ]),
          }
        })
      },

      clearAllFaults: () => {
        const now = Date.now()
        set((state) => {
          if (state.faults.length === 0) return state
          const count = state.faults.length
          return {
            faults: [],
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'config',
                message: `All simulated faults cleared (${count}).`,
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

      restoreBackup: (payload) => {
        const now = Date.now()
        const currentSettings = useSettingsStore.getState()
        useSettingsStore.setState({
          ...currentSettings,
          ...payload.settings,
          thresholds: {
            ...currentSettings.thresholds,
            ...payload.settings.thresholds,
          },
        })
        statusHistory.clear()
        const ids = new Set(payload.devices.map((device) => device.id))
        const history: Record<string, MetricSample[]> = {}
        for (const [id, samples] of Object.entries(
          coerceHistory(payload?.history, payload.settings.maxHistoryPoints),
        )) {
          if (ids.has(id)) history[id] = samples
        }
        set({
          devices: payload.devices,
          incidents: payload.incidents.slice(0, MAX_INCIDENTS),
          events: boundEvents(payload.events),
          history,
          faults: [],
          lastTick: now,
        })
      },

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

      runRemediation: (id) => {
        const now = Date.now()
        set((state) => {
          const incident = state.incidents.find((item) => item.id === id)
          if (!incident || incident.status === 'resolved') return state

          const targets = new Set(incident.deviceIds)
          const sites = new Set(
            state.devices
              .filter((device) => targets.has(device.id))
              .map((device) => device.site),
          )
          const faults = state.faults.filter(
            (fault) =>
              !targets.has(fault.target) &&
              !(fault.kind === 'site-outage' && sites.has(fault.target)),
          )
          const recovered = state.faults.length - faults.length
          const devices = state.devices.map((device) =>
            targets.has(device.id) ? recoverDevice(device, now) : device,
          )

          return {
            devices,
            faults,
            incidents: state.incidents.map((item) =>
              item.id === id
                ? {
                    ...item,
                    status: 'resolved',
                    resolvedAt: now,
                    updatedAt: now,
                  }
                : item,
            ),
            events: boundEvents([
              {
                id: createId('evt'),
                timestamp: now,
                type: 'incident',
                severity: incident.severity,
                deviceId: incident.deviceIds[0],
                message: `Runbook applied to "${incident.title}": restored ${targets.size} device(s)${recovered > 0 ? `, cleared ${recovered} fault(s)` : ''}.`,
              },
              ...state.events,
            ]),
          }
        })
      },

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
        rng = mulberry32(ACTIVE_SEED)
        statusHistory.clear()
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
          faults: [],
          lastTick: now,
          seed: ACTIVE_SEED,
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
