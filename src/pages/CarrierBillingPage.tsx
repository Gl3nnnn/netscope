import { useMemo } from 'react'
import { Coins, ReceiptText, Scale, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { runCarrierBilling } from '@/lib/carrierbilling'
import { useNetworkStore } from '@/store/useNetworkStore'

const FINDING_KIND_LABEL = {
  'missing-credit': 'Missing credit',
  'under-credited': 'Under-credited',
  'invoice-mismatch': 'Invoice mismatch',
} as const

export function CarrierBillingPage() {
  const devices = useNetworkStore((state) => state.devices)
  const seed = useNetworkStore((state) => state.seed)

  const result = useMemo(
    () => runCarrierBilling(devices, seed),
    [devices, seed],
  )

  if (devices.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Carrier Credits"
          description="SLA credits & billing reconciliation."
        />
        <EmptyState
          icon={ReceiptText}
          title="No circuits to bill"
          description="Seed the fleet to generate carrier invoices."
        />
      </div>
    )
  }

  const { entitlements, carriers, findings, summary } = result

  return (
    <div className="space-y-5">
      <PageHeader
        title="Carrier Credits"
        description="Every circuit below its contracted SLA earns a tiered service credit (10/25/50% of the monthly fee). We model what the carrier actually credited and invoiced, then surface the gap — missing credits, under-credits and invoice mismatches — as recoverable amounts and dispute findings per carrier."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Credits entitled"
          value={`$${summary.entitledUsd.toFixed(2)}`}
          icon={Coins}
          accent={summary.entitledUsd > 0 ? 'text-warning' : 'text-success'}
          hint={`${summary.breachCircuits}/${summary.circuits} circuits in breach`}
        />
        <StatCard
          label="Recoverable"
          value={`$${summary.recoverableUsd.toFixed(2)}`}
          icon={Scale}
          accent={
            summary.recoverableUsd > 0 ? 'text-destructive' : 'text-success'
          }
          hint={`${summary.disputes} open disputes`}
        />
        <StatCard
          label="Credit billed"
          value={`$${summary.billedCreditUsd.toFixed(2)}`}
          icon={ReceiptText}
          accent="text-primary"
          hint="what the carrier actually applied"
        />
        <StatCard
          label="Invoice drift"
          value={`${summary.invoiceDeltaUsd >= 0 ? '+' : ''}$${summary.invoiceDeltaUsd.toFixed(2)}`}
          icon={TriangleAlert}
          accent={
            Math.abs(summary.invoiceDeltaUsd) > 1
              ? 'text-warning'
              : 'text-success'
          }
          hint="invoiced vs contracted fees"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ReceiptText className="size-4 text-primary" />
                Credit ledger
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Per-circuit entitlement vs what the carrier billed — worst
                recoverable first.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3">Site / Carrier</th>
                      <th className="py-2 pr-3">Measured</th>
                      <th className="py-2 pr-3">Credit %</th>
                      <th className="py-2 pr-3">Entitled</th>
                      <th className="py-2 pr-3">Billed</th>
                      <th className="py-2 pr-3">Owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...entitlements]
                      .sort((a, b) => b.recoverableUsd - a.recoverableUsd)
                      .slice(0, 20)
                      .map((item) => (
                        <tr
                          key={item.circuitId}
                          className="border-b border-border/40 last:border-0"
                        >
                          <td className="py-2 pr-3">
                            <span className="font-medium">{item.site}</span>
                            <span className="block text-xs text-muted-foreground">
                              {item.carrier}
                            </span>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {item.measuredUptimePct}%
                            <span className="text-xs text-muted-foreground">
                              {' '}
                              / {item.contractedUptimePct}%
                            </span>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {item.creditPct}%
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            ${item.entitledUsd.toFixed(2)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                            ${item.billedCreditUsd.toFixed(2)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {item.recoverableUsd > 0 ? (
                              <Badge
                                variant="destructive"
                                className="text-[10px]"
                              >
                                ${item.recoverableUsd.toFixed(2)}
                              </Badge>
                            ) : (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                settled
                              </Badge>
                            )}
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
                <TriangleAlert className="size-4 text-warning" />
                Findings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All circuits in-SLA and invoices match contract.
                </p>
              ) : (
                findings.slice(0, 8).map((finding) => (
                  <div
                    key={finding.id}
                    className="flex items-start justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      <Badge variant="outline" className="mr-2 text-[10px]">
                        {FINDING_KIND_LABEL[finding.kind]}
                      </Badge>
                      {finding.message}
                    </span>
                    <SeverityBadge severity={finding.severity} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Coins className="size-4 text-success" />
                Carrier rollup
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Recoverable per carrier, worst first.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {carriers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No carriers.</p>
              ) : (
                carriers.map((carrier) => (
                  <div key={carrier.carrier} className="space-y-1 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{carrier.carrier}</span>
                      <span className="tabular-nums text-destructive">
                        ${carrier.recoverableUsd.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {carrier.circuits} circuits · entitled $
                      {carrier.entitledUsd.toFixed(2)} · billed $
                      {carrier.billedCreditUsd.toFixed(2)} · {carrier.disputes}{' '}
                      disputes
                    </p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Credit table</CardTitle>
              <p className="text-xs text-muted-foreground">
                Standard carrier SLA credit curve.
              </p>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">≥ 99.9%</span>
                <span>no credit</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">99.0 – 99.9%</span>
                <span>10% of monthly fee</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">95.0 – 99.0%</span>
                <span>25% of monthly fee</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">&lt; 95.0%</span>
                <span className="text-destructive">50% of monthly fee</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
