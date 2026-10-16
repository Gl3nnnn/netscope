import { useMemo } from 'react'
import { Hourglass, Stethoscope, Target, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct } from '@/lib/format'
import { runPrediction, type RiskBand } from '@/lib/prediction'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'

const BAND_VARIANT: Record<RiskBand, 'destructive' | 'warning' | 'secondary'> =
  {
    critical: 'destructive',
    high: 'warning',
    medium: 'secondary',
    low: 'secondary',
  }

const bandTone: Record<RiskBand, string> = {
  critical: 'text-destructive',
  high: 'text-warning',
  medium: 'text-muted-foreground',
  low: 'text-success',
}

export function PredictionPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const history = useNetworkStore((state) => state.history)
  const thresholds = useSettingsStore((state) => state.thresholds)

  const result = useMemo(
    () => runPrediction({ devices, thresholds, now: lastTick, seed, history }),
    [devices, thresholds, lastTick, seed, history],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Predictive Failure"
          description="Failure probability, MTBF and remaining useful life."
        />
        <EmptyState
          icon={Stethoscope}
          title="No fleet to predict"
          description="Seed the fleet to score failure risk."
        />
      </div>
    )
  }

  const { summary } = result
  const worst = result.devices[0]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Predictive Failure"
        description="Per-device failure probability over a 90-day horizon, blending lifecycle age, health, saturation and a latency/loss trend slope — with seeded MTBF, remaining-useful-life estimates, named risk contributors and a recommended action."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="At risk (90d)"
          value={`${summary.atRisk}`}
          icon={TriangleAlert}
          accent={summary.atRisk > 0 ? 'text-destructive' : 'text-success'}
          hint={`${summary.critical} critical · ${summary.high} high`}
        />
        <StatCard
          label="Mean probability"
          value={formatPct(summary.meanProb * 100, 1)}
          icon={Stethoscope}
          accent="text-primary"
          hint={`across ${summary.total} devices`}
        />
        <StatCard
          label="Mean useful life"
          value={`${summary.meanRulDays}d`}
          icon={Hourglass}
          accent={summary.meanRulDays < 90 ? 'text-warning' : 'text-success'}
          hint="risk-adjusted estimate"
        />
        <StatCard
          label="Riskiest device"
          value={worst ? formatPct(worst.failureProb * 100, 1) : '—'}
          icon={Target}
          accent="text-destructive"
          hint={worst ? worst.deviceName : ''}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Device predictions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.devices.map((prediction) => (
            <div key={prediction.deviceId} className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {prediction.deviceName}
                  </span>
                  <Badge variant={BAND_VARIANT[prediction.risk]}>
                    {prediction.risk}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {prediction.type} · {prediction.site}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs tabular-nums">
                  <span className={bandTone[prediction.risk]}>
                    {formatPct(prediction.failureProb * 100, 1)} risk
                  </span>
                  <span className="text-muted-foreground">
                    MTBF {Math.round(prediction.mtbfHours).toLocaleString()}h
                  </span>
                  <span className="text-muted-foreground">
                    RUL {prediction.rulDays}d
                  </span>
                  <span className="text-muted-foreground">
                    health {prediction.healthScore.toFixed(0)}
                  </span>
                </div>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${
                    prediction.failureProb >= 0.5
                      ? 'bg-destructive'
                      : prediction.failureProb >= 0.15
                        ? 'bg-warning'
                        : 'bg-success'
                  }`}
                  style={{ width: `${prediction.failureProb * 100}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {prediction.contributors[0]
                    ? `Top factor: ${prediction.contributors[0].label} (${formatPct(prediction.contributors[0].share * 100, 0)})`
                    : 'No risk signals'}
                </span>
                <span>{prediction.action}</span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
