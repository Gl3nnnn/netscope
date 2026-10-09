import { Radar } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '@/config/navigation'
import { cn } from '@/lib/utils'
import { DemoBadge } from '@/components/common/DemoBadge'

interface SidebarNavProps {
  collapsed?: boolean
  onNavigate?: () => void
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  return (
    <nav className="flex h-full flex-col gap-1 p-3" aria-label="Primary">
      <div
        className={cn(
          'mb-2 flex items-center gap-2 px-2 py-2',
          collapsed && 'justify-center px-0',
        )}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Radar className="size-5" />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              NetScope
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Network Monitor
            </p>
          </div>
        ) : null}
      </div>

      <ul className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                onClick={onNavigate}
                title={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    collapsed && 'justify-center px-0',
                    isActive &&
                      'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed ? (
                  <span className="truncate">{item.label}</span>
                ) : null}
              </NavLink>
            </li>
          )
        })}
      </ul>

      <div
        className={cn(
          'mt-2 flex items-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-2',
          collapsed && 'justify-center px-0',
        )}
      >
        <DemoBadge className="shrink-0" />
        {!collapsed ? (
          <span className="text-xs text-muted-foreground">Simulated data</span>
        ) : null}
      </div>
    </nav>
  )
}
