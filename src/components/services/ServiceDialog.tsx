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
import {
  SERVICE_IMPACT_LABELS,
  SERVICE_TIER_LABELS,
  type ServiceImpact,
  type ServiceTier,
} from '@/lib/services'
import type { ServiceDraft } from '@/store/useServicesStore'
import { cn } from '@/lib/utils'

interface ServiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: ServiceDraft
  sites: string[]
  onSubmit: (draft: ServiceDraft) => void
  title: string
}

export function ServiceDialog({
  open,
  onOpenChange,
  initial,
  sites,
  onSubmit,
  title,
}: ServiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {open ? (
          <ServiceForm
            title={title}
            initial={initial}
            sites={sites}
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

const EMPTY: ServiceDraft = {
  name: '',
  description: '',
  tier: 'p2',
  impact: 'productivity',
  deviceIds: [],
  siteNames: [],
  owner: '',
}

function ServiceForm({
  title,
  initial,
  sites,
  onCancel,
  onSubmit,
}: {
  title: string
  initial?: ServiceDraft
  sites: string[]
  onCancel: () => void
  onSubmit: (draft: ServiceDraft) => void
}) {
  const [draft, setDraft] = useState<ServiceDraft>(() => initial ?? EMPTY)

  const patch = (values: Partial<ServiceDraft>) =>
    setDraft((current) => ({ ...current, ...values }))

  const toggleSite = (site: string) =>
    setDraft((current) => ({
      ...current,
      siteNames: current.siteNames.includes(site)
        ? current.siteNames.filter((entry) => entry !== site)
        : [...current.siteNames, site],
    }))

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Map a customer-visible outcome onto the devices and sites that deliver
          it.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="svc-name">Service name</Label>
          <Input
            id="svc-name"
            value={draft.name}
            placeholder="Payments API"
            onChange={(event) => patch({ name: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="svc-desc">Description</Label>
          <Input
            id="svc-desc"
            value={draft.description}
            placeholder="What this service does"
            onChange={(event) => patch({ description: event.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Criticality</Label>
            <Select
              value={draft.tier}
              onValueChange={(value) => patch({ tier: value as ServiceTier })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SERVICE_TIER_LABELS) as ServiceTier[]).map(
                  (tier) => (
                    <SelectItem key={tier} value={tier}>
                      {SERVICE_TIER_LABELS[tier]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Impact</Label>
            <Select
              value={draft.impact}
              onValueChange={(value) =>
                patch({ impact: value as ServiceImpact })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SERVICE_IMPACT_LABELS) as ServiceImpact[]).map(
                  (impact) => (
                    <SelectItem key={impact} value={impact}>
                      {SERVICE_IMPACT_LABELS[impact]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="svc-owner">Owner</Label>
          <Input
            id="svc-owner"
            value={draft.owner ?? ''}
            placeholder="Team or person"
            onChange={(event) => patch({ owner: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Dependent sites</Label>
          <div className="flex flex-wrap gap-2">
            {sites.map((site) => {
              const active = draft.siteNames.includes(site)
              return (
                <button
                  key={site}
                  type="button"
                  onClick={() => toggleSite(site)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    active
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {site}
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
          disabled={!draft.name.trim()}
          onClick={() =>
            onSubmit({
              ...draft,
              name: draft.name.trim(),
              description: draft.description.trim(),
            })
          }
        >
          Save service
        </Button>
      </DialogFooter>
    </>
  )
}
