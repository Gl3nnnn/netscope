import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeviceStatus, Severity } from '@/types'
import { Badge } from '@/components/ui/badge'
import {
  DEVICE_STATUS_LABELS,
  SEVERITY_LABELS,
  STATUS_COLORS,
  STATUS_HEX,
} from '@/lib/health'

const severityVariant: Record<
  Severity,
  'destructive' | 'warning' | 'info' | 'secondary'
> = {
  critical: 'destructive',
  high: 'warning',
  medium: 'warning',
  low: 'info',
}

const statusVariant: Record<
  DeviceStatus,
  'success' | 'warning' | 'destructive'
> = {
  online: 'success',
  degraded: 'warning',
  offline: 'destructive',
}

export function StatusBadge({
  status,
  className,
}: {
  status: DeviceStatus
  className?: string
}) {
  return (
    <Badge variant={statusVariant[status]} className={className}>
      <span
        className={cn(
          'size-1.5 rounded-full bg-current',
          STATUS_COLORS[status],
        )}
        aria-hidden
      />
      {DEVICE_STATUS_LABELS[status]}
    </Badge>
  )
}

export function StatusDot({ status }: { status: DeviceStatus }) {
  return (
    <span
      className="inline-flex size-2.5 rounded-full"
      style={{ backgroundColor: STATUS_HEX[status] }}
      aria-label={DEVICE_STATUS_LABELS[status]}
    />
  )
}

export function SeverityBadge({
  severity,
  className,
}: {
  severity: Severity
  className?: string
}) {
  const Icon = severity === 'critical' ? AlertTriangle : undefined
  return (
    <Badge variant={severityVariant[severity]} className={className}>
      {Icon ? <Icon className="size-3" /> : null}
      {SEVERITY_LABELS[severity]}
    </Badge>
  )
}
