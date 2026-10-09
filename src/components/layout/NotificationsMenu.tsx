import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, BellRing, CheckCheck } from 'lucide-react'
import type { Incident, Severity } from '@/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SeverityBadge } from '@/components/common/Badges'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import { formatRelativeTime } from '@/lib/format'

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const MAX_VISIBLE = 8

function sortIncidents(a: Incident, b: Incident): number {
  const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  return bySeverity !== 0 ? bySeverity : b.createdAt - a.createdAt
}

type PermissionState = NotificationPermission | 'unsupported'

function initialPermission(): PermissionState {
  return typeof Notification === 'undefined'
    ? 'unsupported'
    : Notification.permission
}

export function NotificationsMenu() {
  const incidents = useNetworkStore((state) => state.incidents)
  const readIds = useNotificationsStore((state) => state.readIds)
  const markRead = useNotificationsStore((state) => state.markRead)
  const markManyRead = useNotificationsStore((state) => state.markManyRead)
  const navigate = useNavigate()

  const [permission, setPermission] =
    useState<PermissionState>(initialPermission)
  const knownIds = useRef<Set<string> | null>(null)

  const unread = useMemo(
    () =>
      incidents
        .filter(
          (incident) =>
            incident.status !== 'resolved' && !readIds.includes(incident.id),
        )
        .sort(sortIncidents),
    [incidents, readIds],
  )

  useEffect(() => {
    if (knownIds.current === null) {
      knownIds.current = new Set(incidents.map((incident) => incident.id))
      return
    }
    const seen = knownIds.current
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      for (const incident of incidents) {
        if (!seen.has(incident.id)) {
          new Notification(`NetScope - ${incident.severity} incident`, {
            body: incident.title,
            tag: incident.id,
          })
        }
      }
    }
    knownIds.current = new Set(incidents.map((incident) => incident.id))
  }, [incidents])

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }

  const openIncident = (incident: Incident) => {
    markRead(incident.id)
    navigate('/incidents')
  }

  const count = unread.length

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={
              count > 0
                ? `Notifications, ${count} unread`
                : 'Notifications, none unread'
            }
          >
            {count > 0 ? (
              <BellRing className="size-5" />
            ) : (
              <Bell className="size-5" />
            )}
            {count > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
                {count > 9 ? '9+' : count}
              </span>
            ) : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="flex items-center justify-between">
            <span>Notifications</span>
            <span className="font-normal text-muted-foreground">
              {count} unread
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {unread.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            unread.slice(0, MAX_VISIBLE).map((incident) => (
              <DropdownMenuItem
                key={incident.id}
                onSelect={() => openIncident(incident)}
                className="flex items-start gap-2 py-2"
              >
                <span
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block truncate text-sm font-medium">
                    {incident.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {incident.deviceIds.length} device(s) -{' '}
                    {formatRelativeTime(incident.createdAt)}
                  </span>
                </span>
                <SeverityBadge
                  severity={incident.severity}
                  className="shrink-0"
                />
              </DropdownMenuItem>
            ))
          )}

          {unread.length > MAX_VISIBLE ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              +{unread.length - MAX_VISIBLE} more
            </p>
          ) : null}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={count === 0}
            onSelect={() => markManyRead(unread.map((incident) => incident.id))}
          >
            <CheckCheck className="size-4" /> Mark all as read
          </DropdownMenuItem>
          {permission === 'default' ? (
            <DropdownMenuItem onSelect={() => void requestPermission()}>
              <Bell className="size-4" /> Enable browser alerts
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => navigate('/incidents')}>
            View all incidents
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="sr-only" aria-live="polite">
        {count === 0
          ? 'No unread notifications'
          : `${count} unread notification${count === 1 ? '' : 's'}`}
      </span>
    </>
  )
}
