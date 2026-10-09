import { useEffect, useState } from 'react'
import { Menu, Moon, PanelLeft, Pause, Play, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DemoBadge } from '@/components/common/DemoBadge'
import { NotificationsMenu } from './NotificationsMenu'
import { useSettingsStore } from '@/store/useSettingsStore'
import { formatClock } from '@/lib/format'

interface HeaderProps {
  onToggleSidebar: () => void
  onOpenMobileNav: () => void
}

export function Header({ onToggleSidebar, onOpenMobileNav }: HeaderProps) {
  const theme = useSettingsStore((state) => state.theme)
  const toggleTheme = useSettingsStore((state) => state.toggleTheme)
  const simulationRunning = useSettingsStore((state) => state.simulationRunning)
  const toggleSimulation = useSettingsStore((state) => state.toggleSimulation)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border/70 bg-background/80 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="hidden md:inline-flex"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="size-5" />
      </Button>

      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-semibold">
          Network Operations
        </span>
        <DemoBadge className="hidden sm:inline-flex" />
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <span
          className="hidden font-mono text-xs text-muted-foreground sm:block"
          aria-label="Current time"
        >
          {formatClock(now)}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={simulationRunning ? 'outline' : 'default'}
              size="sm"
              onClick={toggleSimulation}
              aria-pressed={simulationRunning}
            >
              {simulationRunning ? (
                <Pause className="size-4" />
              ) : (
                <Play className="size-4" />
              )}
              <span className="hidden sm:inline">
                {simulationRunning ? 'Pause' : 'Resume'}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {simulationRunning
              ? 'Pause the DEMO simulation'
              : 'Resume the DEMO simulation'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <Sun className="size-5" />
              ) : (
                <Moon className="size-5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Switch to {theme === 'dark' ? 'light' : 'dark'} mode
          </TooltipContent>
        </Tooltip>

        <NotificationsMenu />
      </div>
    </header>
  )
}
