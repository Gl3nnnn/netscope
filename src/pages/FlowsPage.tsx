import { useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Globe2,
  Radio,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMbps } from '@/lib/format'
import {
  applicationMix,
  buildFlows,
  conversationPairs,
  eastWestRatio,
  flowAnomalies,
  flowSummary,
  topTalkers,
  trafficMatrix,
} from '@/lib/flow'
import { useNetworkStore } from '@/store/useNetworkStore'

const APP_TONES: Record<string, string> = {
  web: 'bg-sky-500',
  video: 'bg-violet-500',
  database: 'bg-emerald-500',
  file: 'bg-amber-500',
  backup: 'bg-orange-500',
  dns: 'bg-cyan-500',
  ssh: 'bg-slate-500',
  mail: 'bg-pink-500',
  voip: 'bg-indigo-500',
  other: 'bg-zinc-500',
}

export function FlowsPage() {
  const devices = useNetworkStore((state) => state.devices)

  const flows = useMemo(() => buildFlows(devices), [devices])
  const summary = useMemo(() => flowSummary(flows), [flows])
  const split = useMemo(() => eastWestRatio(flows), [flows])
  const talkers = useMemo(() => topTalkers(flows, 8), [flows])
  const mix = useMemo(() => applicationMix(flows), [flows])
  const conversations = useMemo(() => conversationPairs(flows, 8), [flows])
  const anomalies = useMemo(() => flowAnomalies(flows), [flows])
  const { sites, matrix } = useMemo(
    () => trafficMatrix(devices, flows),
    [devices, flows],
  )

  const nameOf = (id: string) =>
    devices.find((device) => device.id === id)?.name ?? id

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Flow & Applications"
          description="Simulated NetFlow-style traffic between your devices and sites."
        />
        <EmptyState
          icon={Radio}
          title="No traffic to analyse"
          description="Seed the fleet to generate flow records."
        />
      </div>
    )
  }

  const maxCell = Math.max(1, ...matrix.flat())

  return (
    <div className="space-y-5">
      <PageHeader
        title="Flow & Applications"
        description="Simulated NetFlow-style traffic: top talkers, application mix, conversations and a site-to-site matrix."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total throughput"
          value={formatMbps(summary.totalMbps)}
          icon={Activity}
          hint={`${summary.flowCount} flows`}
        />
        <StatCard
          label="East-west share"
          value={`${split.eastWestPct}%`}
          icon={ArrowLeftRight}
          hint={`${formatMbps(split.northSouthMbps)} north-south`}
        />
        <StatCard
          label="Top application"
          value={mix[0] ? `${mix[0].label} (${mix[0].sharePct}%)` : '—'}
          icon={Globe2}
        />
        <StatCard
          label="Heavy hitters"
          value={`${anomalies.length}`}
          icon={AlertTriangle}
          accent={anomalies.length > 0 ? 'text-warning' : 'text-success'}
          hint="flows >2× app mean"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="size-4 text-primary" />
            Site-to-site traffic matrix
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            East-west throughput between sites (row → column).
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  from / to
                </th>
                {sites.map((site) => (
                  <th
                    key={site}
                    className="p-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {site}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sites.map((rowSite, i) => (
                <tr key={rowSite}>
                  <td className="whitespace-nowrap p-2 text-xs font-medium text-muted-foreground">
                    {rowSite}
                  </td>
                  {sites.map((colSite, j) => {
                    const value = matrix[i]![j]!
                    const intensity = value / maxCell
                    return (
                      <td
                        key={colSite}
                        className="p-2 text-center text-xs tabular-nums"
                        style={{
                          backgroundColor:
                            i === j
                              ? 'transparent'
                              : `rgba(56, 189, 248, ${0.08 + intensity * 0.85})`,
                          color: intensity > 0.55 ? '#082f49' : undefined,
                        }}
                        title={`${rowSite} → ${colSite}: ${formatMbps(value)}`}
                      >
                        {i === j || value === 0 ? (
                          <span className="text-muted-foreground">·</span>
                        ) : (
                          formatMbps(value)
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-primary" />
              Top talkers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {talkers.map((talker) => (
              <div
                key={talker.deviceId}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate">{nameOf(talker.deviceId)}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMbps(talker.throughputMbps)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="size-4 text-primary" />
              Application mix
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {mix.map((share) => (
              <div key={share.application} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate">{share.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMbps(share.throughputMbps)} · {share.sharePct}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${APP_TONES[share.application] ?? 'bg-zinc-500'}`}
                    style={{ width: `${share.sharePct}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="size-4 text-primary" />
              Top conversations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {conversations.map((conversation) => (
              <div
                key={`${conversation.source}|${conversation.dest}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate">
                  {nameOf(conversation.source)} →{' '}
                  {conversation.dest === 'Internet'
                    ? 'Internet'
                    : nameOf(conversation.dest)}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMbps(conversation.throughputMbps)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-warning" />
              Heavy hitters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {anomalies.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No flows stand out above their application average.
              </p>
            ) : (
              anomalies.slice(0, 6).map((anomaly) => (
                <div
                  key={anomaly.flow.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant="warning" className="shrink-0">
                      {anomaly.ratio}×
                    </Badge>
                    <span className="truncate">
                      {nameOf(anomaly.flow.sourceDeviceId)} ·{' '}
                      {anomaly.flow.application}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatMbps(anomaly.flow.throughputMbps)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
