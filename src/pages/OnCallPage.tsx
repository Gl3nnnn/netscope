import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useOnCallStore } from '@/store/useOnCallStore'
import {
  currentOnCall,
  describeRotation,
  escalationChain,
  handoffSchedule,
  type Rotation,
  type Team,
} from '@/lib/oncall'
import { downloadText } from '@/lib/download'
import { formatAge } from '@/lib/time'
import { formatDateTime } from '@/lib/format'
import {
  RotationDialog,
  TeamDialog,
  type RotationDraft,
} from '@/components/oncall/OnCallDialogs'

export function OnCallPage() {
  const teams = useOnCallStore((state) => state.teams)
  const rotations = useOnCallStore((state) => state.rotations)
  const addTeam = useOnCallStore((state) => state.addTeam)
  const updateTeam = useOnCallStore((state) => state.updateTeam)
  const deleteTeam = useOnCallStore((state) => state.deleteTeam)
  const addMember = useOnCallStore((state) => state.addMember)
  const deleteMember = useOnCallStore((state) => state.deleteMember)
  const addRotation = useOnCallStore((state) => state.addRotation)
  const updateRotation = useOnCallStore((state) => state.updateRotation)
  const deleteRotation = useOnCallStore((state) => state.deleteRotation)
  const resetOnCall = useOnCallStore((state) => state.resetOnCall)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const [teamDialogOpen, setTeamDialogOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)
  const [rotationDialogOpen, setRotationDialogOpen] = useState(false)
  const [editingRotation, setEditingRotation] = useState<Rotation | null>(null)

  const onCall = useMemo(
    () => currentOnCall(teams, rotations, now),
    [teams, rotations, now],
  )

  const memberName = useMemo(() => {
    const map = new Map(
      teams.flatMap((team) =>
        team.members.map((member) => [member.id, member.name] as const),
      ),
    )
    return (id: string) => map.get(id) ?? id
  }, [teams])

  const visiting = onCall[0] ?? null
  const chain = visiting
    ? escalationChain(visiting.rotation, teams, now, 3)
    : []

  const exportSchedule = () => {
    const lines = ['# On-call schedule', '']
    for (const entry of onCall) {
      lines.push(`## ${entry.rotation.name} (${entry.team.name})`)
      lines.push(`- Current: ${entry.member?.name ?? 'Unassigned'}`)
      if (entry.next) {
        lines.push(
          `- Next handoff: ${entry.next.memberId} at ${new Date(entry.next.at).toISOString()}`,
        )
      }
      for (const slot of handoffSchedule(entry.rotation, now, 6)) {
        lines.push(
          `- ${new Date(slot.start).toISOString()} → ${new Date(slot.end).toISOString()}: ${slot.memberId}`,
        )
      }
      lines.push('')
    }
    downloadText('oncall-schedule.md', lines.join('\n'), 'text/markdown')
    toast.success('Schedule exported')
  }

  const submitTeam = (name: string) => {
    if (editingTeam) {
      updateTeam(editingTeam.id, { name: name.trim() || editingTeam.name })
      toast.success('Team renamed')
    } else {
      addTeam(name)
      toast.success('Team created')
    }
  }

  const submitRotation = (draft: RotationDraft) => {
    if (editingRotation) {
      updateRotation(editingRotation.id, draft)
      toast.success('Rotation updated')
    } else {
      addRotation(draft)
      toast.success('Rotation created')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="On-Call & Escalation"
        description="Define teams and rotations, see who is on call right now, and preview the escalation chain."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportSchedule}>
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingTeam(null)
                setTeamDialogOpen(true)
              }}
            >
              <Plus className="size-4" /> Team
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={resetOnCall}
              aria-label="Reset on-call schedule"
            >
              <RotateCcw className="size-4" />
            </Button>
            <Button
              size="sm"
              disabled={teams.length === 0}
              onClick={() => {
                setEditingRotation(null)
                setRotationDialogOpen(true)
              }}
            >
              <Plus className="size-4" /> Rotation
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Teams" value={`${teams.length}`} icon={Users} />
        <StatCard
          label="Rotations"
          value={`${rotations.length}`}
          icon={CalendarClock}
        />
        <StatCard
          label="On call now"
          value={`${onCall.filter((entry) => entry.member).length}`}
          icon={BellRing}
          accent="text-success"
        />
        <StatCard
          label="Next handoff"
          value={
            visiting?.next
              ? formatAge(Math.max(0, visiting.next.at - now))
              : '—'
          }
          icon={ArrowRight}
          accent="text-amber-500"
        />
      </div>

      {onCall.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No rotations configured"
          description="Create a team and a rotation to see who is on call."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {onCall.map((entry) => (
            <Card key={entry.rotation.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <span className="truncate">{entry.rotation.name}</span>
                  <Badge variant="outline">{entry.team.name}</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {describeRotation(entry.rotation)}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 rounded-md border border-border/60 bg-card/60 px-3 py-2">
                  <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {(entry.member?.name ?? '?').charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {entry.member?.name ?? 'Unassigned'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.member?.email ?? 'Currently on call'}
                    </p>
                  </div>
                </div>
                {entry.next ? (
                  <p className="text-xs text-muted-foreground">
                    Hands off to {memberName(entry.next.memberId)} in{' '}
                    {formatAge(Math.max(0, entry.next.at - now))}
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  {handoffSchedule(entry.rotation, now, 5).map(
                    (slot, index) => (
                      <div
                        key={slot.start}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-muted-foreground">
                          {index === 0 ? 'Now' : formatDateTime(slot.start)}
                        </span>
                        <span className="truncate font-medium">
                          {slot.memberId ? memberName(slot.memberId) : '—'}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {chain.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-4 text-amber-500" /> Escalation chain
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Who gets paged next for {visiting?.rotation.name}.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            {chain.map((member, index) => (
              <span key={member.id} className="flex items-center gap-2">
                {index > 0 ? (
                  <ArrowRight className="size-4 text-muted-foreground" />
                ) : null}
                <Badge variant={index === 0 ? 'success' : 'outline'}>
                  {index === 0 ? 'Primary' : `L${index}`}: {member.name}
                </Badge>
              </span>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-primary" /> Teams &amp; members
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              onRename={() => {
                setEditingTeam(team)
                setTeamDialogOpen(true)
              }}
              onDelete={() => {
                deleteTeam(team.id)
                toast.success(`Deleted ${team.name}`)
              }}
              onAddMember={(name) => {
                addMember(team.id, { name })
                toast.success('Member added')
              }}
              onRemoveMember={(memberId) => {
                deleteMember(team.id, memberId)
                toast.success('Member removed')
              }}
            />
          ))}
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teams yet.</p>
          ) : null}
        </CardContent>
      </Card>

      {rotations.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rotations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {rotations.map((rotation) => {
              const team = teams.find((entry) => entry.id === rotation.teamId)
              return (
                <div
                  key={rotation.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {rotation.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {team?.name ?? 'Unknown team'} ·{' '}
                      {describeRotation(rotation)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Edit rotation"
                      onClick={() => {
                        setEditingRotation(rotation)
                        setRotationDialogOpen(true)
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive"
                      aria-label="Delete rotation"
                      onClick={() => {
                        deleteRotation(rotation.id)
                        toast.success('Rotation deleted')
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      ) : null}

      <TeamDialog
        open={teamDialogOpen}
        onOpenChange={setTeamDialogOpen}
        team={editingTeam}
        onSubmit={submitTeam}
      />
      <RotationDialog
        open={rotationDialogOpen}
        onOpenChange={setRotationDialogOpen}
        rotation={editingRotation}
        teams={teams}
        onSubmit={submitRotation}
      />
    </div>
  )
}

interface TeamCardProps {
  team: Team
  onRename: () => void
  onDelete: () => void
  onAddMember: (name: string) => void
  onRemoveMember: (memberId: string) => void
}

function TeamCard({
  team,
  onRename,
  onDelete,
  onAddMember,
  onRemoveMember,
}: TeamCardProps) {
  const [draft, setDraft] = useState('')

  return (
    <div className="space-y-3 rounded-md border border-border/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{team.name}</span>
          <Badge variant="secondary">{team.members.length}</Badge>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Rename team"
            onClick={onRename}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive"
            aria-label="Delete team"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        {team.members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="truncate">
              {member.name}
              {member.email ? (
                <span className="text-muted-foreground"> · {member.email}</span>
              ) : null}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground hover:text-destructive"
              aria-label={`Remove ${member.name}`}
              onClick={() => onRemoveMember(member.id)}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
        {team.members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No members yet.</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add member name"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) {
              onAddMember(draft.trim())
              setDraft('')
            }
          }}
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="Add member"
          disabled={!draft.trim()}
          onClick={() => {
            onAddMember(draft.trim())
            setDraft('')
          }}
        >
          <UserPlus className="size-4" />
        </Button>
      </div>
    </div>
  )
}
