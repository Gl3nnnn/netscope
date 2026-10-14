import { useMemo } from 'react'
import {
  AlertTriangle,
  Package,
  RefreshCw,
  ShieldCheck,
  Timer,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LIFECYCLE_STATUS_LABELS,
  lifecycleFleet,
  lifecycleSummary,
  refreshQueue,
  type LifecycleStatus,
} from '@/lib/lifecycle'
import { useNetworkStore } from '@/store/useNetworkStore'

const STATUS_VARIANT: Record<LifecycleStatus, string> = {
  active: 'success',
  'approaching-eol': 'warning',
  eol: 'destructive',
}

export function LifecyclePage() {
  const devices = useNetworkStore((state) => state.devices)
  const lastTick = useNetworkStore((state) => state.lastTick)

  const records = useMemo(
    () => lifecycleFleet(devices, lastTick),
    [devices, lastTick],
  )
  const summary = useMemo(() => lifecycleSummary(records), [records])
  const queue = useMemo(() => refreshQueue(records), [records])

  const sorted = useMemo(
    () => [...records].sort((a, b) => b.riskScore - a.riskScore),
    [records],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Asset Lifecycle"
          description="End-of-life, warranty and refresh planning across the fleet."
        />
        <EmptyState
          icon={Package}
          title="No assets to track"
          description="Seed the fleet to model asset lifecycle and refresh risk."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Asset Lifecycle"
        description="Deterministic end-of-life, end-of-support and warranty tracking with a refresh queue."
      />

      <Card className="border-dashed border-primary/40 bg-primary/5">
        <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
          <RefreshCw className="size-4 text-primary" />
          <span className="text-muted-foreground">
            {summary.refreshCount} devices queued for refresh · {summary.eol} at
            end-of-life · {summary.approaching} approaching EOL
          </span>
          <Badge
            variant={summary.eol > 0 ? 'destructive' : 'success'}
            className="ml-auto"
          >
            Avg risk {summary.avgRisk}%
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Assets"
          value={`${summary.total}`}
          icon={Package}
          hint={`oldest ${summary.oldestDays} days`}
        />
        <StatCard
          label="Refresh queue"
          value={`${summary.refreshCount}`}
          icon={RefreshCw}
          accent={summary.refreshCount > 0 ? 'text-warning' : 'text-success'}
          hint="warranty or EOL risk"
        />
        <StatCard
          label="End of life"
          value={`${summary.eol}`}
          icon={AlertTriangle}
          accent={summary.eol > 0 ? 'text-destructive' : 'text-success'}
          hint="past end-of-support"
        />
        <StatCard
          label="Avg risk"
          value={`${summary.avgRisk}%`}
          icon={ShieldCheck}
          hint="EOL + warranty weighted"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Timer className="size-4 text-primary" />
            Assets by risk
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Device</th>
                  <th className="px-4 py-2 font-medium">Site</th>
                  <th className="px-4 py-2 font-medium">Age</th>
                  <th className="px-4 py-2 font-medium">Warranty</th>
                  <th className="px-4 py-2 font-medium">EOL in</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((record) => (
                  <tr
                    key={record.deviceId}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium">{record.deviceName}</span>
                      {record.refresh ? (
                        <Badge variant="warning" className="ml-2 text-[10px]">
                          refresh
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2">{record.site}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {record.ageDays}d
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {record.daysToWarranty > 0
                        ? `${record.daysToWarranty}d`
                        : 'expired'}
                    </td>
                    <td className="px-4 py-2 tabular-nums">
                      {record.daysToEol > 0 ? `${record.daysToEol}d` : 'past'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[record.status] as never}>
                        {LIFECYCLE_STATUS_LABELS[record.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className={
                              record.riskScore >= 70
                                ? 'h-full bg-destructive'
                                : record.riskScore >= 40
                                  ? 'h-full bg-warning'
                                  : 'h-full bg-success'
                            }
                            style={{
                              width: `${Math.round(record.riskScore)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {record.riskScore}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="size-4 text-primary" />
            Refresh queue
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {queue.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No devices need a refresh right now.
            </p>
          ) : (
            queue.slice(0, 12).map((record) => (
              <div
                key={record.deviceId}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate font-medium">
                  {record.deviceName}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  risk {record.riskScore}% ·{' '}
                  {record.status === 'eol'
                    ? 'past EOL'
                    : `warranty ${record.daysToWarranty}d`}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
