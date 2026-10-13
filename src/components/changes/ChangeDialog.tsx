import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CHANGE_TYPE_LABELS, type ChangeType } from '@/lib/changes'
import type { Device } from '@/types'
import type { ChangeDraft } from '@/store/useChangeStore'

interface ChangeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  devices: Device[]
  initial?: ChangeDraft
  onSubmit: (draft: ChangeDraft) => void
  title: string
}

function toLocalInput(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): number {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : Date.now()
}

const TYPE_OPTIONS: ChangeType[] = ['standard', 'normal', 'emergency']

export function ChangeDialog({
  open,
  onOpenChange,
  devices,
  initial,
  onSubmit,
  title,
}: ChangeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        {open ? (
          <ChangeForm
            title={title}
            initial={initial}
            devices={devices}
            onCancel={() => onOpenChange(false)}
            onSubmit={(draft) => {
              onSubmit(draft)
              onOpenChange(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ChangeForm({
  title,
  initial,
  devices,
  onCancel,
  onSubmit,
}: {
  title: string
  initial?: ChangeDraft
  devices: Device[]
  onCancel: () => void
  onSubmit: (draft: ChangeDraft) => void
}) {
  const [draft, setDraft] = useState<ChangeDraft>(
    () =>
      initial ?? {
        title: '',
        description: '',
        type: 'normal',
        deviceIds: [],
        siteNames: [],
        plannedStart: Date.now(),
        plannedEnd: Date.now() + 2 * 3_600_000,
        requestedBy: 'You',
      },
  )

  const patch = (values: Partial<ChangeDraft>) =>
    setDraft((current) => ({ ...current, ...values }))

  const toggleDevice = (id: string) =>
    setDraft((current) => ({
      ...current,
      deviceIds: current.deviceIds.includes(id)
        ? current.deviceIds.filter((entry) => entry !== id)
        : [...current.deviceIds, id],
    }))

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Raise a change request for the CAB to review, schedule and verify.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="chg-title">Title</Label>
          <Input
            id="chg-title"
            value={draft.title}
            placeholder="Upgrade core switch firmware"
            onChange={(event) => patch({ title: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="chg-desc">Description</Label>
          <Input
            id="chg-desc"
            value={draft.description}
            placeholder="What will change and the rollback plan"
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select
              value={draft.type}
              onValueChange={(value) => patch({ type: value as ChangeType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {CHANGE_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-req">Requested by</Label>
            <Input
              id="chg-req"
              value={draft.requestedBy}
              onChange={(event) => patch({ requestedBy: event.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="chg-start">Planned start</Label>
            <Input
              id="chg-start"
              type="datetime-local"
              value={toLocalInput(draft.plannedStart)}
              onChange={(event) =>
                patch({ plannedStart: fromLocalInput(event.target.value) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-end">Planned end</Label>
            <Input
              id="chg-end"
              type="datetime-local"
              value={toLocalInput(draft.plannedEnd)}
              onChange={(event) =>
                patch({ plannedEnd: fromLocalInput(event.target.value) })
              }
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Devices in scope ({draft.deviceIds.length})</Label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
            {devices.map((device) => {
              const active = draft.deviceIds.includes(device.id)
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => toggleDevice(device.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/40'
                  }`}
                >
                  <span className="min-w-0 truncate">{device.name}</span>
                  <span className="shrink-0 text-xs">{device.site}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!draft.title.trim() || draft.deviceIds.length === 0}
          onClick={() => {
            const siteNames = [
              ...new Set(
                devices
                  .filter((device) => draft.deviceIds.includes(device.id))
                  .map((device) => device.site),
              ),
            ]
            onSubmit({
              ...draft,
              title: draft.title.trim(),
              description: draft.description.trim(),
              requestedBy: draft.requestedBy.trim() || 'You',
              siteNames,
            })
          }}
        >
          Raise change
        </Button>
      </DialogFooter>
    </>
  )
}
