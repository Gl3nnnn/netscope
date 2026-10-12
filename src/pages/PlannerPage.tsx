import { useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  FlaskConical,
  Gauge,
  Layers,
  Plus,
  RotateCcw,
  TrendingUp,
  X,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChartCard } from '@/components/charts/ChartCard'
import { ChartTooltip } from '@/components/charts/ChartTooltip'
import {
  DEFAULT_SCENARIO,
  describeScenario,
  isScenarioDirty,
  projectFleet,
  scenarioDelta,
  type PlannerScenario,
} from '@/lib/planner'
import { SATURATION_THRESHOLD_PCT } from '@/lib/capacity'
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import { deviceSites } from '@/lib/devices'
import { formatClock, formatMbps, formatPct, round } from '@/lib/format'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { DeviceType } from '@/types'

const TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]

export function PlannerPage() {
  const devices = useNetworkStore((state) => state.devices)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const thresholds = useSettingsStore((state) => state.thresholds)
  const incidentFrequency = useSettingsStore((state) => state.incidentFrequency)
  const [scenario, setScenario] = useState<PlannerScenario>(DEFAULT_SCENARIO)
  const [failToAdd, setFailToAdd] = useState('')

  const sites = useMemo(() => deviceSites(devices), [devices])
  const now = lastTick || devices[0]?.lastSeen || 0

  const addSite = sites.includes(scenario.addSite)
    ? scenario.addSite
    : (sites[0] ?? scenario.addSite)

  const result = useMemo(
    () =>
      devices.length === 0
        ? null
        : projectFleet({
            devices,
            scenario: { ...scenario, addSite },
            thresholds,
            incidentFrequency,
            now,
          }),
    [devices, scenario, addSite, thresholds, incidentFrequency, now],
  )

  const availableFails = devices.filter(
    (device) => !scenario.offlineIds.includes(device.id),
  )

  if (devices.length === 0 || !result) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="What-If Planner"
          description="Project the fleet forward under a hypothetical change."
        />
        <EmptyState
          icon={FlaskConical}
          title="No devices to plan with"
          description="Seed the fleet before running what-if projections."
        />
      </div>
    )
  }

  const { baseline, projected, series, saturated, additions } = result
  const delta = scenarioDelta(baseline, projected)
  const dirty = isScenarioDirty(scenario)

  const utilTrend = {
    value: `${delta.fleetUtilPct >= 0 ? '+' : ''}${round(delta.fleetUtilPct, 1)} pts`,
    direction:
      delta.fleetUtilPct > 0.05
        ? ('up' as const)
        : delta.fleetUtilPct < -0.05
          ? ('down' as const)
          : ('flat' as const),
    positive: delta.fleetUtilPct <= 0.05,
  }

  const chartData = series.map((point) => ({
    ...point,
    baseline: baseline.fleetUtilPct,
  }))

  return (
    <div className="space-y-5">
      <PageHeader
        title="What-If Planner"
        description="Dry-run capacity changes, traffic shifts and outages against a sandboxed copy of the fleet."
      />

      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <FlaskConical className="size-4 text-primary" />
          <span className="text-muted-foreground">
            Sandbox projection — the live fleet and its history are never
            modified.
          </span>
          <Badge variant="secondary" className="ml-auto">
            {describeScenario(scenario)}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" />
              Scenario
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty}
              onClick={() => {
                setScenario(DEFAULT_SCENARIO)
                setFailToAdd('')
              }}
            >
              <RotateCcw className="size-4" />
              Reset
            </Button>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Add devices
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={scenario.addCount}
                  onChange={(event) =>
                    setScenario((current) => ({
                      ...current,
                      addCount: Math.max(
                        0,
                        Math.min(50, Number(event.target.value) || 0),
                      ),
                    }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select
                  value={scenario.addType}
                  onValueChange={(value) =>
                    setScenario((current) => ({
                      ...current,
                      addType: value as DeviceType,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {DEVICE_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Site</Label>
                <Select
                  value={addSite}
                  onValueChange={(value) =>
                    setScenario((current) => ({
                      ...current,
                      addSite: value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site} value={site}>
                        {site}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Traffic change
                </Label>
                <span className="text-xs font-medium tabular-nums">
                  {scenario.trafficScale > 0 ? '+' : ''}
                  {Math.round(scenario.trafficScale * 100)}%
                </span>
              </div>
              <Slider
                min={-50}
                max={200}
                step={5}
                value={[Math.round(scenario.trafficScale * 100)]}
                onValueChange={([value]) =>
                  setScenario((current) => ({
                    ...current,
                    trafficScale: (value ?? 0) / 100,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Capacity upgrade
                </Label>
                <span className="text-xs font-medium tabular-nums">
                  +{Math.round(scenario.capacityScale * 100)}%
                </span>
              </div>
              <Slider
                min={0}
                max={100}
                step={5}
                value={[Math.round(scenario.capacityScale * 100)]}
                onValueChange={([value]) =>
                  setScenario((current) => ({
                    ...current,
                    capacityScale: (value ?? 0) / 100,
                  }))
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Take a site offline
                </Label>
                <Select
                  value={scenario.offlineSite ?? 'none'}
                  onValueChange={(value) =>
                    setScenario((current) => ({
                      ...current,
                      offlineSite: value === 'none' ? null : value,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {sites.map((site) => (
                      <SelectItem key={site} value={site}>
                        {site}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Take devices offline
                </Label>
                <Select
                  value={failToAdd}
                  onValueChange={(value) => {
                    setFailToAdd('')
                    setScenario((current) => ({
                      ...current,
                      offlineIds: [...current.offlineIds, value],
                    }))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Add a device…" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableFails.map((device) => (
                      <SelectItem key={device.id} value={device.id}>
                        {device.name} · {device.site}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {scenario.offlineIds.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {scenario.offlineIds.map((id) => {
                  const device = devices.find((item) => item.id === id)
                  return (
                    <Badge
                      key={id}
                      variant="destructive"
                      className="gap-1 pr-1"
                    >
                      {device?.name ?? id}
                      <button
                        type="button"
                        aria-label={`Remove ${device?.name ?? id}`}
                        className="rounded-full p-0.5 hover:bg-background/20"
                        onClick={() =>
                          setScenario((current) => ({
                            ...current,
                            offlineIds: current.offlineIds.filter(
                              (item) => item !== id,
                            ),
                          }))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  )
                })}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <StatCard
            label="Fleet utilisation"
            value={formatPct(projected.fleetUtilPct, 1)}
            icon={Gauge}
            hint={`baseline ${formatPct(baseline.fleetUtilPct, 1)}`}
            trend={utilTrend}
          />
          <StatCard
            label="Saturated devices"
            value={String(projected.saturatedCount)}
            icon={Activity}
            hint={`baseline ${baseline.saturatedCount}`}
            accent={
              projected.saturatedCount > 0 ? 'text-warning' : 'text-success'
            }
          />
          <StatCard
            label="Devices offline"
            value={String(projected.offlineCount)}
            icon={AlertTriangle}
            hint={`baseline ${baseline.offlineCount}`}
            accent={
              projected.offlineCount > 0 ? 'text-destructive' : 'text-success'
            }
          />
          <StatCard
            label="Fleet capacity"
            value={formatMbps(projected.totalCapacityMbps)}
            icon={Layers}
            hint={`${delta.capacityMbps >= 0 ? '+' : ''}${formatMbps(delta.capacityMbps)}`}
          />
        </div>
      </div>

      <ChartCard
        title="Projected fleet utilisation"
        description={`${series.length} simulated steps from now · dashed line is the baseline`}
        height={280}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              tickFormatter={(value) => formatClock(Number(value))}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              width={48}
              domain={[0, 100]}
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={
                <ChartTooltip
                  labelFormatter={(value) => formatClock(Number(value))}
                  valueFormatter={(value) => formatPct(Number(value), 1)}
                />
              }
            />
            <ReferenceLine
              y={SATURATION_THRESHOLD_PCT}
              stroke="hsl(var(--warning))"
              strokeDasharray="4 4"
              label={{
                value: 'saturation',
                position: 'insideTopRight',
                fontSize: 10,
                fill: 'hsl(var(--muted-foreground))',
              }}
            />
            <Line
              type="monotone"
              dataKey="baseline"
              name="Baseline"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="fleetUtilPct"
              name="Projected"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-warning" />
            Devices that would saturate
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {saturated.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              No devices cross the {SATURATION_THRESHOLD_PCT}% saturation
              threshold under this scenario.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Device</th>
                    <th className="px-4 py-2 font-medium">Site</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Projected util
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {saturated.map((entry) => (
                    <tr
                      key={entry.deviceId}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-4 py-2">
                        <span className="font-medium">{entry.name}</span>
                        {entry.added ? (
                          <Badge variant="outline" className="ml-2">
                            planned
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {entry.site}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {DEVICE_TYPE_LABELS[entry.type]}
                      </td>
                      <td className="px-4 py-2 text-right font-medium tabular-nums text-warning">
                        {formatPct(entry.utilPct, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {additions.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="size-4 text-success" />
              Planned additions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {additions.map((device) => (
              <Badge key={device.id} variant="secondary">
                {device.name} · {formatMbps(device.capacityMbps)}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-border/60">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <TrendingUp className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Projections advance the real simulation engine on a cloned snapshot
            seeded for reproducibility. Results model organic drift, traffic
            curve and scenario overlays — treat them as directional, not exact.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
