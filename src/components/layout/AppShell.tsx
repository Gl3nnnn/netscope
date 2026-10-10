import { Suspense, useCallback, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PageLoader } from '@/components/common/PageLoader'
import { CommandPalette } from '@/components/common/CommandPalette'
import { ShortcutsDialog } from '@/components/common/ShortcutsDialog'
import { ChaosPlayboard } from '@/components/chaos/ChaosPlayboard'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SidebarNav } from './SidebarNav'
import { Header } from './Header'
import { useSimulation } from '@/hooks/useSimulation'
import { useTheme } from '@/hooks/useTheme'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useIncidentToasts } from '@/hooks/useIncidentToasts'
import { useSettingsStore } from '@/store/useSettingsStore'
import { cn } from '@/lib/utils'

export function AppShell() {
  useSimulation()
  useTheme()

  const collapsed = useSettingsStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useSettingsStore((state) => state.toggleSidebar)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [chaosOpen, setChaosOpen] = useState(false)

  const openPalette = useCallback(() => setPaletteOpen(true), [])
  const openHelp = useCallback(() => setHelpOpen(true), [])
  const toggleChaos = useCallback(() => setChaosOpen((open) => !open), [])
  const showHelp = useCallback(() => {
    setPaletteOpen(false)
    setHelpOpen(true)
  }, [])
  useHotkeys({
    onOpenPalette: openPalette,
    onOpenHelp: openHelp,
    onToggleChaos: toggleChaos,
  })
  useIncidentToasts()

  return (
    <TooltipProvider delayDuration={200}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <div className="flex min-h-screen">
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 border-r border-border/70 bg-card/40 transition-[width] duration-200 md:block',
            collapsed ? 'w-[68px]' : 'w-60',
          )}
        >
          <SidebarNav collapsed={collapsed} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onToggleSidebar={toggleSidebar}
            onOpenMobileNav={() => setMobileOpen(true)}
            onOpenPalette={openPalette}
            onOpenChaos={toggleChaos}
            chaosOpen={chaosOpen}
          />
          <main id="main-content" className="flex-1 px-3 py-4 sm:px-5 sm:py-6">
            <div className="mx-auto w-full max-w-7xl animate-fade-in">
              <Suspense fallback={<PageLoader />}>
                <Outlet />
              </Suspense>
            </div>
          </main>
          <footer className="border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
            NetScope - DEMO build. All telemetry is simulated and for
            demonstration purposes only.
          </footer>
        </div>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent className="left-0 top-0 h-screen max-w-[280px] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:rounded-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Navigation</DialogTitle>
          </DialogHeader>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </DialogContent>
      </Dialog>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowHelp={showHelp}
      />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ChaosPlayboard open={chaosOpen} onOpenChange={setChaosOpen} />
    </TooltipProvider>
  )
}
