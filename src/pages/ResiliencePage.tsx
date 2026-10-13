import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  FlaskConical,
  Play,
  Server,
  ShieldAlert,
  ShieldCheck,
  Waypoints,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import { SERVICE_STATUS_LABELS, type ServiceStatus } from '@/lib/services'
import {
  RESILIENCE_GRADE_LABELS,
  SPOF_SEVERITY_LABELS,
  chaosPresets,
  describeChaos,
  detectSpofs,
  resilienceGrade,
  resilienceScore,
  simulateChaos,
  type ChaosResult,
} from '@/lib/resilience'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useServicesStore } from '@/store/useServicesStore'
import { useSettingsStore } from '@/store/useSettingsStore'

const SEVERITY_VARIANT = {
  critical: 'destructive',
  high: 'warning',
  medium: 'outline',
} as const

const SERVICE_VARIANT: Record<ServiceStatus, string> = {
  operational: 'success',
  degraded: 'warning',
  partial: 'warning',
  outage: 'destructive',
}

export function ResiliencePage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const services = useServicesStore((state) => state.services)
  const thresholds = useSettingsStore((state) => state.thresholds)
  const incidentFrequency = useSettingsStore((state) => state.incidentFrequency)

  const [presetId, setPresetId] = useState('')
  const [result, setResult] = useState<ChaosResult | null>(null)

  const now = lastTick || devices[0]?.lastSeen || 0

  const spofReport = useMemo(
    () => (devices.length === 0 ? null : detectSpofs({ devices })),
    [devices],
  )
  const score = useMemo(
    () =>
      devices.length === 0
        ? 100
        : resilienceScore({ devices, services, incidents, thresholds }),
    [devices, services, incidents, thresholds],
  )
  const grade = resilienceGrade(score)
  const presets = useMemo(
    () => (devices.length === 0 ? [] : chaosPresets({ devices })),
    [devices],
  )
  const selectedPreset =
    presets.find((preset) => preset.id === presetId) ?? presets[0] ?? null

  if (devices.length === 0 || !spofReport) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Resilience & Chaos"
          description="Find single points of failure and pressure-test the fleet with chaos experiments."
        />
        <EmptyState
          icon={ShieldCheck}
          title="No devices to analyse"
          description="Seed the fleet before running resilience analysis."
        />
      </div>
    )
  }

  const deviceName = (id: string) =>
    devices.find((device) => device.id === id)?.name ?? id

  const runChaos = () => {
    if (!selectedPreset) return
    const next = simulateChaos({
      devices,
      services,
      incidents,
      thresholds,
      incidentFrequency,
      now,
      faults: selectedPreset.faults,
      trafficScale: selectedPreset.trafficScale,
    })
    setResult(next)
    toast.success(`Chaos experiment run: ${selectedPreset.name}`)
  }

  const scoreVariant =
    grade === 'strong'
      ? 'success'
      : grade === 'fair'
        ? 'info'
        : grade === 'fragile'
          ? 'warning'
          : 'destructive'

  return (
    <div className="space-y-5">
      <PageHeader
        title="Resilience & Chaos"
        description="Surface single points of failure, measure redundancy and pressure-test the fleet with sandboxed chaos experiments."
      />

      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <FlaskConical className="size-4 text-primary" />
          <span className="text-muted-foreground">
            Chaos experiments run on a cloned snapshot with a seeded engine —
            the live fleet and its history are never modified.
          </span>
          <Badge variant={scoreVariant} className="ml-auto gap-1">
            <ShieldCheck className="size-3" />
            {RESILIENCE_GRADE_LABELS[grade]} · {score}/100
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Resilience score"
          value={`${score}`}
          icon={ShieldCheck}
          hint={RESILIENCE_GRADE_LABELS[grade]}
          accent={
            grade === 'strong' || grade === 'fair'
              ? 'text-success'
              : 'text-warning'
          }
        />
        <StatCard
          label="Single points of failure"
          value={`${spofReport.spofs.length}`}
          icon={ShieldAlert}
          hint={`of ${devices.length} devices`}
          accent={
            spofReport.spofs.length > 0 ? 'text-destructive' : 'text-success'
          }
        />
        <StatCard
          label="Redundant devices"
          value={`${spofReport.redundantCount}`}
          icon={Waypoints}
          hint="not an articulation point"
          accent="text-sky-500"
        />
        <StatCard
          label="Core node"
          value={spofReport.coreId ? deviceName(spofReport.coreId) : '—'}
          icon={Server}
          hint="most connected device"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4 text-destructive" />
              Single points of failure
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Devices whose failure cuts other devices off from the core. Add a
              redundant uplink to clear each one.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {spofReport.spofs.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                No single points of failure detected — every device has a
                redundant route to the core.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Device</th>
                      <th className="px-4 py-2 font-medium">Site</th>
                      <th className="px-4 py-2 font-medium">Severity</th>
                      <th className="px-4 py-2 font-medium">Strands</th>
                      <th className="px-4 py-2 font-medium">
                        Stranded devices
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {spofReport.spofs.map((spof) => (
                      <tr
                        key={spof.deviceId}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="px-4 py-2">
                          <span className="font-medium">{spof.name}</span>
                          {spof.isCore ? (
                            <Badge variant="secondary" className="ml-2">
                              core
                            </Badge>
                          ) : null}
                          <span className="ml-2 text-xs text-muted-foreground">
                            {DEVICE_TYPE_LABELS[spof.type]}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {spof.site}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={SEVERITY_VARIANT[spof.severity]}
                            className="capitalize"
                          >
                            {SPOF_SEVERITY_LABELS[spof.severity]}
                          </Badge>
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          {spof.isolatedCount}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex flex-wrap gap-1">
                            {spof.isolated.slice(0, 4).map((id) => (
                              <Badge
                                key={id}
                                variant="outline"
                                className="text-[10px]"
                              >
                                {deviceName(id)}
                              </Badge>
                            ))}
                            {spof.isolated.length > 4 ? (
                              <Badge variant="outline" className="text-[10px]">
                                +{spof.isolated.length - 4} more
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-amber-500" />
              Chaos lab
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Pick an experiment and run it to see the blast on your services.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select
              value={selectedPreset?.id ?? ''}
              onValueChange={(value) => {
                setPresetId(value)
                setResult(null)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a scenario…" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedPreset ? (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {selectedPreset.description}
                <div className="mt-1 font-mono text-[11px] text-foreground/70">
                  {describeChaos(selectedPreset)}
                </div>
              </div>
            ) : null}

            <Button
              className="w-full"
              onClick={runChaos}
              disabled={!selectedPreset}
            >
              <Play className="size-4" /> Run experiment
            </Button>
          </CardContent>
        </Card>
      </div>

      {result ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              Chaos result
              {selectedPreset ? (
                <Badge variant="secondary">{selectedPreset.name}</Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric
                label="Resilience score"
                value={`${result.before.score} → ${result.after.score}`}
                tone={result.scoreDrop < 0 ? 'bad' : 'good'}
                hint={
                  result.scoreDrop < 0 ? `${result.scoreDrop} pts` : 'no change'
                }
              />
              <Metric
                label="Devices offline"
                value={`${result.before.offline} → ${result.after.offline}`}
                tone={
                  result.after.offline > result.before.offline ? 'bad' : 'good'
                }
              />
              <Metric
                label="Devices degraded"
                value={`${result.saturatedDeviceIds.length}`}
                tone={result.saturatedDeviceIds.length > 0 ? 'warn' : 'good'}
              />
              <Metric
                label="Services hit"
                value={`${result.degradedServices}`}
                tone={result.degradedServices > 0 ? 'bad' : 'good'}
                hint={`${result.outageServices} in outage`}
              />
            </div>

            {result.services.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Service</th>
                      <th className="px-4 py-2 font-medium">Before</th>
                      <th className="px-4 py-2 font-medium">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.services.map((entry) => (
                      <tr
                        key={entry.serviceId}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="px-4 py-2 font-medium">
                          {entry.serviceName}
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={SERVICE_VARIANT[entry.before] as never}
                          >
                            {SERVICE_STATUS_LABELS[entry.before]}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge
                            variant={SERVICE_VARIANT[entry.after] as never}
                            className={entry.worsened ? 'gap-1' : undefined}
                          >
                            {entry.worsened ? (
                              <AlertTriangle className="size-3" />
                            ) : null}
                            {SERVICE_STATUS_LABELS[entry.after]}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No business services are mapped, so only device-level impact is
                shown. Add services on the Business Services page.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/60">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <Waypoints className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Single points of failure are articulation points in the derived
            topology — remove one and its stranded devices lose their route to
            the core. Chaos experiments advance the real engine on a cloned,
            seeded fleet, so results are reproducible and never touch live
            state.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'bad' | 'warn' | 'neutral'
}) {
  const toneClass =
    tone === 'bad'
      ? 'text-destructive'
      : tone === 'warn'
        ? 'text-warning'
        : tone === 'good'
          ? 'text-success'
          : 'text-foreground'
  return (
    <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
