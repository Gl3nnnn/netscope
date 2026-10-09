import { FlaskConical } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Every metric in NetScope is simulated. This badge is rendered prominently and
 * in tooltips so users are never misled into thinking real networks are being
 * monitored.
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="warning"
          className={cn('gap-1 font-semibold', className)}
          aria-label="Demo data"
        >
          <FlaskConical className="size-3" />
          DEMO
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        Simulated data only. NetScope does not monitor real networks.
      </TooltipContent>
    </Tooltip>
  )
}
