import { useMemo } from 'react'
import { CircleAlert, Gauge, Headset, PhoneOff, Radio } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Sparkline } from '@/components/charts/Sparkline'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPct } from '@/lib/format'
import {
  CODEC_LABELS,
  CODEC_PARAMS,
  GRADE_LABELS,
  JITTER_BUDGET_MS,
  LOSS_BUDGET_PCT,
  QUALITY_LABELS,
  type CallQuality,
  type VoiceCodec,
  type VoiceGrade,
  runVoice,
} from '@/lib/voice'
import { SITES } from '@/simulation/seed'
import { useNetworkStore } from '@/store/useNetworkStore'

const CALL_LIMIT = 60
const FINDING_LIMIT = 10

const GRADE_VARIANT: Record<
  VoiceGrade,
  'success' | 'info' | 'warning' | 'destructive'
> = {
  excellent: 'success',
  good: 'info',
  fair: 'warning',
  poor: 'destructive',
}

const QUALITY_VARIANT: Record<
  CallQuality,
  'success' | 'warning' | 'destructive'
> = {
  clear: 'success',
  degraded: 'warning',
  failing: 'destructive',
}

const MOS_TONE = (mos: number): string =>
  mos >= 4 ? 'text-success' : mos >= 3.6 ? 'text-warning' : 'text-destructive'

export function VoicePage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const minute = Math.floor(lastTick / 60_000)

  const voice = useMemo(
    () => runVoice(devices, SITES, seed, minute),
    [devices, seed, minute],
  )

  const codecMix = useMemo(() => {
    const counts: Record<VoiceCodec, number> = { g711: 0, g729: 0, opus: 0 }
    for (const call of voice.calls) counts[call.codec] += 1
    return counts
  }, [voice.calls])

  const atRiskTrunks = useMemo(
    () =>
      voice.findings.filter((finding) => finding.kind === 'single-trunk')
        .length,
    [voice.findings],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Voice & UC"
          description="Call-quality scoring across the fleet."
        />
        <EmptyState
          icon={Headset}
          title="No sites to call"
          description="Seed the fleet to simulate voice traffic."
        />
      </div>
    )
  }

  const { summary } = voice

  return (
    <div className="space-y-5">
      <PageHeader
        title="Voice & UC"
        description="Simulated SIP traffic from every site, scored with the ITU-T G.107 E-model: per-call RTT, jitter and loss map to a mean-opinion score (MOS) against jitter and loss budgets, with trunk redundancy from the WAN circuit inventory."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Avg MOS"
          value={summary.avgMos.toFixed(2)}
          icon={Headset}
          accent={
            summary.avgMos >= 4.3
              ? 'text-success'
              : summary.avgMos >= 4
                ? 'text-warning'
                : 'text-destructive'
          }
          hint={`${summary.calls} calls sampled`}
        />
        <StatCard
          label="Failing calls"
          value={`${summary.failing}`}
          icon={PhoneOff}
          accent={summary.failing > 0 ? 'text-destructive' : 'text-success'}
          hint={`${summary.clear} clear · ${summary.degraded} degraded`}
        />
        <StatCard
          label="Avg jitter"
          value={
            (
              voice.sites.reduce((sum, site) => sum + site.avgJitterMs, 0) /
              Math.max(1, voice.sites.length)
            ).toFixed(0) + ' ms'
          }
          icon={Gauge}
          accent={
            voice.sites.every((site) => site.avgJitterMs <= JITTER_BUDGET_MS)
              ? 'text-success'
              : 'text-destructive'
          }
          hint={`budget ${JITTER_BUDGET_MS} ms · loss ≤ ${LOSS_BUDGET_PCT}%`}
        />
        <StatCard
          label="Trunks at risk"
          value={`${atRiskTrunks}`}
          icon={Radio}
          accent={atRiskTrunks > 0 ? 'text-warning' : 'text-success'}
          hint={`${voice.trunks.length} trunks total`}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Headset className="size-4 text-primary" />
            Site call quality
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Per-site average MOS with a 30-minute trend.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {voice.sites.map((site) => (
            <div
              key={site.site}
              className="space-y-2 rounded-lg border border-border/60 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">
                  {site.site}
                </span>
                <Badge
                  variant={GRADE_VARIANT[site.grade]}
                  className="text-[10px]"
                >
                  {GRADE_LABELS[site.grade]}
                </Badge>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="space-y-0.5 text-xs text-muted-foreground">
                  <div>
                    MOS{' '}
                    <span className={`tabular-nums ${MOS_TONE(site.avgMos)}`}>
                      {site.avgMos.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="tabular-nums text-foreground">
                      {site.avgJitterMs.toFixed(0)}
                    </span>{' '}
                    ms ·{' '}
                    <span className="tabular-nums text-foreground">
                      {site.avgLossPct.toFixed(1)}
                    </span>
                    % loss
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px]">
                      {site.trunkId}
                    </span>
                  </div>
                </div>
                <Sparkline
                  data={site.history}
                  label={`${site.site} MOS trend`}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleAlert className="size-4 text-warning" />
              Findings
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {voice.findings.length} open · sorted by severity
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {voice.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All trunks have backup paths and every site is within budget.
              </p>
            ) : (
              voice.findings.slice(0, FINDING_LIMIT).map((finding) => (
                <div
                  key={finding.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="truncate">{finding.message}</span>
                  <Badge
                    variant={
                      finding.severity === 'critical' ||
                      finding.severity === 'high'
                        ? 'destructive'
                        : finding.severity === 'medium'
                          ? 'warning'
                          : 'secondary'
                    }
                    className="shrink-0 text-[10px]"
                  >
                    {finding.severity}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Radio className="size-4 text-primary" />
              Codec mix
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Share of sampled calls by codec.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {(Object.keys(CODEC_PARAMS) as VoiceCodec[]).map((codec) => {
              const count = codecMix[codec]
              const share = Math.round(
                (count / Math.max(1, summary.calls)) * 100,
              )
              return (
                <div key={codec} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span>{CODEC_LABELS[codec]}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {count} ({share}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              )
            })}
            <p className="text-[11px] text-muted-foreground">
              budgets: jitter ≤ {JITTER_BUDGET_MS} ms, loss ≤ {LOSS_BUDGET_PCT}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="size-4 text-primary" />
            Call detail
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            The current simulated minute's samples, worst MOS first.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Site
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Trunk
                </th>
                <th className="p-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Codec
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  RTT
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Jitter
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Loss
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  MOS
                </th>
                <th className="p-2 text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Quality
                </th>
              </tr>
            </thead>
            <tbody>
              {voice.calls
                .slice()
                .sort((a, b) => a.mos - b.mos)
                .slice(0, CALL_LIMIT)
                .map((call) => (
                  <tr key={call.id} className="border-t border-border/50">
                    <td className="p-2">{call.site}</td>
                    <td className="p-2 font-mono text-[11px] text-muted-foreground">
                      {call.trunkId}
                    </td>
                    <td className="p-2 text-xs">
                      {CODEC_LABELS[call.codec]}
                      <span className="block text-[10px] text-muted-foreground">
                        {CODEC_PARAMS[call.codec].bitrateKbps} kbps
                      </span>
                    </td>
                    <td className="p-2 text-right text-xs tabular-nums">
                      {call.rttMs} ms
                    </td>
                    <td
                      className={`p-2 text-right text-xs tabular-nums ${
                        call.jitterMs > JITTER_BUDGET_MS
                          ? 'text-destructive'
                          : 'text-foreground'
                      }`}
                    >
                      {call.jitterMs} ms
                    </td>
                    <td
                      className={`p-2 text-right text-xs tabular-nums ${
                        call.lossPct > LOSS_BUDGET_PCT
                          ? 'text-destructive'
                          : 'text-foreground'
                      }`}
                    >
                      {formatPct(call.lossPct, 1)}
                    </td>
                    <td
                      className={`p-2 text-right text-xs font-medium tabular-nums ${MOS_TONE(call.mos)}`}
                    >
                      {call.mos.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">
                      <Badge
                        variant={QUALITY_VARIANT[call.quality]}
                        className="text-[10px]"
                      >
                        {QUALITY_LABELS[call.quality]}
                      </Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {voice.calls.length > CALL_LIMIT ? (
            <p className="pt-2 text-center text-[11px] text-muted-foreground">
              showing worst {CALL_LIMIT} of {voice.calls.length} calls
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
