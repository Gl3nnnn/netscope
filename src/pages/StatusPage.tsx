import { useMemo } from 'react'
import { Activity, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { MONITOR_STATUS_LABELS, uptimePct } from '@/lib/monitors'
import { useMonitorsStore } from '@/store/useMonitorsStore'
import { useNetworkStore } from '@/store/useNetworkStore'
import { formatClock, formatPct, round } from '@/lib/format'

const STATUS_TEXT: Record<string, string> = {
  up: 'text-emerald-500',
  degraded: 'text-amber-500',
  down: 'text-red-500',
}

const STATUS_BG: Record<string, string> = {
  up: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-red-500',
}

export function StatusPage() {
  const monitors = useMonitorsStore((state) => state.monitors)
  const checks = useMonitorsStore((state) => state.checks)
  const now = useNetworkStore((state) => state.lastTick)

  const rows = useMemo(
    () =>
      monitors.map((monitor) => ({
        monitor,
        result: (checks[monitor.id] ?? []).at(-1) ?? null,
        uptime: uptimePct(checks[monitor.id] ?? []),
      })),
    [monitors, checks],
  )

  const active = rows.filter((row) => row.result)
  const outages = active.filter((row) => row.result?.status === 'down')
  const degraded = active.filter((row) => row.result?.status === 'degraded')
  const allUp = outages.length === 0 && degraded.length === 0

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="size-6 text-emerald-400" aria-hidden />
            <div>
              <h1 className="text-lg font-semibold">NetScope</h1>
              <p className="text-sm text-slate-400">
                Service status - simulated demo
              </p>
            </div>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-slate-100"
          >
            <ArrowLeft className="size-4" /> Back to console
          </Link>
        </header>

        <section
          className={`flex items-center gap-3 rounded-xl border p-5 ${
            allUp
              ? 'border-emerald-500/30 bg-emerald-500/10'
              : 'border-amber-500/30 bg-amber-500/10'
          }`}
        >
          {allUp ? (
            <CheckCircle2 className="size-6 text-emerald-400" aria-hidden />
          ) : (
            <Activity className="size-6 text-amber-400" aria-hidden />
          )}
          <div>
            <h2 className="text-lg font-semibold">
              {allUp ? 'All systems operational' : 'Some systems degraded'}
            </h2>
            <p className="text-sm text-slate-400">
              {now > 0
                ? `Last updated ${formatClock(now)}`
                : 'Waiting for the simulator to start.'}
            </p>
          </div>
        </section>

        {active.length === 0 ? (
          <p className="text-sm text-slate-400">
            No checks recorded yet - the probes will report here once the
            simulator is running.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map(({ monitor, result, uptime }) => (
              <li
                key={monitor.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/5 p-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-3">
                    <span
                      className={`size-2.5 shrink-0 rounded-full ${
                        result ? STATUS_BG[result.status] : 'bg-slate-600'
                      }`}
                      aria-hidden
                    />
                    <p className="font-medium">{monitor.name}</p>
                  </div>
                  <p className="pl-5 text-sm text-slate-400">
                    {result ? (
                      <>
                        {round(result.latencyMs, 1)}ms response ·{' '}
                        {formatPct(result.lossPct, 2)} packet loss ·{' '}
                        {formatPct(result.availabilityPct, 2)} availability
                      </>
                    ) : (
                      'Awaiting first check'
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-medium uppercase tracking-wide ${
                      result ? STATUS_TEXT[result.status] : 'text-slate-500'
                    }`}
                  >
                    {result ? MONITOR_STATUS_LABELS[result.status] : 'Pending'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {uptime === null
                      ? 'No uptime yet'
                      : `${formatPct(uptime, 2)} uptime`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-auto pt-6 text-xs text-slate-500">
          NetScope is a simulated NOC demo. Telemetry, alerts and monitors are
          generated locally in your browser.
        </footer>
      </div>
    </div>
  )
}
