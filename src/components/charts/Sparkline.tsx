import { sparklinePoints } from '@/lib/sparkline'
import { cn } from '@/lib/utils'

interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  stroke?: string
  className?: string
  label?: string
}

/** A tiny inline SVG sparkline. Renders a dash until there are two points. */
export function Sparkline({
  data,
  width = 96,
  height = 24,
  stroke = '#38bdf8',
  className,
  label,
}: SparklineProps) {
  const points = sparklinePoints(data)
  if (!points) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)}>—</span>
    )
  }
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? 'Sparkline'}
      className={cn('overflow-visible', className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
