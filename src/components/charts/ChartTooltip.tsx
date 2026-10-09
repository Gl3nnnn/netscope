interface TooltipEntry {
  name?: string | number
  value?: string | number
  color?: string
  dataKey?: string | number
}

interface ChartTooltipProps {
  active?: boolean
  payload?: TooltipEntry[]
  label?: string | number
  labelFormatter?: (value: string | number) => string
  valueFormatter?: (value: string | number, key: string) => string
}

/** Consistent, theme-aware tooltip used by all Recharts charts. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-md border border-border bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {label !== undefined ? (
        <p className="mb-1 font-medium text-foreground">
          {labelFormatter ? labelFormatter(label) : String(label)}
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => {
          const key = String(entry.dataKey ?? entry.name ?? index)
          return (
            <li
              key={key}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="capitalize">{entry.name ?? key}</span>
              <span className="ml-auto font-mono text-foreground">
                {valueFormatter
                  ? valueFormatter(entry.value ?? '', key)
                  : String(entry.value)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
