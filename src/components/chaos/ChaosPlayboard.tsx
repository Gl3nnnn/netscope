import { useState } from 'react'
import { FlaskConical, ServerCrash, Timer, WifiOff, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { FaultInjection, FaultKind } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useNetworkStore } from '@/store/useNetworkStore'
import { deviceSites } from '@/lib/devices'
import { describeFaultTarget, FAULT_LABELS } from '@/simulation/faults'
import { cn } from '@/lib/utils'

interface ChaosPlayboardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DURATIONS: { label: string; value: string }[] = [
  { label: 'Until cleared', value: 'sticky' },
  { label: '30 seconds', value: '30000' },
  { label: '2 minutes', value: '120000' },
]

const FAULT_ICON: Record<FaultKind, typeof WifiOff> = {
  'device-offline': WifiOff,
  'site-outage': ServerCrash,
  saturate: Zap,
}

const FAULT_VARIANT: Record<FaultKind, 'destructive' | 'warning' | 'info'> = {
  'device-offline': 'destructive',
  'site-outage': 'warning',
  saturate: 'info',
}

export function ChaosPlayboard({ open, onOpenChange }: ChaosPlayboardProps) {
  const devices = useNetworkStore((state) => state.devices)
  const faults = useNetworkStore((state) => state.faults)
  const injectFault = useNetworkStore((state) => state.injectFault)
  const clearFault = useNetworkStore((state) => state.clearFault)
  const clearAllFaults = useNetworkStore((state) => state.clearAllFaults)

  const [deviceId, setDeviceId] = useState('')
  const [site, setSite] = useState('')
  const [duration, setDuration] = useState('sticky')

  if (!open) return null

  const sites = deviceSites(devices)
  const selectedDeviceId = deviceId || devices[0]?.id || ''
  const selectedSite = site || sites[0] || ''
  const durationMs = duration === 'sticky' ? null : Number(duration)

  const inject = (kind: FaultKind, target: string) => {
    if (!target) return
    injectFault(kind, target, durationMs)
    toast.success(`${FAULT_LABELS[kind]} injected`)
  }

  return (
    <div
      role="dialog"
      aria-label="Fault simulator"
      className="fixed bottom-4 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/30 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">
              Fault simulator
            </p>
            <p className="text-[11px] text-muted-foreground">
              Inject faults, watch the DEMO react
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => onOpenChange(false)}
          aria-label="Close fault simulator"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="space-y-3 p-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Target device
          </label>
          <Select value={selectedDeviceId} onValueChange={setDeviceId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Select device" />
            </SelectTrigger>
            <SelectContent>
              {devices.map((device) => (
                <SelectItem key={device.id} value={device.id}>
                  {device.name} - {device.site}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => inject('device-offline', selectedDeviceId)}
            >
              <WifiOff className="size-4" /> Knock offline
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => inject('saturate', selectedDeviceId)}
            >
              <Zap className="size-4" /> Saturate
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Target site
          </label>
          <div className="flex gap-2">
            <Select value={selectedSite} onValueChange={setSite}>
              <SelectTrigger className="h-9 flex-1">
                <SelectValue placeholder="Select site" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => inject('site-outage', selectedSite)}
              disabled={!selectedSite}
            >
              <ServerCrash className="size-4" /> Sever
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Duration
          </label>
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 border-t border-border/70 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Active faults ({faults.length})
            </span>
            {faults.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  clearAllFaults()
                  toast.success('Recovered all faults')
                }}
              >
                Recover all
              </Button>
            ) : null}
          </div>

          {faults.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">
              No active faults. The fleet is running normally.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {faults.map((fault: FaultInjection) => {
                const Icon = FAULT_ICON[fault.kind]
                return (
                  <li
                    key={fault.id}
                    className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {FAULT_LABELS[fault.kind]}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {describeFaultTarget(fault, devices)}
                      </p>
                    </div>
                    {fault.expiresAt === null ? (
                      <Badge
                        variant={FAULT_VARIANT[fault.kind]}
                        className="shrink-0 gap-1 text-[10px]"
                      >
                        <Timer className="size-3" /> sticky
                      </Badge>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => clearFault(fault.id)}
                      aria-label={`Clear fault ${FAULT_LABELS[fault.kind]}`}
                      className={cn(
                        'shrink-0 rounded p-1 text-muted-foreground transition-colors',
                        'hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
