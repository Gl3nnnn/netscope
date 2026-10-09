import { useRef, useState } from 'react'
import {
  Database,
  Download,
  Gauge,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettingsStore, REFRESH_OPTIONS } from '@/store/useSettingsStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import { parseDeviceImport } from '@/storage/persistence'

const SPEED_OPTIONS = [0.5, 1, 2, 5]

export function SettingsPage() {
  const settings = useSettingsStore()
  const exportDevices = useNetworkStore((state) => state.exportDevices)
  const importDevices = useNetworkStore((state) => state.importDevices)
  const resetDemo = useNetworkStore((state) => state.resetDemo)
  const deviceCount = useNetworkStore((state) => state.devices.length)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmSettings, setConfirmSettings] = useState(false)

  const handleExport = () => {
    const blob = new Blob([exportDevices()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `netscope-devices-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast.success('Exported inventory')
  }

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const result = parseDeviceImport(await file.text())
      if (!result.ok || !result.devices) {
        toast.error('Import failed', { description: result.error })
        return
      }
      importDevices(result.devices, 'merge')
      toast.success(`Imported ${result.devices.length} device(s)`)
    } catch {
      toast.error('Import failed', {
        description: 'The file could not be read.',
      })
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Theme, simulation controls and thresholds. Preferences persist locally."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="size-4 text-primary" /> Appearance
            </CardTitle>
            <CardDescription>Theme is stored in your browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Dark mode</Label>
                <p className="text-xs text-muted-foreground">
                  NOC-style dark navy palette.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Sun className="size-4 text-muted-foreground" />
                <Switch
                  checked={settings.theme === 'dark'}
                  onCheckedChange={(checked) =>
                    settings.setTheme(checked ? 'dark' : 'light')
                  }
                  aria-label="Toggle dark mode"
                />
                <Moon className="size-4 text-muted-foreground" />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Collapse sidebar</Label>
                <p className="text-xs text-muted-foreground">
                  Compact icon-only navigation on desktop.
                </p>
              </div>
              <Switch
                checked={settings.sidebarCollapsed}
                onCheckedChange={settings.setSidebarCollapsed}
                aria-label="Toggle collapsed sidebar"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4 text-primary" /> Simulation
            </CardTitle>
            <CardDescription>
              Controls the DEMO data engine in real time.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label>Simulation running</Label>
                <p className="text-xs text-muted-foreground">
                  Pause to freeze all simulated metrics.
                </p>
              </div>
              <Switch
                checked={settings.simulationRunning}
                onCheckedChange={settings.setSimulationRunning}
                aria-label="Toggle simulation"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="refresh-interval">Refresh interval</Label>
                <Select
                  value={String(settings.refreshIntervalMs)}
                  onValueChange={(value) =>
                    settings.setRefreshInterval(Number(value))
                  }
                >
                  <SelectTrigger id="refresh-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REFRESH_OPTIONS.map((ms) => (
                      <SelectItem key={ms} value={String(ms)}>
                        {ms / 1000}s
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="simulation-speed">Speed</Label>
                <Select
                  value={String(settings.simulationSpeed)}
                  onValueChange={(value) =>
                    settings.setSimulationSpeed(Number(value))
                  }
                >
                  <SelectTrigger id="simulation-speed">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPEED_OPTIONS.map((speed) => (
                      <SelectItem key={speed} value={String(speed)}>
                        {speed}x
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Incident frequency</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {Math.round(settings.incidentFrequency * 100)}%
                </span>
              </div>
              <Slider
                value={[settings.incidentFrequency * 100]}
                min={0}
                max={100}
                step={5}
                onValueChange={([value]) =>
                  settings.setIncidentFrequency(value / 100)
                }
                aria-label="Incident frequency"
              />
              <p className="text-xs text-muted-foreground">
                Higher values generate simulated incidents more often.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>History points per device</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {settings.maxHistoryPoints}
                </span>
              </div>
              <Slider
                value={[settings.maxHistoryPoints]}
                min={20}
                max={300}
                step={20}
                onValueChange={([value]) => settings.setMaxHistoryPoints(value)}
                aria-label="History points"
              />
              <p className="text-xs text-muted-foreground">
                Bounds the retained history and keeps storage writes small.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" /> Thresholds
            </CardTitle>
            <CardDescription>
              Values at which a device is flagged as degraded.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ThresholdSlider
              label="Latency"
              value={settings.thresholds.latencyMs}
              unit="ms"
              min={10}
              max={200}
              step={5}
              onChange={(value) => settings.setThreshold('latencyMs', value)}
            />
            <ThresholdSlider
              label="Packet loss"
              value={settings.thresholds.packetLossPct}
              unit="%"
              min={0.5}
              max={10}
              step={0.5}
              onChange={(value) =>
                settings.setThreshold('packetLossPct', value)
              }
            />
            <ThresholdSlider
              label="Availability"
              value={settings.thresholds.availabilityPct}
              unit="%"
              min={90}
              max={100}
              step={0.5}
              onChange={(value) =>
                settings.setThreshold('availabilityPct', value)
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-4 text-primary" /> Data management
            </CardTitle>
            <CardDescription>
              {deviceCount} device(s) stored locally in your browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImport}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download className="size-4" /> Export JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4" /> Import JSON
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmReset(true)}
              >
                <RefreshCw className="size-4" /> Reset demo data
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmSettings(true)}
              >
                <RotateCcw className="size-4" /> Reset settings
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Imported JSON is validated before it is applied. Invalid files are
              rejected and your data is left untouched.
            </p>
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset demo data?"
        destructive
        confirmLabel="Reset"
        description="This replaces your inventory, incidents and events with a freshly seeded demo fleet. This cannot be undone."
        onConfirm={() => {
          resetDemo()
          toast.success('Demo data reset')
        }}
      />

      <ConfirmDialog
        open={confirmSettings}
        onOpenChange={setConfirmSettings}
        title="Reset settings?"
        destructive
        confirmLabel="Reset"
        description="Theme, simulation controls and thresholds return to their defaults."
        onConfirm={() => {
          settings.resetSettings()
          toast.success('Settings reset')
        }}
      />
    </div>
  )
}

function ThresholdSlider({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([next]) => onChange(next)}
        aria-label={`${label} threshold`}
      />
    </div>
  )
}
