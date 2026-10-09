import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

interface StatCardProps {
  label: string
  value: string
  icon: LucideIcon
  hint?: string
  trend?: { value: string; direction: 'up' | 'down'; positive?: boolean }
  accent?: string
  className?: string
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  trend,
  accent = 'text-primary',
  className,
}: StatCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint ? (
            <p className="truncate text-xs text-muted-foreground">{hint}</p>
          ) : null}
          {trend ? (
            <p
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                trend.positive === false ? 'text-destructive' : 'text-success',
              )}
            >
              {trend.direction === 'up' ? (
                <ArrowUpRight className="size-3" />
              ) : (
                <ArrowDownRight className="size-3" />
              )}
              {trend.value}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/60',
            accent,
          )}
        >
          <Icon className="size-5" />
        </div>
      </CardContent>
    </Card>
  )
}
