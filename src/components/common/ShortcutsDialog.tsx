import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Open command palette' },
  { keys: ['?'], label: 'Show this help' },
  { keys: ['T'], label: 'Toggle light / dark theme' },
  { keys: ['P'], label: 'Pause or resume the simulation' },
  { keys: ['F'], label: 'Toggle the fault simulator' },
  { keys: ['ArrowUp', 'ArrowDown'], label: 'Move through palette results' },
  { keys: ['Enter'], label: 'Run the selected command' },
  { keys: ['Esc'], label: 'Close dialogs' },
]

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="space-y-2.5">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-center justify-between gap-4"
            >
              <dt className="text-sm text-muted-foreground">
                {shortcut.label}
              </dt>
              <dd className="flex shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </kbd>
  )
}
