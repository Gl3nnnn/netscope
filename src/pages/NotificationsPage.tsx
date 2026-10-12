import { useMemo, useState } from 'react'
import {
  Mail,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Smartphone,
  Trash2,
  Webhook,
  Pencil,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ESCALATION_LABELS,
  describeEscalation,
  type ChannelKind,
  type NotificationChannel,
} from '@/lib/channels'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { SeverityBadge } from '@/components/common/Badges'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { ChannelEditorDialog } from '@/components/channels/ChannelEditorDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useChannelsStore } from '@/store/useChannelsStore'
import { SEVERITY_LABELS } from '@/lib/health'
import { formatClock } from '@/lib/format'

const KIND_ICON: Record<ChannelKind, typeof Mail> = {
  email: Mail,
  slack: MessageSquare,
  webhook: Webhook,
  sms: Smartphone,
}

const LEVEL_VARIANT: Record<number, 'outline' | 'warning' | 'destructive'> = {
  0: 'outline',
  1: 'warning',
  2: 'destructive',
}

export function NotificationsPage() {
  const channels = useChannelsStore((state) => state.channels)
  const deliveries = useChannelsStore((state) => state.deliveries)
  const escalation = useChannelsStore((state) => state.escalation)
  const addChannel = useChannelsStore((state) => state.addChannel)
  const updateChannel = useChannelsStore((state) => state.updateChannel)
  const deleteChannel = useChannelsStore((state) => state.deleteChannel)
  const resetChannels = useChannelsStore((state) => state.resetChannels)
  const setEscalation = useChannelsStore((state) => state.setEscalation)
  const clearDeliveries = useChannelsStore((state) => state.clearDeliveries)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<NotificationChannel | null>(null)
  const [pendingDelete, setPendingDelete] =
    useState<NotificationChannel | null>(null)

  const pages = useMemo(
    () => deliveries.filter((delivery) => delivery.level === 2).length,
    [deliveries],
  )

  const openNew = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (channel: NotificationChannel) => {
    setEditing(channel)
    setDialogOpen(true)
  }

  const submitChannel = (draft: Omit<NotificationChannel, 'id'>) => {
    if (editing) {
      updateChannel(editing.id, draft)
      toast.success('Channel updated')
    } else {
      addChannel(draft)
      toast.success('Channel created')
    }
  }

  const secondsToMs = (value: string) => {
    const seconds = Number(value)
    if (!Number.isFinite(seconds)) return null
    return Math.max(0, Math.round(seconds)) * 1000
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Route firing alerts to channels and escalate the ones that linger."
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                resetChannels()
                toast.success('Restored default channels')
              }}
            >
              <RotateCcw className="size-4" /> Reset
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus className="size-4" /> New channel
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Channels"
          value={String(channels.length)}
          icon={Send}
        />
        <StatCard
          label="Enabled"
          value={String(channels.filter((channel) => channel.enabled).length)}
          icon={Send}
          accent="text-success"
        />
        <StatCard
          label="Deliveries"
          value={String(deliveries.length)}
          icon={Send}
        />
        <StatCard
          label="Pages sent"
          value={String(pages)}
          icon={Send}
          accent="text-destructive"
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Escalation policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="escalation-first">
                Re-notify after (seconds)
              </Label>
              <Input
                id="escalation-first"
                type="number"
                value={String(escalation.firstAfterMs / 1000)}
                onChange={(event) => {
                  const ms = secondsToMs(event.target.value)
                  if (ms !== null) setEscalation({ firstAfterMs: ms })
                }}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="escalation-second">Page after (seconds)</Label>
              <Input
                id="escalation-second"
                type="number"
                value={String(escalation.secondAfterMs / 1000)}
                onChange={(event) => {
                  const ms = secondsToMs(event.target.value)
                  if (ms !== null) setEscalation({ secondAfterMs: ms })
                }}
                className="font-mono"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {describeEscalation(escalation)} · escalated channels are paged only
            on critical alerts.
          </p>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Channels
        </h2>
        {channels.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No channels"
            description="Add a channel to start delivering alerts."
            action={
              <Button size="sm" onClick={openNew}>
                <Plus className="size-4" /> New channel
              </Button>
            }
          />
        ) : (
          channels.map((channel) => {
            const Icon = KIND_ICON[channel.kind]
            return (
              <Card key={channel.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{channel.name}</p>
                        <SeverityBadge severity={channel.minSeverity} />
                        {channel.escalate ? (
                          <Badge variant="outline">Escalates</Badge>
                        ) : null}
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {channel.target}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Notifies on {SEVERITY_LABELS[channel.minSeverity]} and
                        above
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={channel.enabled}
                      onCheckedChange={(value) =>
                        updateChannel(channel.id, { enabled: value })
                      }
                      aria-label={`Toggle ${channel.name}`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEdit(channel)}
                    >
                      <Pencil className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPendingDelete(channel)}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Recent deliveries
          </h2>
          {deliveries.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearDeliveries()
                toast.success('Cleared delivery log')
              }}
            >
              Clear log
            </Button>
          ) : null}
        </div>
        {deliveries.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No deliveries yet"
            description="Firing alerts will be delivered here as the simulation runs."
          />
        ) : (
          <Card>
            <CardContent className="divide-y divide-border/60 p-0">
              {deliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={LEVEL_VARIANT[delivery.level]}>
                        {ESCALATION_LABELS[delivery.level]}
                      </Badge>
                      <SeverityBadge severity={delivery.severity} />
                      <span className="text-sm font-medium">
                        {delivery.alertName}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      → {delivery.channelName} ·{' '}
                      <span className="font-mono">{delivery.target}</span>
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatClock(delivery.at)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      <ChannelEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        channel={editing}
        onSubmit={submitChannel}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title="Delete notification channel"
        description={
          pendingDelete
            ? `Remove "${pendingDelete.name}" and stop delivering to it.`
            : undefined
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) {
            deleteChannel(pendingDelete.id)
            toast.success('Channel deleted')
          }
        }}
      />
    </div>
  )
}
