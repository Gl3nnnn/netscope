import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Clock,
  Cpu,
  Server,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { EventType, TimelineEvent } from '@/types'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { SeverityBadge } from '@/components/common/Badges'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNetworkStore } from '@/store/useNetworkStore'
import { formatDateTime, formatRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const EVENT_TYPES: { value: EventType | 'all'; label: string }[] = [
  { value: 'all', label: 'All events' },
  { value: 'status', label: 'Status changes' },
  { value: 'incident', label: 'Incidents' },
  { value: 'device', label: 'Device changes' },
  { value: 'config', label: 'Configuration' },
]

const EVENT_ICON: Record<EventType, typeof Clock> = {
  status: Server,
  incident: AlertTriangle,
  device: Cpu,
  config: SlidersHorizontal,
}

const EVENT_ACCENT: Record<EventType, string> = {
  status: 'text-info',
  incident: 'text-warning',
  device: 'text-primary',
  config: 'text-muted-foreground',
}

export function TimelinePage() {
  const events = useNetworkStore((state) => state.events)
  const devices = useNetworkStore((state) => state.devices)
  const clearEvents = useNetworkStore((state) => state.clearEvents)
  const [type, setType] = useState<EventType | 'all'>('all')

  const deviceName = useMemo(
    () => new Map(devices.map((device) => [device.id, device.name])),
    [devices],
  )

  const filtered = useMemo(
    () =>
      (type === 'all'
        ? [...events]
        : events.filter((event) => event.type === type)
      ).sort((a, b) => b.timestamp - a.timestamp),
    [events, type],
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title="Event Timeline"
        description="Chronological device status changes and incident activity (DEMO)."
        actions={
          <div className="flex items-center gap-2">
            <div className="w-44">
              <Select
                value={type}
                onValueChange={(value) => setType(value as EventType | 'all')}
              >
                <SelectTrigger aria-label="Filter by event type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={events.length === 0}
              onClick={() => {
                clearEvents()
                toast.success('Timeline cleared')
              }}
            >
              <Trash2 className="size-4" /> Clear
            </Button>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No events to display"
          description="Device status changes and incident activity will stream here as the simulation runs."
        />
      ) : (
        <Card>
          <CardContent className="p-4">
            <ol className="relative space-y-4 border-l border-border/70 pl-5">
              {filtered.slice(0, 200).map((event) => (
                <TimelineRow
                  key={event.id}
                  event={event}
                  deviceName={deviceName.get(event.deviceId ?? '')}
                />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TimelineRow({
  event,
  deviceName,
}: {
  event: TimelineEvent
  deviceName?: string
}) {
  const Icon = EVENT_ICON[event.type]
  return (
    <li className="relative">
      <span className="absolute -left-[27px] flex size-6 items-center justify-center rounded-full border border-border/70 bg-card">
        <Icon className={cn('size-3.5', EVENT_ACCENT[event.type])} />
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">{event.message}</p>
        {event.severity ? <SeverityBadge severity={event.severity} /> : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {deviceName ? `${deviceName} - ` : ''}
        <time dateTime={new Date(event.timestamp).toISOString()}>
          {formatDateTime(event.timestamp)}
        </time>{' '}
        ({formatRelativeTime(event.timestamp)})
      </p>
    </li>
  )
}
