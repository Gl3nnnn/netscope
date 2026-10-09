import { useMemo, useState } from 'react'
import { Filter, Search, Share2, X } from 'lucide-react'
import type { Device, DeviceStatus, DeviceType } from '@/types'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge } from '@/components/common/Badges'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TopologyCanvas } from '@/components/topology/TopologyCanvas'
import { deriveLinks, NODE_RADIUS } from '@/components/topology/topology'
import { useNetworkStore } from '@/store/useNetworkStore'
import {
  DEVICE_STATUS_LABELS,
  DEVICE_TYPE_LABELS,
  STATUS_HEX,
} from '@/lib/health'
import {
  formatDuration,
  formatMbps,
  formatRelativeTime,
  round,
} from '@/lib/format'

const TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]
const STATUSES: DeviceStatus[] = ['online', 'degraded', 'offline']

export function TopologyPage() {
  const devices = useNetworkStore((state) => state.devices)
  const [query, setQuery] = useState('')
  const [type, setType] = useState<DeviceType | 'all'>('all')
  const [status, setStatus] = useState<DeviceStatus | 'all'>('all')
  const [selected, setSelected] = useState<Device | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return devices.filter((device) => {
      if (type !== 'all' && device.type !== type) return false
      if (status !== 'all' && device.status !== status) return false
      if (!q) return true
      return (
        device.name.toLowerCase().includes(q) ||
        device.ip.toLowerCase().includes(q) ||
        device.site.toLowerCase().includes(q)
      )
    })
  }, [devices, query, type, status])

  const links = useMemo(() => deriveLinks(filtered), [filtered])

  const selectedLive = selected
    ? (devices.find((device) => device.id === selected.id) ?? selected)
    : null

  return (
    <div className="space-y-5">
      <PageHeader
        title="Network Topology"
        description="Interactive DEMO map. Drag nodes, scroll to zoom, drag the background to pan."
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
          <div className="relative flex-1">
            <Label htmlFor="topology-search" className="sr-only">
              Search devices
            </Label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="topology-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name, IP or site"
              className="pl-9"
            />
          </div>
          <div className="flex gap-3">
            <div className="w-40 space-y-1.5">
              <Label htmlFor="topology-type" className="text-xs">
                Type
              </Label>
              <Select
                value={type}
                onValueChange={(value) => setType(value as DeviceType | 'all')}
              >
                <SelectTrigger id="topology-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {DEVICE_TYPE_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40 space-y-1.5">
              <Label htmlFor="topology-status" className="text-xs">
                Status
              </Label>
              <Select
                value={status}
                onValueChange={(value) =>
                  setStatus(value as DeviceStatus | 'all')
                }
              >
                <SelectTrigger id="topology-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {DEVICE_STATUS_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Filter className="size-3.5" />
            {filtered.length} shown
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Share2}
            title="No devices match your filters"
            description="Adjust the search or filters to see devices on the topology map."
          />
        ) : (
          <TopologyCanvas
            devices={filtered}
            links={links}
            selectedId={selectedLive?.id ?? null}
            onSelect={setSelected}
          />
        )}

        <Card className="h-fit">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Device details</CardTitle>
            {selectedLive ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Clear selection"
                onClick={() => setSelected(null)}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {!selectedLive ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Select a node on the map to inspect its simulated telemetry.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{selectedLive.name}</p>
                    <StatusBadge status={selectedLive.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {DEVICE_TYPE_LABELS[selectedLive.type]} -{' '}
                    {selectedLive.site}
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <Detail label="IP" value={selectedLive.ip} mono />
                  <Detail label="MAC" value={selectedLive.mac} mono />
                  <Detail
                    label="Latency"
                    value={`${round(selectedLive.latencyMs, 1)} ms`}
                  />
                  <Detail
                    label="Packet loss"
                    value={`${round(selectedLive.packetLossPct, 2)}%`}
                  />
                  <Detail
                    label="Availability"
                    value={`${round(selectedLive.availabilityPct, 3)}%`}
                  />
                  <Detail
                    label="Throughput"
                    value={formatMbps(selectedLive.throughputMbps)}
                  />
                  <Detail
                    label="CPU"
                    value={`${round(selectedLive.cpuPct, 0)}%`}
                  />
                  <Detail
                    label="Memory"
                    value={`${round(selectedLive.memoryPct, 0)}%`}
                  />
                  <Detail
                    label="Uptime"
                    value={formatDuration(selectedLive.uptimeSec)}
                  />
                  <Detail
                    label="Last seen"
                    value={formatRelativeTime(selectedLive.lastSeen)}
                  />
                </dl>

                {selectedLive.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedLive.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: STATUS_HEX[selectedLive.status] }}
                  />
                  Node radius {NODE_RADIUS[selectedLive.type]}px - DEMO data
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-md border border-border/60 px-2.5 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? 'font-mono text-xs' : 'text-sm'}>{value}</dd>
    </div>
  )
}
