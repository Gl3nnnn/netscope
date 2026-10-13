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

interface ConfigEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deviceName: string
  content: string
  onSubmit: (content: string, note: string) => void
}

export function ConfigEditorDialog({
  open,
  onOpenChange,
  deviceName,
  content,
  onSubmit,
}: ConfigEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {open ? (
          <ConfigEditorForm
            deviceName={deviceName}
            content={content}
            onCancel={() => onOpenChange(false)}
            onSubmit={(next, note) => {
              onSubmit(next, note)
              onOpenChange(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ConfigEditorForm({
  deviceName,
  content,
  onCancel,
  onSubmit,
}: {
  deviceName: string
  content: string
  onCancel: () => void
  onSubmit: (content: string, note: string) => void
}) {
  const [text, setText] = useState(content)
  const [note, setNote] = useState('Manual edit')

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit running config</DialogTitle>
        <DialogDescription>
          Editing the running configuration of {deviceName}. The changes are
          compared against the approved baseline to detect drift.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="cfg-note">Change note</Label>
          <Input
            id="cfg-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cfg-body">Configuration</Label>
          <textarea
            id="cfg-body"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={16}
            spellCheck={false}
            className="scrollbar-thin w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSubmit(text, note.trim() || 'Manual edit')}>
          Save config
        </Button>
      </DialogFooter>
    </>
  )
}
