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
  INTERVAL_OPTIONS,
  WEEK_MS,
  type Rotation,
  type Team,
} from '@/lib/oncall'
import { cn } from '@/lib/utils'

interface TeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: Team | null
  onSubmit: (name: string) => void
}

export function TeamDialog({
  open,
  onOpenChange,
  team,
  onSubmit,
}: TeamDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        {open ? (
          <TeamForm
            team={team}
            onCancel={() => onOpenChange(false)}
            onSubmit={(name) => {
              onSubmit(name)
              onOpenChange(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function TeamForm({
  team,
  onCancel,
  onSubmit,
}: {
  team: Team | null
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(team?.name ?? '')
  return (
    <>
      <DialogHeader>
        <DialogTitle>{team ? 'Rename team' : 'New team'}</DialogTitle>
        <DialogDescription>
          Teams own a roster of responders that rotations cycle through.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5 py-2">
        <Label htmlFor="team-name">Team name</Label>
        <Input
          id="team-name"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Platform"
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSubmit(name)}>
          {team ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </>
  )
}

export interface RotationDraft {
  name: string
  teamId: string
  intervalMs: number
  members: string[]
}

interface RotationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rotation: Rotation | null
  teams: Team[]
  onSubmit: (draft: RotationDraft) => void
}

export function RotationDialog({
  open,
  onOpenChange,
  rotation,
  teams,
  onSubmit,
}: RotationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {open ? (
          <RotationForm
            rotation={rotation}
            teams={teams}
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

function RotationForm({
  rotation,
  teams,
  onCancel,
  onSubmit,
}: {
  rotation: Rotation | null
  teams: Team[]
  onCancel: () => void
  onSubmit: (draft: RotationDraft) => void
}) {
  const [name, setName] = useState(rotation?.name ?? 'Primary')
  const [teamId, setTeamId] = useState(rotation?.teamId ?? teams[0]?.id ?? '')
  const [intervalMs, setIntervalMs] = useState(rotation?.intervalMs ?? WEEK_MS)
  const [members, setMembers] = useState<string[]>(
    rotation?.members ?? teams[0]?.members.map((member) => member.id) ?? [],
  )

  const team = teams.find((entry) => entry.id === teamId)

  const selectTeam = (id: string) => {
    setTeamId(id)
    const next = teams.find((entry) => entry.id === id)
    setMembers(next?.members.map((member) => member.id) ?? [])
  }

  const toggleMember = (id: string) =>
    setMembers((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    )

  return (
    <>
      <DialogHeader>
        <DialogTitle>{rotation ? 'Edit rotation' : 'New rotation'}</DialogTitle>
        <DialogDescription>
          Members are cycled in order on the chosen interval.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2">
        <div className="space-y-1.5">
          <Label htmlFor="rot-name">Rotation name</Label>
          <Input
            id="rot-name"
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="rot-team">Team</Label>
            <Select value={teamId} onValueChange={selectTeam}>
              <SelectTrigger id="rot-team">
                <SelectValue placeholder="Select team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rot-interval">Interval</Label>
            <Select
              value={String(intervalMs)}
              onValueChange={(value) => setIntervalMs(Number(value))}
            >
              <SelectTrigger id="rot-interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Rotation order</Label>
          <div className="flex flex-wrap gap-2">
            {(team?.members ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This team has no members yet.
              </p>
            ) : (
              team?.members.map((member) => {
                const active = members.includes(member.id)
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:border-primary/50',
                    )}
                  >
                    {members.indexOf(member.id) >= 0 && active
                      ? `${members.indexOf(member.id) + 1}. `
                      : ''}
                    {member.name}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={!teamId || members.length === 0}
          onClick={() => onSubmit({ name, teamId, intervalMs, members })}
        >
          {rotation ? 'Save' : 'Create'}
        </Button>
      </DialogFooter>
    </>
  )
}
