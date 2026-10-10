import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Download,
  Keyboard,
  Moon,
  Network,
  Play,
  RotateCcw,
  Search,
  Server,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { NAV_ITEMS } from '@/config/navigation'
import { deviceSites } from '@/lib/devices'
import { DEVICE_TYPE_LABELS } from '@/lib/health'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { downloadText, fileDateStamp } from '@/lib/download'
import { cn } from '@/lib/utils'

type CommandGroup = 'Navigate' | 'Devices' | 'Sites' | 'Incidents' | 'Actions'

interface Command {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  group: CommandGroup
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onShowHelp: () => void
}

export function CommandPalette({
  open,
  onOpenChange,
  onShowHelp,
}: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <PaletteBody onOpenChange={onOpenChange} onShowHelp={onShowHelp} />
      </DialogContent>
    </Dialog>
  )
}

function PaletteBody({
  onOpenChange,
  onShowHelp,
}: Pick<CommandPaletteProps, 'onOpenChange' | 'onShowHelp'>) {
  const navigate = useNavigate()
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const commands = useMemo<Command[]>(() => {
    const navigation: Command[] = NAV_ITEMS.map((item) => ({
      id: `nav-${item.to}`,
      label: item.label,
      hint: item.description,
      icon: item.icon,
      group: 'Navigate',
      run: () => navigate(item.to),
    }))

    const actions: Command[] = [
      {
        id: 'toggle-theme',
        label: 'Toggle theme',
        hint: 'Switch between light and dark',
        icon: Moon,
        group: 'Actions',
        run: () => useSettingsStore.getState().toggleTheme(),
      },
      {
        id: 'toggle-simulation',
        label: 'Toggle simulation',
        hint: 'Pause or resume the DEMO engine',
        icon: Play,
        group: 'Actions',
        run: () => useSettingsStore.getState().toggleSimulation(),
      },
      {
        id: 'export-devices',
        label: 'Export devices JSON',
        hint: 'Download the current inventory',
        icon: Download,
        group: 'Actions',
        run: () => {
          const json = useNetworkStore.getState().exportDevices()
          downloadText(
            `netscope-devices-${fileDateStamp()}.json`,
            json,
            'application/json',
          )
          toast.success('Exported device inventory')
        },
      },
      {
        id: 'reset-demo',
        label: 'Reset demo data',
        hint: 'Restore the seeded demo fleet',
        icon: RotateCcw,
        group: 'Actions',
        run: () => {
          useNetworkStore.getState().resetDemo()
          toast.success('Demo data reset')
        },
      },
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        hint: 'View all available shortcuts',
        icon: Keyboard,
        group: 'Actions',
        run: () => onShowHelp(),
      },
    ]

    if (!query.trim()) return [...navigation, ...actions]

    const deviceCommands: Command[] = devices.map((device) => ({
      id: `device-${device.id}`,
      label: device.name,
      hint: `${DEVICE_TYPE_LABELS[device.type]} - ${device.site}`,
      icon: Server,
      group: 'Devices',
      run: () => navigate(`/devices/${device.id}`),
    }))

    const siteCommands: Command[] = deviceSites(devices).map((site) => ({
      id: `site-${site}`,
      label: site,
      hint: 'Filter the inventory by this site',
      icon: Network,
      group: 'Sites',
      run: () => navigate(`/devices?site=${encodeURIComponent(site)}`),
    }))

    const incidentCommands: Command[] = incidents
      .filter((incident) => incident.status !== 'resolved')
      .slice(0, 8)
      .map((incident) => ({
        id: `incident-${incident.id}`,
        label: incident.title,
        hint: `${incident.deviceIds.length} device(s) - ${incident.severity}`,
        icon: AlertTriangle,
        group: 'Incidents',
        run: () => navigate('/incidents'),
      }))

    return [
      ...navigation,
      ...deviceCommands,
      ...siteCommands,
      ...incidentCommands,
      ...actions,
    ]
  }, [navigate, onShowHelp, query, devices, incidents])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((command) =>
      `${command.label} ${command.hint} ${command.group}`
        .toLowerCase()
        .includes(q),
    )
  }, [commands, query])

  const activeIndex =
    filtered.length === 0 ? 0 : Math.min(selected, filtered.length - 1)

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const runCommand = (command: Command) => {
    onOpenChange(false)
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((current) =>
        filtered.length === 0 ? 0 : (current + 1) % filtered.length,
      )
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((current) =>
        filtered.length === 0
          ? 0
          : (current - 1 + filtered.length) % filtered.length,
      )
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const command = filtered[activeIndex]
      if (command) runCommand(command)
    }
  }

  let lastGroup: Command['group'] | null = null

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border/70 px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search commands and pages..."
          aria-label="Search commands"
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
          Esc
        </kbd>
      </div>

      <div className="max-h-[60vh] overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            No matching commands.
          </p>
        ) : (
          filtered.map((command, index) => {
            const Icon = command.icon
            const showGroup = command.group !== lastGroup
            lastGroup = command.group
            return (
              <div key={command.id}>
                {showGroup ? (
                  <p className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {command.group}
                  </p>
                ) : null}
                <button
                  type="button"
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => runCommand(command)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors',
                    index === activeIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {command.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {command.hint}
                    </span>
                  </span>
                </button>
              </div>
            )
          })
        )}
      </div>
    </>
  )
}
