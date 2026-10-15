import { useMemo } from 'react'
import { Coins, DollarSign, PiggyBank, Scale, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Sparkline } from '@/components/charts/Sparkline'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { COST_CATEGORY_LABELS, runFinops, type SavingsKind } from '@/lib/finops'
import { useNetworkStore } from '@/store/useNetworkStore'

const SAVINGS_LABEL: Record<SavingsKind, string> = {
  'downsize-circuit': 'Circuit',
  decommission: 'Decommission',
  'license-consolidate': 'Licences',
}

const SAVINGS_VARIANT: Record<SavingsKind, 'warning' | 'secondary'> = {
  'downsize-circuit': 'warning',
  decommission: 'warning',
  'license-consolidate': 'secondary',
}

export function FinopsPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)
  const lastTick = useNetworkStore((state) => state.lastTick)

  const result = useMemo(
    () => runFinops(devices, seed, lastTick),
    [devices, seed, lastTick],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="FinOps" description="Cost, budget & savings." />
        <EmptyState
          icon={PiggyBank}
          title="No spend to track"
          description="Seed the fleet to build the cost ledger."
        />
      </div>
    )
  }

  const { summary, sites, savings, history } = result
  const overBudget = summary.varianceUsd > 0
  const maxCategory = Math.max(
    ...Object.values(summary.byCategory).map((value) => value || 0),
    1,
  )
  const maxSite = Math.max(...sites.map((site) => site.monthlyUsd), 1)

  return (
    <div className="space-y-5">
      <PageHeader
        title="FinOps"
        description="One ledger for every simulated dollar: WAN circuits, facility power, software licences and the amortised lifecycle refresh pipeline — budgeted, forecast and ranked savings recommendations."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Monthly spend"
          value={`$${summary.totalMonthlyUsd.toLocaleString()}`}
          icon={DollarSign}
          accent="text-primary"
          hint={`$${summary.costPerDeviceUsd.toFixed(0)} per device`}
        />
        <StatCard
          label={overBudget ? 'Over budget' : 'Under budget'}
          value={`$${Math.abs(summary.varianceUsd).toLocaleString()}`}
          icon={Scale}
          accent={overBudget ? 'text-destructive' : 'text-success'}
          hint={`budget $${summary.budgetUsd.toLocaleString()} · ${summary.variancePct}%`}
        />
        <StatCard
          label="12-month forecast"
          value={`$${(summary.forecast12moUsd / 1000).toFixed(1)}k`}
          icon={TrendingUp}
          accent="text-warning"
          hint="2% MoM growth"
        />
        <StatCard
          label="Savings potential"
          value={`$${summary.savingsPotentialUsd.toFixed(0)}`}
          icon={PiggyBank}
          accent={
            summary.savingsPotentialUsd > 0
              ? 'text-success'
              : 'text-muted-foreground'
          }
          hint={`${savings.length} recommendations`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Coins className="size-4 text-primary" />
                Cost by category
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(
                Object.keys(summary.byCategory) as Array<
                  keyof typeof summary.byCategory
                >
              ).map((category) => {
                const value = summary.byCategory[category]
                return (
                  <div key={category} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{COST_CATEGORY_LABELS[category]}</span>
                      <span className="tabular-nums">
                        ${value.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.max(2, (value / maxCategory) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Spend by site</CardTitle>
              <p className="text-xs text-muted-foreground">
                WAN, power and platform costs rolled up per site.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Site</th>
                      <th className="py-2 pr-3">Monthly</th>
                      <th className="py-2 pr-3">WAN</th>
                      <th className="py-2 pr-3">Power</th>
                      <th className="py-2 pr-3">Platform</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((site) => (
                      <tr
                        key={site.site}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="py-2 pr-3 font-medium">{site.site}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          <span className="flex items-center gap-2">
                            <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{
                                  width: `${Math.max(2, (site.monthlyUsd / maxSite) * 100)}%`,
                                }}
                              />
                            </span>
                            ${site.monthlyUsd.toLocaleString()}
                          </span>
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                          ${site.wanUsd.toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                          ${site.powerUsd.toFixed(2)}
                        </td>
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                          ${site.otherUsd.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="size-4 text-primary" />
                Trailing 12 months
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Monthly total, oldest first.
              </p>
            </CardHeader>
            <CardContent>
              <Sparkline
                data={history}
                height={56}
                label="monthly cost history"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <PiggyBank className="size-4 text-success" />
                Savings recommendations
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                ${summary.savingsPotentialUsd.toFixed(0)}/mo recoverable.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {savings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Fleet is rightsized — no obvious savings right now.
                </p>
              ) : (
                savings.slice(0, 6).map((rec) => (
                  <div key={rec.id} className="space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {rec.title}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <Badge
                          variant={SAVINGS_VARIANT[rec.kind]}
                          className="text-[10px]"
                        >
                          {SAVINGS_LABEL[rec.kind]}
                        </Badge>
                        <span className="tabular-nums text-success">
                          +${rec.monthlySavingUsd.toFixed(0)}
                        </span>
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {rec.detail}
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
