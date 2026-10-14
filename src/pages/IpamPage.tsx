import { useMemo } from 'react'
import {
  AlertTriangle,
  Network,
  Route,
  Server,
  ShieldCheck,
  Waypoints,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { StatCard } from '@/components/common/StatCard'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  findConflicts,
  freeIps,
  ipamSummary,
  subnetUtilization,
  usedIps,
  vlanCatalog,
  type Subnet,
} from '@/lib/ipam'
import { useIpamStore } from '@/store/useIpamStore'

function utilAccent(pct: number): string {
  if (pct >= 80) return 'text-destructive'
  if (pct >= 50) return 'text-warning'
  return 'text-success'
}

function utilVariant(pct: number): 'destructive' | 'warning' | 'success' {
  if (pct >= 80) return 'destructive'
  if (pct >= 50) return 'warning'
  return 'success'
}

export function IpamPage() {
  const subnets = useIpamStore((state) => state.subnets)
  const vlans = useIpamStore((state) => state.vlans)
  const allocations = useIpamStore((state) => state.allocations)

  const summary = useMemo(
    () => ipamSummary(subnets, vlans, allocations),
    [subnets, vlans, allocations],
  )
  const conflicts = useMemo(() => findConflicts(subnets), [subnets])
  const catalog = useMemo(
    () => vlanCatalog(vlans, subnets, allocations),
    [vlans, subnets, allocations],
  )

  const conflictIds = useMemo(() => {
    const ids = new Set<string>()
    conflicts.forEach((conflict) => {
      ids.add(conflict.aId)
      ids.add(conflict.bId)
    })
    return ids
  }, [conflicts])

  if (subnets.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="IP Address Management"
          description="Track subnets, VLANs and IP allocations across every site."
        />
        <EmptyState
          icon={Network}
          title="No subnets defined"
          description="Seed the IPAM ledger to allocate address space."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="IP Address Management"
        description="Subnets, VLANs and allocations with deterministic utilisation and conflict detection."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Subnets"
          value={`${summary.subnetCount}`}
          icon={Network}
          hint={`${summary.vlanCount} VLANs`}
        />
        <StatCard
          label="Addresses in use"
          value={`${summary.totalUsed}`}
          icon={Server}
          hint={`of ${summary.totalCapacity} usable`}
        />
        <StatCard
          label="Overall utilisation"
          value={`${summary.overallUtilPct}%`}
          icon={Route}
          accent={utilAccent(summary.overallUtilPct)}
        />
        <StatCard
          label="Overlapping subnets"
          value={`${summary.conflictCount}`}
          icon={ShieldCheck}
          accent={
            summary.conflictCount > 0 ? 'text-destructive' : 'text-success'
          }
          hint={
            summary.conflictCount > 0
              ? 'resolve overlaps'
              : 'address space is clean'
          }
        />
      </div>

      {conflicts.length > 0 ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" />
              Address conflicts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {conflicts.map((conflict) => (
              <p key={`${conflict.aId}-${conflict.bId}`} className="text-sm">
                {conflict.reason}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="size-4 text-primary" />
            Subnets
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Site</th>
                  <th className="px-4 py-2 font-medium">CIDR</th>
                  <th className="px-4 py-2 font-medium">VLAN</th>
                  <th className="px-4 py-2 font-medium">Gateway</th>
                  <th className="px-4 py-2 font-medium">Used</th>
                  <th className="px-4 py-2 font-medium">Free</th>
                  <th className="px-4 py-2 font-medium">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {subnets.map((subnet: Subnet) => {
                  const pct = subnetUtilization(subnet, allocations)
                  return (
                    <tr
                      key={subnet.id}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-4 py-2">
                        <span className="font-medium">{subnet.site}</span>
                        {conflictIds.has(subnet.id) ? (
                          <Badge
                            variant="destructive"
                            className="ml-2 text-[10px]"
                          >
                            conflict
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {subnet.cidr}
                      </td>
                      <td className="px-4 py-2">{subnet.vlanId}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {subnet.gateway}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {usedIps(subnet.id, allocations)}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {freeIps(subnet, allocations)}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                            <div
                              className={
                                pct >= 80
                                  ? 'h-full bg-destructive'
                                  : pct >= 50
                                    ? 'h-full bg-warning'
                                    : 'h-full bg-success'
                              }
                              style={{ width: `${Math.round(pct)}%` }}
                            />
                          </div>
                          <span
                            className={`text-xs tabular-nums ${utilAccent(pct)}`}
                          >
                            {pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Waypoints className="size-4 text-primary" />
            VLAN catalog
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">VLAN</th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Site</th>
                  <th className="px-4 py-2 font-medium">Subnet</th>
                  <th className="px-4 py-2 font-medium">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((row) => (
                  <tr
                    key={row.vlan.id}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="px-4 py-2 tabular-nums">{row.vlan.id}</td>
                    <td className="px-4 py-2 font-medium">{row.vlan.name}</td>
                    <td className="px-4 py-2">{row.vlan.site}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {row.subnet ? row.subnet.cidr : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={utilVariant(row.utilizationPct)}>
                        {row.utilizationPct}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
