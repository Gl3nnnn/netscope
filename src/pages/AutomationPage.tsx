import { useMemo, useState } from 'react'
import {
  CalendarClock,
  Clock,
  Pencil,
  Play,
  Plus,
  Power,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { StatCard } from '@/components/common/StatCard'
import {
  ACTION_LABELS,
  describeTrigger,
  windowActive,
  type MaintenanceWindow,
  type Playbook,
} from '@/lib/playbooks'
import { PlaybookEditorDialog } from '@/components/automation/PlaybookEditorDialog'
import { WindowEditorDialog } from '@/components/automation/WindowEditorDialog'
import { deviceSites } from '@/lib/devices'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useAutomationStore } from '@/store/useAutomationStore'

export function AutomationPage() {
  const devices = useNetworkStore((state) => state.devices)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const playbooks = useAutomationStore((state) => state.playbooks)
  const windows = useAutomationStore((state) => state.windows)
  const runs = useAutomationStore((state) => state.runs)
  const enabled = useAutomationStore((state) => state.enabled)
  const setEnabled = useAutomationStore((state) => state.setEnabled)
  const togglePlaybook = useAutomationStore((state) => state.togglePlaybook)
  const addPlaybook = useAutomationStore((state) => state.addPlaybook)
  const updatePlaybook = useAutomationStore((state) => state.updatePlaybook)
  const deletePlaybook = useAutomationStore((state) => state.deletePlaybook)
  const resetPlaybooks = useAutomationStore((state) => state.resetPlaybooks)
  const addWindow = useAutomationStore((state) => state.addWindow)
  const updateWindow = useAutomationStore((state) => state.updateWindow)
  const deleteWindow = useAutomationStore((state) => state.deleteWindow)
  const clearRuns = useAutomationStore((state) => state.clearRuns)

  const [playbookOpen, setPlaybookOpen] = useState(false)
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const [editingWindow, setEditingWindow] = useState<MaintenanceWindow | null>(
    null,
  )
  const [confirm, setConfirm] = useState<{
    title: string
    onConfirm: () => void
  } | null>(null)

  const sites = useMemo(() => deviceSites(devices), [devices])
  const now = lastTick || devices[0]?.lastSeen || 0

  const activeWindows = windows.filter((window) => windowActive(window, now))

  const deviceName = useMemo(
    () => new Map(devices.map((device) => [device.id, device.name])),
    [devices],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Automation"
        description="Playbooks that react to the fleet, and maintenance windows that quiet it."
        actions={
          <>
            <div className="flex items-center gap-2">
              <Power
                className={cn(
                  'size-4',
                  enabled ? 'text-success' : 'text-muted-foreground',
                )}
              />
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Automation enabled"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setEditingWindow(null)
                setWindowOpen(true)
              }}
            >
              <CalendarClock className="size-4" />
              New window
            </Button>
            <Button
              onClick={() => {
                setEditingPlaybook(null)
                setPlaybookOpen(true)
              }}
            >
              <Plus className="size-4" />
              New playbook
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Playbooks"
          value={String(playbooks.filter((pb) => pb.enabled).length)}
          icon={Workflow}
          hint={`${playbooks.length} configured`}
        />
        <StatCard
          label="Active windows"
          value={String(activeWindows.length)}
          icon={CalendarClock}
          hint={`${windows.length} configured`}
          accent={activeWindows.length > 0 ? 'text-warning' : 'text-success'}
        />
        <StatCard
          label="Runs logged"
          value={String(runs.length)}
          icon={Zap}
          hint="this session"
        />
        <StatCard
          label="Automation"
          value={enabled ? 'On' : 'Off'}
          icon={Power}
          accent={enabled ? 'text-success' : 'text-muted-foreground'}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="size-4 text-primary" />
            Playbooks
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={resetPlaybooks}>
            Restore defaults
          </Button>
        </CardHeader>
        <CardContent>
          {playbooks.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title="No playbooks"
              description="Create a playbook to automate a response to fleet conditions."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {playbooks.map((playbook) => (
                <Card key={playbook.id} className="border-border/60">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium">
                            {playbook.name}
                          </p>
                          <Badge
                            variant={playbook.enabled ? 'success' : 'secondary'}
                          >
                            {playbook.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {playbook.description || 'No description'}
                        </p>
                      </div>
                      <Switch
                        checked={playbook.enabled}
                        onCheckedChange={() => togglePlaybook(playbook.id)}
                        aria-label={`Toggle ${playbook.name}`}
                      />
                    </div>
                    <div className="space-y-1 text-xs">
                      <p className="text-muted-foreground">
                        When:{' '}
                        <span className="text-foreground">
                          {describeTrigger(playbook.trigger)}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {playbook.actions.map((action, index) => (
                          <Badge
                            key={`${action.kind}-${index}`}
                            variant="outline"
                          >
                            {ACTION_LABELS[action.kind]}
                            {action.value ? `: ${action.value}` : ''}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingPlaybook(playbook)
                          setPlaybookOpen(true)
                        }}
                      >
                        <Pencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() =>
                          setConfirm({
                            title: `Delete "${playbook.name}"?`,
                            onConfirm: () => deletePlaybook(playbook.id),
                          })
                        }
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4 text-primary" />
            Maintenance windows
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {windows.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              No maintenance windows. Add one to quiet a site or set of devices
              during planned work.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Scope</th>
                    <th className="px-4 py-2 font-medium">Window</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {windows.map((window) => {
                    const active = windowActive(window, now)
                    return (
                      <tr
                        key={window.id}
                        className="border-b border-border/40 last:border-0"
                      >
                        <td className="px-4 py-2">
                          <span className="font-medium">{window.name}</span>
                          {window.suppressAlerts ? (
                            <Badge variant="outline" className="ml-2">
                              suppression
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {window.site ??
                            `${window.deviceIds.length} device(s)`}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {formatDateTime(window.startsAt)} →{' '}
                          {formatDateTime(window.endsAt)}
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant={active ? 'warning' : 'secondary'}>
                            {active ? 'Active' : 'Scheduled'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edit ${window.name}`}
                              onClick={() => {
                                setEditingWindow(window)
                                setWindowOpen(true)
                              }}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              aria-label={`Delete ${window.name}`}
                              onClick={() =>
                                setConfirm({
                                  title: `Delete "${window.name}"?`,
                                  onConfirm: () => deleteWindow(window.id),
                                })
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Play className="size-4 text-primary" />
            Recent runs
          </CardTitle>
          {runs.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={clearRuns}>
              Clear
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">
              Playbooks will log their executions here as conditions are met.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Playbook</th>
                    <th className="px-4 py-2 font-medium">Devices</th>
                    <th className="px-4 py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr
                      key={run.id}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          {formatRelativeTime(run.at, now)}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-medium">
                        {run.playbookName}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {run.deviceIds
                          .map((id) => deviceName.get(id) ?? id)
                          .slice(0, 3)
                          .join(', ')}
                        {run.deviceIds.length > 3
                          ? ` +${run.deviceIds.length - 3}`
                          : ''}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {run.actions.map((action, index) => (
                            <Badge
                              key={`${action.kind}-${index}`}
                              variant="secondary"
                            >
                              {ACTION_LABELS[action.kind]}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <PlaybookEditorDialog
        open={playbookOpen}
        onOpenChange={setPlaybookOpen}
        playbook={editingPlaybook}
        sites={sites}
        onSubmit={(draft) => {
          if (editingPlaybook) updatePlaybook(editingPlaybook.id, draft)
          else addPlaybook(draft)
        }}
      />

      <WindowEditorDialog
        open={windowOpen}
        onOpenChange={setWindowOpen}
        window={editingWindow}
        sites={sites}
        devices={devices}
        now={now}
        onSubmit={(draft) => {
          if (editingWindow) updateWindow(editingWindow.id, draft)
          else addWindow(draft)
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={confirm?.title ?? ''}
        destructive
        confirmLabel="Delete"
        onConfirm={() => confirm?.onConfirm()}
      />
    </div>
  )
}
