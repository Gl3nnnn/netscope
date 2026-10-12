import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eraser, Send, Sparkles } from 'lucide-react'
import type { CopilotAnswer } from '@/lib/copilot'
import { answerQuestion, COPILOT_EXAMPLES } from '@/lib/copilot'
import { firingAlerts } from '@/lib/alerts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/common/PageHeader'
import { StatusBadge } from '@/components/common/Badges'
import { useNetworkStore } from '@/store/useNetworkStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useAlertsStore } from '@/store/useAlertsStore'

interface Exchange {
  id: number
  question: string
  answer: CopilotAnswer
}

function AnswerBody({ answer }: { answer: CopilotAnswer }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold">{answer.title}</p>
        <p className="text-sm text-muted-foreground">{answer.summary}</p>
      </div>

      {answer.bullets.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {answer.bullets.map((bullet, index) => (
            <li key={index} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {answer.devices && answer.devices.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {answer.devices.map((device) => (
            <Link
              key={device.id}
              to={`/devices/${device.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-2 py-0.5 text-xs transition-colors hover:bg-muted/50"
            >
              <span className="font-medium">{device.name}</span>
              <StatusBadge status={device.status} className="px-1.5 py-0" />
            </Link>
          ))}
        </div>
      ) : null}

      {answer.links && answer.links.length > 0 ? (
        <div className="flex flex-wrap gap-2 pt-1">
          {answer.links.map((link) => (
            <Button
              key={link.to}
              asChild
              variant="outline"
              size="sm"
              className="h-7 text-xs"
            >
              <Link to={link.to}>{link.label}</Link>
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function AskPage() {
  const devices = useNetworkStore((state) => state.devices)
  const incidents = useNetworkStore((state) => state.incidents)
  const lastTick = useNetworkStore((state) => state.lastTick)
  const thresholds = useSettingsStore((state) => state.thresholds)
  const alertStates = useAlertsStore((state) => state.states)

  const [input, setInput] = useState('')
  const [history, setHistory] = useState<Exchange[]>([])
  const nextId = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [history.length])

  const context = useMemo(
    () => ({
      devices,
      incidents,
      thresholds,
      now: lastTick,
      alerts: firingAlerts(alertStates).map((alert) => ({
        title: `${alert.ruleName} on ${alert.deviceName}`,
        severity: alert.severity,
      })),
    }),
    [devices, incidents, lastTick, thresholds, alertStates],
  )

  const ask = (question: string) => {
    const trimmed = question.trim()
    if (!trimmed) return
    const answer = answerQuestion(trimmed, context)
    nextId.current += 1
    setHistory((prev) => [
      ...prev,
      { id: nextId.current, question: trimmed, answer },
    ])
    setInput('')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ask NetScope"
        description="Natural-language questions answered locally from the live fleet — no network calls."
        actions={
          history.length > 0 ? (
            <Button variant="outline" onClick={() => setHistory([])}>
              <Eraser className="size-4" />
              Clear
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-4">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              ask(input)
            }}
          >
            <Sparkles className="size-4 shrink-0 text-primary" />
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="e.g. which devices are the worst?"
              aria-label="Ask NetScope"
            />
            <Button type="submit" disabled={input.trim().length === 0}>
              <Send className="size-4" />
              Ask
            </Button>
          </form>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {COPILOT_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => ask(example)}
                className="rounded-full border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {history.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          <Sparkles className="size-4 text-primary" />
          Ask about fleet health, a specific device, a site, incidents,
          capacity, routes or uptime.
        </div>
      ) : (
        <div className="space-y-4">
          {history.map((exchange) => (
            <div key={exchange.id} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/15 px-3 py-2 text-sm text-primary">
                  {exchange.question}
                </div>
              </div>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                      <Sparkles className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <AnswerBody answer={exchange.answer} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
