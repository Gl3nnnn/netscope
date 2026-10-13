import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  FileCode2,
  GitCompareArrows,
  History,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { StatusBadge } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useConfigsStore } from '@/store/useConfigsStore'
import { detectDrift, resolveConfig } from '@/lib/configs'
import { unifiedDiff } from '@/lib/configdiff'
import { formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ConfigEditorDialog } from '@/components/configs/ConfigEditorDialog'

const DIFF_CLASS = {
  add: 'bg-success/10 text-success',
  remove: 'bg-destructive/10 text-destructive',
  equal: 'text-muted-foreground',
} as const

const DIFF_PREFIX = { add: '+', remove: '-', equal: ' ' } as const

export function ConfigsPage() {
  const devices = useNetworkStore((state) => state.devices)
  const pushEvent = useNetworkStore((state) => state.pushEvent)
  const overrides = useConfigsStore((state) => state.overrides)
  const updateConfig = useConfigsStore((state) => state.updateConfig)
  const acceptBaseline = useConfigsStore((state) => state.acceptBaseline)
  const rollback = useConfigsStore((state) => state.rollback)
  const resetDevice = useConfigsStore((state) => state.resetDevice)

  const [query, setQuery] = useState('')
  const [onlyDrift, setOnlyDrift] = useState(false)
  const [selectedId, setSelectedId] = useState<string>('')
  const [editorOpen, setEditorOpen] = useState(false)

  const rows = useMemo(() => {
    return devices.map((device) => {
      const config = resolveConfig(overrides, device)
      return { device, config, drift: detectDrift(config) }
    })
  }, [devices, overrides])

  const driftedCount = rows.filter((row) => row.drift.drifted).length

  const filtered = rows
    .filter((row) =>
      query
        ? `${row.device.name} ${row.device.site} ${row.device.type}`
            .toLowerCase()
            .includes(query.toLowerCase())
        : true,
    )
    .filter((row) => (onlyDrift ? row.drift.drifted : true))
    .sort((a, b) => a.device.name.localeCompare(b.device.name))

  const selected =
    rows.find((row) => row.device.id === selectedId) ??
    filtered[0] ??
    rows[0] ??
    null

  const diff = selected
    ? unifiedDiff(selected.config.baseline, selected.config.current, 3)
    : []

  const logEvent = (message: string, deviceId: string) =>
    pushEvent({
      timestamp: Date.now(),
      type: 'config',
      severity: 'low',
      message,
      deviceId,
    })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Configuration & Drift"
        description="Compare each device's running configuration against its approved baseline, review changes and remediate drift."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Configs tracked"
          value={`${rows.length}`}
          icon={FileCode2}
        />
        <StatCard
          label="Drifted"
          value={`${driftedCount}`}
          icon={GitCompareArrows}
          accent={driftedCount > 0 ? 'text-amber-500' : 'text-success'}
        />
        <StatCard
          label="In compliance"
          value={`${rows.length - driftedCount}`}
          icon={CheckCircle2}
          accent="text-success"
        />
        <StatCard
          label="Stored versions"
          value={`${rows.reduce((sum, row) => sum + row.config.versions.length, 0)}`}
          icon={History}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileCode2}
          title="No devices"
          description="Add devices to manage their configurations."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <Card className="h-fit">
            <CardHeader className="space-y-3 pb-3">
              <CardTitle className="text-base">Devices</CardTitle>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter devices…"
              />
              <button
                type="button"
                onClick={() => setOnlyDrift((value) => !value)}
                className={cn(
                  'inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  onlyDrift
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-500'
                    : 'border-border/60 text-muted-foreground hover:border-amber-500/40',
                )}
              >
                <GitCompareArrows className="size-3" />
                Drifted only
              </button>
            </CardHeader>
            <CardContent className="scrollbar-thin max-h-[32rem] space-y-1 overflow-y-auto">
              {filtered.map((row) => {
                const active = selected?.device.id === row.device.id
                return (
                  <button
                    key={row.device.id}
                    type="button"
                    onClick={() => setSelectedId(row.device.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-transparent hover:bg-muted/50',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {row.device.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.device.site} · {row.device.type}
                      </span>
                    </span>
                    {row.drift.drifted ? (
                      <Badge variant="warning" className="shrink-0">
                        drift
                      </Badge>
                    ) : (
                      <ShieldCheck className="size-4 shrink-0 text-success" />
                    )}
                  </button>
                )
              })}
              {filtered.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted-foreground">
                  No matching devices.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {selected ? (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <span className="truncate">{selected.device.name}</span>
                    <StatusBadge status={selected.device.status} />
                    {selected.drift.drifted ? (
                      <Badge variant="warning">
                        {selected.drift.added} added · {selected.drift.removed}{' '}
                        removed
                      </Badge>
                    ) : (
                      <Badge variant="success">in compliance</Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {selected.config.updatedAt > 0
                      ? `Last change ${formatRelativeTime(selected.config.updatedAt)}`
                      : 'Provisioned from template'}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setEditorOpen(true)}>
                    <Pencil className="size-4" /> Edit running config
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!selected.drift.drifted}
                    onClick={() => {
                      acceptBaseline(selected.device)
                      logEvent(
                        `Configuration baseline accepted for ${selected.device.name}`,
                        selected.device.id,
                      )
                      toast.success('Baseline updated')
                    }}
                  >
                    <ShieldCheck className="size-4" /> Accept as baseline
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetDevice(selected.device.id)
                      logEvent(
                        `Configuration reset to template for ${selected.device.name}`,
                        selected.device.id,
                      )
                      toast.success('Reset to template')
                    }}
                  >
                    <RotateCcw className="size-4" /> Reset
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <GitCompareArrows className="size-4 text-primary" />{' '}
                    Baseline → running diff
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Red lines exist in the baseline but not the running config;
                    green lines are new.
                  </p>
                </CardHeader>
                <CardContent>
                  {!selected.drift.drifted ? (
                    <p className="flex items-center gap-2 py-4 text-sm text-success">
                      <CheckCircle2 className="size-4" /> Running config matches
                      the approved baseline.
                    </p>
                  ) : (
                    <div className="scrollbar-thin max-h-[24rem] overflow-auto rounded-md border border-border/60 bg-muted/10 font-mono text-xs">
                      {diff.map((line, index) =>
                        line.skipped ? (
                          <div
                            key={`skip-${index}`}
                            className="bg-muted/30 px-3 py-1 text-center text-muted-foreground"
                          >
                            … {line.skipped} unchanged line
                            {line.skipped === 1 ? '' : 's'} …
                          </div>
                        ) : (
                          <div
                            key={index}
                            className={cn(
                              'flex gap-2 px-3 py-0.5',
                              DIFF_CLASS[line.type],
                            )}
                          >
                            <span className="select-none opacity-60">
                              {DIFF_PREFIX[line.type]}
                            </span>
                            <span className="whitespace-pre-wrap break-all">
                              {line.text || ' '}
                            </span>
                          </div>
                        ),
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="size-4" /> Version history
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selected.config.versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No recorded versions yet. Editing the config records the
                      previous state here.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selected.config.versions.map((version) => (
                        <div
                          key={version.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {version.note}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatRelativeTime(version.at)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              rollback(selected.device, version.id)
                              logEvent(
                                `Configuration rolled back on ${selected.device.name}`,
                                selected.device.id,
                              )
                              toast.success('Rolled back')
                            }}
                          >
                            <Undo2 className="size-4" /> Rollback
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      )}

      {selected ? (
        <ConfigEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          deviceName={selected.device.name}
          content={selected.config.current}
          onSubmit={(content, note) => {
            updateConfig(selected.device, content, note)
            logEvent(
              `Configuration changed on ${selected.device.name}`,
              selected.device.id,
            )
            toast.success('Configuration saved')
          }}
        />
      ) : null}
    </div>
  )
}
