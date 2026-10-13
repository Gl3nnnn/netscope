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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ACTION_LABELS,
  PROTO_LABELS,
  type PolicyAction,
  type PolicyProto,
  type PolicyRule,
} from '@/lib/policy'

const ACTIONS: PolicyAction[] = ['allow', 'deny']
const PROTOS: PolicyProto[] = ['tcp', 'udp', 'icmp', 'any']

export interface PolicyDraft {
  action: PolicyAction
  src: string
  dst: string
  port: number
  proto: PolicyProto
  enabled: boolean
  note: string
}

const EMPTY: PolicyDraft = {
  action: 'allow',
  src: '*',
  dst: '*',
  port: 443,
  proto: 'tcp',
  enabled: true,
  note: '',
}

function toDraft(rule: PolicyRule): PolicyDraft {
  return {
    action: rule.action,
    src: rule.src,
    dst: rule.dst,
    port: rule.port,
    proto: rule.proto,
    enabled: rule.enabled,
    note: rule.note ?? '',
  }
}

interface PolicyRuleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing rule to edit, or null to create. */
  rule: PolicyRule | null
  onSubmit: (draft: PolicyDraft) => void
}

export function PolicyRuleDialog({
  open,
  onOpenChange,
  rule,
  onSubmit,
}: PolicyRuleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open ? (
          <PolicyRuleForm
            rule={rule}
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

interface PolicyRuleFormProps {
  rule: PolicyRule | null
  onCancel: () => void
  onSubmit: (draft: PolicyDraft) => void
}

function PolicyRuleForm({ rule, onCancel, onSubmit }: PolicyRuleFormProps) {
  const [draft, setDraft] = useState<PolicyDraft>(() =>
    rule ? toDraft(rule) : EMPTY,
  )

  const patch = (next: Partial<PolicyDraft>) =>
    setDraft((current) => ({ ...current, ...next }))

  const submit = () => {
    onSubmit({
      ...draft,
      src: draft.src.trim() || '*',
      dst: draft.dst.trim() || '*',
      port: Math.max(0, Math.floor(draft.port)),
      note: draft.note.trim(),
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rule ? 'Edit rule' : 'New policy rule'}</DialogTitle>
        <DialogDescription>
          Selectors accept a device id, site, type, or <code>*</code> to match
          anything. Port 0 means any port. Rules are evaluated top-down.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rule-action">Action</Label>
          <Select
            value={draft.action}
            onValueChange={(value) => patch({ action: value as PolicyAction })}
          >
            <SelectTrigger id="rule-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIONS.map((action) => (
                <SelectItem key={action} value={action}>
                  {ACTION_LABELS[action]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-proto">Protocol</Label>
          <Select
            value={draft.proto}
            onValueChange={(value) => patch({ proto: value as PolicyProto })}
          >
            <SelectTrigger id="rule-proto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROTOS.map((proto) => (
                <SelectItem key={proto} value={proto}>
                  {PROTO_LABELS[proto]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-src">Source</Label>
          <Input
            id="rule-src"
            value={draft.src}
            onChange={(event) => patch({ src: event.target.value })}
            placeholder="* or HQ / router / device-id"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-dst">Destination</Label>
          <Input
            id="rule-dst"
            value={draft.dst}
            onChange={(event) => patch({ dst: event.target.value })}
            placeholder="* or server / DC-A"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-port">Port (0 = any)</Label>
          <Input
            id="rule-port"
            type="number"
            min={0}
            value={draft.port}
            onChange={(event) =>
              patch({ port: Number(event.target.value) || 0 })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rule-note">Note</Label>
          <Input
            id="rule-note"
            value={draft.note}
            onChange={(event) => patch({ note: event.target.value })}
            placeholder="Optional description"
          />
        </div>

        <div className="col-span-full flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <Label htmlFor="rule-enabled" className="cursor-pointer">
            Rule enabled
          </Label>
          <Switch
            id="rule-enabled"
            checked={draft.enabled}
            onCheckedChange={(checked) => patch({ enabled: checked })}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit}>{rule ? 'Save' : 'Create rule'}</Button>
      </DialogFooter>
    </>
  )
}
