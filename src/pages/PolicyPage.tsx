import { useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FlaskConical,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Route as RouteIcon,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { StatCard } from '@/components/common/StatCard'
import { StatusDot } from '@/components/common/Badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useNetworkStore } from '@/store/useNetworkStore'
import { usePolicyStore } from '@/store/usePolicyStore'
import {
  analyzeRules,
  describeRule,
  ACTION_LABELS,
  PROTO_LABELS,
  type PolicyAction,
  type PolicyProto,
  type PolicyRule,
} from '@/lib/policy'
import {
  explainPath,
  reachabilityMatrix,
  whatIfPolicy,
  type ReachOptions,
} from '@/lib/reachability'
import { cn } from '@/lib/utils'
import {
  PolicyRuleDialog,
  type PolicyDraft,
} from '@/components/policy/PolicyRuleDialog'

const PROTOS: PolicyProto[] = ['tcp', 'udp', 'icmp', 'any']
const ACTIONS: PolicyAction[] = ['allow', 'deny']

function shortName(name: string): string {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name
}

const ISSUE_META = {
  shadowed: { variant: 'destructive', label: 'Shadowed' },
  redundant: { variant: 'warning', label: 'Redundant' },
  unused: { variant: 'secondary', label: 'Unused' },
} as const

export function PolicyPage() {
  const devices = useNetworkStore((state) => state.devices)
  const rules = usePolicyStore((state) => state.rules)
  const addRule = usePolicyStore((state) => state.addRule)
  const updateRule = usePolicyStore((state) => state.updateRule)
  const deleteRule = usePolicyStore((state) => state.deleteRule)
  const toggleRule = usePolicyStore((state) => state.toggleRule)
  const moveRule = usePolicyStore((state) => state.moveRule)
  const resetPolicy = usePolicyStore((state) => state.resetPolicy)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PolicyRule | null>(null)
  const [port, setPort] = useState(443)
  const [proto, setProto] = useState<Exclude<PolicyProto, 'any'>>('tcp')
  const [pathSrc, setPathSrc] = useState('')
  const [pathDst, setPathDst] = useState('')
  const [whatIf, setWhatIf] = useState<PolicyDraft>({
    action: 'allow',
    src: '*',
    dst: '*',
    port: 443,
    proto: 'tcp',
    enabled: true,
    note: '',
  })

  const deviceName = useMemo(
    () => new Map(devices.map((device) => [device.id, device.name])),
    [devices],
  )
  const nameOf = (id: string) => deviceName.get(id) ?? id

  const options: ReachOptions = { port, proto }

  const issues = useMemo(() => analyzeRules(rules, devices), [rules, devices])
  const issueByRule = useMemo(
    () => new Map(issues.map((issue) => [issue.ruleId, issue])),
    [issues],
  )

  const matrix = useMemo(
    () => reachabilityMatrix(devices, rules, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [devices, rules, port, proto],
  )

  const explanation = useMemo(() => {
    if (!pathSrc || !pathDst) return null
    return explainPath(devices, rules, pathSrc, pathDst, options)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, rules, pathSrc, pathDst, port, proto])

  const impact = useMemo(() => {
    if (!whatIf.src && !whatIf.dst) return null
    return whatIfPolicy(
      devices,
      rules,
      {
        order: -1,
        action: whatIf.action,
        src: whatIf.src.trim() || '*',
        dst: whatIf.dst.trim() || '*',
        port: Math.max(0, Math.floor(whatIf.port)),
        proto: whatIf.proto,
        enabled: true,
        note: whatIf.note.trim() || undefined,
      },
      options,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, rules, whatIf, port, proto])

  const allowCount = rules.filter((rule) => rule.action === 'allow').length
  const enabledCount = rules.filter((rule) => rule.enabled).length

  const openCreate = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (rule: PolicyRule) => {
    setEditing(rule)
    setDialogOpen(true)
  }

  const submitRule = (draft: PolicyDraft) => {
    if (editing) {
      updateRule(editing.id, draft)
      toast.success('Rule updated')
    } else {
      addRule(draft)
      toast.success('Rule created')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Policy & Reachability"
        description="Author the ACL that governs east-west and north-south flows, then verify what can actually reach what."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={resetPolicy}>
              <RotateCcw className="size-4" /> Reset policy
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-4" /> New rule
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Rules"
          value={`${rules.length}`}
          icon={ShieldCheck}
          hint={`${enabledCount} enabled`}
        />
        <StatCard
          label="Allow rules"
          value={`${allowCount}`}
          icon={CheckCircle2}
          accent="text-success"
        />
        <StatCard
          label="Deny rules"
          value={`${rules.length - allowCount}`}
          icon={XCircle}
          accent="text-destructive"
        />
        <StatCard
          label="Policy issues"
          value={`${issues.length}`}
          icon={ShieldAlert}
          accent={issues.length > 0 ? 'text-amber-500' : 'text-success'}
          hint={
            issues.length > 0
              ? 'shadowed / redundant / unused'
              : 'policy is clean'
          }
        />
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="reachability">Reachability</TabsTrigger>
          <TabsTrigger value="whatif">What-if</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          {issues.length > 0 ? (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="size-4 text-amber-500" /> Policy
                  analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {issues.map((issue) => {
                  const meta = ISSUE_META[issue.kind]
                  return (
                    <div
                      key={`${issue.ruleId}-${issue.kind}`}
                      className="flex items-start gap-2 text-sm"
                    >
                      <Badge variant={meta.variant} className="mt-0.5 shrink-0">
                        {meta.label}
                      </Badge>
                      <span className="text-muted-foreground">
                        {issue.message}
                      </span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-success/30 bg-success/5">
              <CardContent className="flex items-center gap-2 py-3 text-sm text-success">
                <CheckCircle2 className="size-4" /> No shadowed, redundant or
                unused rules detected.
              </CardContent>
            </Card>
          )}

          {rules.length === 0 ? (
            <EmptyState
              icon={ShieldCheck}
              title="No policy rules"
              description="Add a rule to start building the ACL. Traffic is denied by default."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">#</TableHead>
                      <TableHead className="w-20">Action</TableHead>
                      <TableHead>Match</TableHead>
                      <TableHead className="w-36">Port / proto</TableHead>
                      <TableHead className="w-20">Enabled</TableHead>
                      <TableHead className="w-28 text-right">Manage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule, index) => {
                      const issue = issueByRule.get(rule.id)
                      return (
                        <TableRow key={rule.id}>
                          <TableCell className="text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                rule.action === 'allow'
                                  ? 'success'
                                  : 'destructive'
                              }
                            >
                              {ACTION_LABELS[rule.action]}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs">
                                {rule.src}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="font-mono text-xs">
                                {rule.dst}
                              </span>
                              {issue ? (
                                <Badge
                                  variant={ISSUE_META[issue.kind].variant}
                                  className="ml-1 text-[10px]"
                                >
                                  {ISSUE_META[issue.kind].label}
                                </Badge>
                              ) : null}
                            </div>
                            {rule.note ? (
                              <p className="text-xs text-muted-foreground">
                                {rule.note}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {rule.port === 0 ? 'any' : rule.port} /{' '}
                            {PROTO_LABELS[rule.proto]}
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={rule.enabled}
                              aria-label={`Toggle ${describeRule(rule)}`}
                              onCheckedChange={() => toggleRule(rule.id)}
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                disabled={index === 0}
                                onClick={() => moveRule(rule.id, -1)}
                                aria-label="Move rule up"
                              >
                                <ArrowUp className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                disabled={index === rules.length - 1}
                                onClick={() => moveRule(rule.id, 1)}
                                aria-label="Move rule down"
                              >
                                <ArrowDown className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                onClick={() => openEdit(rule)}
                                aria-label="Edit rule"
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-destructive"
                                onClick={() => {
                                  deleteRule(rule.id)
                                  toast.success('Rule deleted')
                                }}
                                aria-label="Delete rule"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="reachability" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-32 space-y-1.5">
              <Label htmlFor="reach-port">Port</Label>
              <Input
                id="reach-port"
                type="number"
                min={0}
                value={port}
                onChange={(event) => setPort(Number(event.target.value) || 0)}
              />
            </div>
            <div className="w-36 space-y-1.5">
              <Label htmlFor="reach-proto">Protocol</Label>
              <Select
                value={proto}
                onValueChange={(value) =>
                  setProto(value as Exclude<PolicyProto, 'any'>)
                }
              >
                <SelectTrigger id="reach-proto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROTOS.filter((item) => item !== 'any').map((item) => (
                    <SelectItem key={item} value={item}>
                      {PROTO_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-4 pb-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-success" />
                {matrix.allowed} reachable
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-destructive" />
                {matrix.denied} denied
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-muted-foreground/40" />
                {matrix.noPath} no path
              </span>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reachability matrix</CardTitle>
              <p className="text-xs text-muted-foreground">
                Rows source → columns destination for {PROTO_LABELS[proto]}{' '}
                {port === 0 ? 'on any port' : `on port ${port}`}.
              </p>
            </CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No devices to analyse.
                </p>
              ) : (
                <div className="overflow-auto">
                  <table className="border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-card px-2 py-1 text-left" />
                        {matrix.ids.map((id) => (
                          <th
                            key={id}
                            title={nameOf(id)}
                            className="px-1 py-1 text-center font-normal text-muted-foreground"
                          >
                            <span className="block w-16 truncate">
                              {shortName(nameOf(id))}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.ids.map((srcId, i) => (
                        <tr key={srcId}>
                          <th
                            title={nameOf(srcId)}
                            className="sticky left-0 z-10 max-w-32 truncate bg-card px-2 py-0.5 text-right font-normal text-muted-foreground"
                          >
                            {shortName(nameOf(srcId))}
                          </th>
                          {matrix.ids.map((dstId, j) => {
                            const self = i === j
                            const ok = matrix.cells[i][j]
                            return (
                              <td
                                key={dstId}
                                className="px-1 py-0.5 text-center"
                              >
                                <span
                                  title={`${nameOf(srcId)} → ${nameOf(dstId)}: ${
                                    self ? 'self' : ok ? 'reachable' : 'blocked'
                                  }`}
                                  className={cn(
                                    'mx-auto block size-5 rounded',
                                    self
                                      ? 'bg-muted/40'
                                      : ok
                                        ? 'bg-success/70'
                                        : 'bg-destructive/60',
                                  )}
                                />
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <RouteIcon className="size-4 text-primary" /> Path explainer
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Pick a source and destination to see the physical route and the
                policy verdict.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-56 space-y-1.5">
                  <Label htmlFor="path-src">Source</Label>
                  <Select value={pathSrc} onValueChange={setPathSrc}>
                    <SelectTrigger id="path-src">
                      <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-56 space-y-1.5">
                  <Label htmlFor="path-dst">Destination</Label>
                  <Select value={pathDst} onValueChange={setPathDst}>
                    <SelectTrigger id="path-dst">
                      <SelectValue placeholder="Select destination" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!explanation ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="size-4" /> Choose both endpoints to trace the
                  flow.
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={explanation.allowed ? 'success' : 'destructive'}
                    >
                      {explanation.allowed ? 'Reachable' : 'Blocked'}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {explanation.reason === 'no-path'
                        ? 'No physical path between the endpoints.'
                        : explanation.reason === 'offline'
                          ? 'A hop on the path is offline.'
                          : explanation.reason === 'denied'
                            ? `Denied by ${
                                explanation.decision.rule
                                  ? `"${describeRule(explanation.decision.rule)}"`
                                  : 'default deny'
                              }.`
                            : `Allowed by ${
                                explanation.decision.rule
                                  ? `"${describeRule(explanation.decision.rule)}"`
                                  : '—'
                              }.`}
                    </span>
                  </div>

                  {explanation.hops.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {explanation.hops.map((hop, index) => (
                        <span
                          key={hop.deviceId}
                          className="flex items-center gap-2"
                        >
                          {index > 0 ? (
                            <span className="text-muted-foreground">→</span>
                          ) : null}
                          <Badge
                            variant={
                              hop.status === 'offline'
                                ? 'destructive'
                                : 'outline'
                            }
                            className="gap-1.5"
                          >
                            <StatusDot status={hop.status} />
                            {hop.name}
                          </Badge>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatif" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FlaskConical className="size-4 text-primary" /> Proposed rule
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Preview a candidate rule inserted at the top of the policy and
                see which flows it opens or closes.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wi-action">Action</Label>
                  <Select
                    value={whatIf.action}
                    onValueChange={(value) =>
                      setWhatIf((current) => ({
                        ...current,
                        action: value as PolicyAction,
                      }))
                    }
                  >
                    <SelectTrigger id="wi-action">
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
                  <Label htmlFor="wi-src">Source</Label>
                  <Input
                    id="wi-src"
                    value={whatIf.src}
                    onChange={(event) =>
                      setWhatIf((current) => ({
                        ...current,
                        src: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wi-dst">Destination</Label>
                  <Input
                    id="wi-dst"
                    value={whatIf.dst}
                    onChange={(event) =>
                      setWhatIf((current) => ({
                        ...current,
                        dst: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wi-port">Port</Label>
                  <Input
                    id="wi-port"
                    type="number"
                    min={0}
                    value={whatIf.port}
                    onChange={(event) =>
                      setWhatIf((current) => ({
                        ...current,
                        port: Number(event.target.value) || 0,
                      }))
                    }
                  />
                </div>
              </div>

              {impact ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-md border border-success/40 bg-success/5 p-3">
                    <p className="text-sm font-medium text-success">
                      Opens {impact.opened.length} flow
                      {impact.opened.length === 1 ? '' : 's'}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {impact.opened.slice(0, 8).map((pair) => (
                        <li key={`${pair.src}-${pair.dst}`}>
                          {nameOf(pair.src)} → {nameOf(pair.dst)}
                        </li>
                      ))}
                      {impact.opened.length > 8 ? (
                        <li>…and {impact.opened.length - 8} more</li>
                      ) : null}
                    </ul>
                  </div>
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                    <p className="text-sm font-medium text-destructive">
                      Closes {impact.closed.length} flow
                      {impact.closed.length === 1 ? '' : 's'}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {impact.closed.slice(0, 8).map((pair) => (
                        <li key={`${pair.src}-${pair.dst}`}>
                          {nameOf(pair.src)} → {nameOf(pair.dst)}
                        </li>
                      ))}
                      {impact.closed.length > 8 ? (
                        <li>…and {impact.closed.length - 8} more</li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PolicyRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editing}
        onSubmit={submitRule}
      />
    </div>
  )
}
