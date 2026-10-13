import { useMemo, useState } from 'react'
import { ClipboardList, Download, FileCode2, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useSettingsStore } from '@/store/useSettingsStore'
import { useOnCallStore } from '@/store/useOnCallStore'
import { downloadText, fileDateStamp } from '@/lib/download'
import { currentOnCall } from '@/lib/oncall'
import {
  ALL_REPORT_SECTIONS,
  RANGE_OPTIONS,
  REPORT_PRESETS,
  REPORT_SECTION_LABELS,
  buildExecutiveReport,
  executiveToHtml,
  executiveToMarkdown,
  type ExecutiveReport,
  type ReportSection,
  type ReportSectionId,
} from '@/lib/reports'
import { cn } from '@/lib/utils'

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const width = 560
  const height = 72
  const pad = 4
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = (width - pad * 2) / (values.length - 1)
  const points = values.map((value, index) => {
    const x = pad + index * stepX
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-16 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Availability trend"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        className="stroke-primary"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function SectionCard({ section }: { section: ReportSection }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{section.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{section.summary}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {section.sparkline ? <Sparkline values={section.sparkline} /> : null}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {section.metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {metric.label}
              </p>
              <p className="text-lg font-semibold">{metric.value}</p>
              {metric.hint ? (
                <p className="text-xs text-muted-foreground">{metric.hint}</p>
              ) : null}
            </div>
          ))}
        </div>

        {section.table ? (
          <Table>
            <TableHeader>
              <TableRow>
                {section.table.columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.table.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <TableCell
                      key={cellIndex}
                      className={cn(cellIndex === 0 && 'font-medium')}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}

        {section.notes?.map((note) => (
          <p
            key={note}
            className="rounded-md border-l-2 border-amber-500 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-300"
          >
            {note}
          </p>
        ))}
      </CardContent>
    </Card>
  )
}

export function ReportsPage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const events = useNetworkStore((state) => state.events)
  const history = useNetworkStore((state) => state.history)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const thresholds = useSettingsStore((state) => state.thresholds)
  const teams = useOnCallStore((state) => state.teams)
  const rotations = useOnCallStore((state) => state.rotations)

  const [presetId, setPresetId] = useState(REPORT_PRESETS[0].id)
  const [sections, setSections] = useState<ReportSectionId[]>(
    REPORT_PRESETS[0].sections,
  )
  const [rangeMs, setRangeMs] = useState(REPORT_PRESETS[0].rangeMs)

  const onCall = useMemo(
    () => currentOnCall(teams, rotations, lastTick),
    [teams, rotations, lastTick],
  )

  const report = useMemo<ExecutiveReport>(
    () =>
      buildExecutiveReport({
        devices,
        incidents,
        events,
        history,
        thresholds,
        range: { from: lastTick - rangeMs, to: lastTick },
        generatedAt: lastTick,
        sections,
        onCall,
      }),
    [
      devices,
      incidents,
      events,
      history,
      thresholds,
      sections,
      rangeMs,
      onCall,
      lastTick,
    ],
  )

  const applyPreset = (id: string) => {
    const preset = REPORT_PRESETS.find((entry) => entry.id === id)
    if (!preset) return
    setPresetId(id)
    setSections(preset.sections)
    setRangeMs(preset.rangeMs)
  }

  const toggleSection = (id: ReportSectionId) => {
    setPresetId('')
    setSections((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    )
  }

  const exportMarkdown = () => {
    downloadText(
      `netscope-report-${fileDateStamp()}.md`,
      executiveToMarkdown(report),
      'text/markdown',
    )
    toast.success('Report exported as Markdown')
  }

  const exportHtml = () => {
    downloadText(
      `netscope-report-${fileDateStamp()}.html`,
      executiveToHtml(report),
      'text/html',
    )
    toast.success('Report exported as HTML')
  }

  const printReport = () => {
    const win = window.open('', '_blank')
    if (!win) {
      toast.error('Pop-up blocked — allow pop-ups to print')
      return
    }
    win.document.write(executiveToHtml(report))
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports Studio"
        description="Assemble an executive report from live telemetry and export it as Markdown or a print-ready HTML document."
        actions={
          <>
            <Button variant="outline" onClick={exportMarkdown}>
              <Download className="size-4" /> Markdown
            </Button>
            <Button variant="outline" onClick={exportHtml}>
              <FileCode2 className="size-4" /> HTML
            </Button>
            <Button onClick={printReport}>
              <Printer className="size-4" /> Print
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Build a report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {REPORT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                title={preset.description}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
                  presetId === preset.id
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground',
                )}
              >
                {preset.name}
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Reporting window
              </label>
              <Select
                value={String(rangeMs)}
                onValueChange={(value) => setRangeMs(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Sections
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_REPORT_SECTIONS.map((id) => {
                  const active = sections.includes(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleSection(id)}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                        active
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border/60 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {REPORT_SECTION_LABELS[id]}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="size-5 text-primary" /> Preview
          </h2>
          <p className="text-sm text-muted-foreground">{report.headline}</p>
        </div>
        <Badge variant="secondary">
          {sections.length} section{sections.length === 1 ? '' : 's'}
        </Badge>
      </div>

      {report.sections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Select at least one section to build the report.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {report.sections.map((section) => (
            <SectionCard key={section.id} section={section} />
          ))}
        </div>
      )}
    </div>
  )
}
