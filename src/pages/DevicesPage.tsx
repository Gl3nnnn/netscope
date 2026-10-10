import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Download,
  Pencil,
  Plus,
  Search,
  Server,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Device, DeviceInput, DeviceStatus, DeviceType } from '@/types'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatusBadge } from '@/components/common/Badges'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DeviceFormDialog } from '@/components/devices/DeviceFormDialog'
import { useNetworkStore } from '@/store/useNetworkStore'
import {
  deviceSites,
  filterDevices,
  sortDevices,
  type DeviceFilters,
  type DeviceSortKey,
  type SortDirection,
} from '@/lib/devices'
import { DEVICE_STATUS_LABELS, DEVICE_TYPE_LABELS } from '@/lib/health'
import { round } from '@/lib/format'
import { parseDeviceImport } from '@/storage/persistence'

const TYPES: DeviceType[] = [
  'router',
  'switch',
  'firewall',
  'server',
  'accessPoint',
]
const STATUSES: DeviceStatus[] = ['online', 'degraded', 'offline']

interface SortState {
  key: DeviceSortKey
  direction: SortDirection
}

export function DevicesPage() {
  const devices = useNetworkStore((state) => state.devices)
  const addDevice = useNetworkStore((state) => state.addDevice)
  const updateDevice = useNetworkStore((state) => state.updateDevice)
  const deleteDevice = useNetworkStore((state) => state.deleteDevice)
  const importDevices = useNetworkStore((state) => state.importDevices)
  const exportDevices = useNetworkStore((state) => state.exportDevices)
  const resetDemo = useNetworkStore((state) => state.resetDemo)

  const [searchParams, setSearchParams] = useSearchParams()
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Device | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Device | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importModeRef = useRef<'merge' | 'replace'>('merge')

  const filters = useMemo<DeviceFilters>(() => {
    const type = searchParams.get('type') as DeviceType | null
    const status = searchParams.get('status') as DeviceStatus | null
    return {
      query: searchParams.get('q') ?? '',
      type: type && TYPES.includes(type) ? type : 'all',
      status: status && STATUSES.includes(status) ? status : 'all',
      site: searchParams.get('site') ?? 'all',
    }
  }, [searchParams])

  const updateFilters = useCallback(
    (patch: Partial<DeviceFilters>) => {
      const next = { ...filters, ...patch }
      const params = new URLSearchParams()
      if (next.query.trim()) params.set('q', next.query)
      if (next.type !== 'all') params.set('type', next.type)
      if (next.status !== 'all') params.set('status', next.status)
      if (next.site !== 'all') params.set('site', next.site)
      setSearchParams(params, { replace: true })
    },
    [filters, setSearchParams],
  )

  const clearFilters = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  const sites = useMemo(() => deviceSites(devices), [devices])

  const rows = useMemo(
    () =>
      sortDevices(filterDevices(devices, filters), sort.key, sort.direction),
    [devices, filters, sort],
  )

  const toggleSort = (key: DeviceSortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    )
  }

  const handleAdd = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const handleEdit = (device: Device) => {
    setEditing(device)
    setFormOpen(true)
  }

  const handleSubmit = (input: DeviceInput) => {
    if (editing) {
      updateDevice(editing.id, input)
      toast.success(`Updated ${input.name}`)
    } else {
      addDevice(input)
      toast.success(`Added ${input.name}`)
    }
  }

  const handleExport = () => {
    const json = exportDevices()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `netscope-devices-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${devices.length} device(s)`)
  }

  const triggerImport = (mode: 'merge' | 'replace') => {
    importModeRef.current = mode
    fileInputRef.current?.click()
  }

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const result = parseDeviceImport(text)
      if (!result.ok || !result.devices) {
        toast.error('Import failed', { description: result.error })
        return
      }
      importDevices(result.devices, importModeRef.current)
      toast.success(
        `Imported ${result.devices.length} device(s) (${importModeRef.current})`,
      )
    } catch {
      toast.error('Import failed', {
        description: 'The file could not be read.',
      })
    }
  }

  const activeFilterCount = [
    filters.type !== 'all',
    filters.status !== 'all',
    filters.site !== 'all',
    filters.query.trim() !== '',
  ].filter(Boolean).length

  return (
    <div className="space-y-5">
      <PageHeader
        title="Device Inventory"
        description="Search, filter, sort and manage the DEMO device fleet."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleFile}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Upload className="size-4" /> Import
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => triggerImport('merge')}>
                  Import &amp; merge
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => triggerImport('replace')}>
                  Import &amp; replace all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={devices.length === 0}
            >
              <Download className="size-4" /> Export
            </Button>
            <Button size="sm" onClick={handleAdd}>
              <Plus className="size-4" /> Add device
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.query}
              onChange={(event) => updateFilters({ query: event.target.value })}
              placeholder="Search name, IP, MAC, site or tag"
              className="pl-9"
              aria-label="Search devices"
            />
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-[440px]">
            <Select
              value={filters.type}
              onValueChange={(value) =>
                updateFilters({ type: value as DeviceType | 'all' })
              }
            >
              <SelectTrigger aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {DEVICE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.status}
              onValueChange={(value) =>
                updateFilters({ status: value as DeviceStatus | 'all' })
              }
            >
              <SelectTrigger aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {DEVICE_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={filters.site}
              onValueChange={(value) => updateFilters({ site: value })}
            >
              <SelectTrigger aria-label="Filter by site">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sites</SelectItem>
                {sites.map((site) => (
                  <SelectItem key={site} value={site}>
                    {site}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {activeFilterCount > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear ({activeFilterCount})
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {devices.length === 0 ? (
        <EmptyState
          icon={Server}
          title="Your inventory is empty"
          description="Add a device manually or load the demo fleet to get started."
          action={
            <div className="flex gap-2">
              <Button onClick={resetDemo}>Load demo data</Button>
              <Button variant="outline" onClick={handleAdd}>
                Add device
              </Button>
            </div>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No devices match your filters"
          description="Try clearing the search or filters."
          action={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  label="Name"
                  sortKey="name"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Type"
                  sortKey="type"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Site"
                  sortKey="site"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Latency"
                  sortKey="latencyMs"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Loss"
                  sortKey="packetLossPct"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="Availability"
                  sortKey="availabilityPct"
                  sort={sort}
                  onSort={toggleSort}
                />
                <SortableHead
                  label="CPU"
                  sortKey="cpuPct"
                  sort={sort}
                  onSort={toggleSort}
                />
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((device) => (
                <TableRow key={device.id}>
                  <TableCell>
                    <Link
                      to={`/devices/${device.id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {device.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">
                      {device.ip}
                    </div>
                  </TableCell>
                  <TableCell>{DEVICE_TYPE_LABELS[device.type]}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {device.site}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={device.status} />
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {round(device.latencyMs, 1)} ms
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {round(device.packetLossPct, 2)}%
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {round(device.availabilityPct, 3)}%
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {round(device.cpuPct, 0)}%
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${device.name}`}
                        onClick={() => handleEdit(device)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${device.name}`}
                        onClick={() => setPendingDelete(device)}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
            <span>
              Showing {rows.length} of {devices.length} devices
            </span>
            <span>All values simulated (DEMO)</span>
          </div>
        </Card>
      )}

      <DeviceFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        device={editing}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete device?"
        destructive
        confirmLabel="Delete"
        description={
          pendingDelete
            ? `This removes ${pendingDelete.name} from your inventory and history. This cannot be undone.`
            : ''
        }
        onConfirm={() => {
          if (!pendingDelete) return
          deleteDevice(pendingDelete.id)
          toast.success(`Deleted ${pendingDelete.name}`)
          setPendingDelete(null)
        }}
      />
    </div>
  )
}

function SortableHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string
  sortKey: DeviceSortKey
  sort: SortState
  onSort: (key: DeviceSortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <TableHead>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active ? (
          sort.direction === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : null}
      </button>
    </TableHead>
  )
}
