import { ChevronRight, Radar } from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import { NAV_SECTIONS, SETTINGS_ITEM } from '@/config/navigation'
import type { NavItem } from '@/config/navigation'
import { cn } from '@/lib/utils'
import { DemoBadge } from '@/components/common/DemoBadge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useSettingsStore } from '@/store/useSettingsStore'

interface SidebarNavProps {
  collapsed?: boolean
  onNavigate?: () => void
}

function itemActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/'
  return pathname === to || pathname.startsWith(`${to}/`)
}

function NavItemLink({
  item,
  onNavigate,
}: {
  item: NavItem
  onNavigate?: () => void
}) {
  return (
    <li>
      <NavLink
        to={item.to}
        end={item.to === '/'}
        onClick={onNavigate}
        title={item.label}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isActive &&
              'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
          )
        }
      >
        <item.icon className="size-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </NavLink>
    </li>
  )
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const pathname = useLocation().pathname
  const navSectionsOpen = useSettingsStore((state) => state.navSectionsOpen)
  const setNavSectionOpen = useSettingsStore((state) => state.setNavSectionOpen)

  const visibleSections = NAV_SECTIONS.filter(
    (section) => section.items.length > 0,
  )
  const activeSectionId = visibleSections.find((section) =>
    section.items.some((item) => itemActive(item.to, pathname)),
  )?.id

  const isOpen = (id: string, defaultOpen?: boolean) =>
    navSectionsOpen?.[id] ?? defaultOpen ?? false

  if (collapsed) {
    const railItems = [
      ...NAV_SECTIONS.flatMap((section) => section.items),
      SETTINGS_ITEM,
    ]
    return (
      <nav
        className="flex h-full flex-col items-center gap-1 p-2"
        aria-label="Primary"
      >
        <div className="mb-2 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Radar className="size-5" />
        </div>
        <div className="flex w-full flex-1 flex-col items-center gap-1 overflow-y-auto">
          {railItems.map((item) => (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive &&
                        'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                    )
                  }
                >
                  <item.icon className="size-4" />
                  <span className="sr-only">{item.label}</span>
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </nav>
    )
  }

  return (
    <nav className="flex h-full flex-col" aria-label="Primary">
      <div className="flex shrink-0 items-center gap-2 px-3 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Radar className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            NetScope
          </p>
          <p className="truncate text-xs text-muted-foreground">
            Network Monitor
          </p>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {visibleSections.map((section) => {
          const Icon = section.icon
          const open =
            isOpen(section.id, section.defaultOpen) ||
            section.id === activeSectionId
          return (
            <div key={section.id} className="mb-1">
              <button
                type="button"
                onClick={() => setNavSectionOpen(section.id, !open)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="flex-1 truncate text-left">
                  {section.label}
                </span>
                <ChevronRight
                  className={cn(
                    'size-3.5 shrink-0 transition-transform duration-200',
                    open && 'rotate-90',
                  )}
                />
              </button>
              {open ? (
                <ul className="ml-[9px] mt-0.5 space-y-0.5 border-l border-border/60 pl-3">
                  {section.items.map((item) => (
                    <NavItemLink
                      key={item.to}
                      item={item}
                      onNavigate={onNavigate}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="shrink-0 space-y-1 border-t border-border/60 px-2 pt-2">
        <ul>
          <NavItemLink item={SETTINGS_ITEM} onNavigate={onNavigate} />
        </ul>
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border/70 px-2.5 py-2">
          <DemoBadge className="shrink-0" />
          <span className="text-xs text-muted-foreground">Simulated data</span>
        </div>
      </div>
    </nav>
  )
}
