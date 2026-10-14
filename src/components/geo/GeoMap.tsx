import { Fragment } from 'react'
import type { GeoLink, SiteMarker } from '@/lib/geo'
import { MAP_HEIGHT, MAP_WIDTH } from '@/lib/geo'
import { STATUS_HEX } from '@/lib/health'

/**
 * Stylised, dependency-free world map. Sites are projected equirectangularly
 * and cross-site links are drawn as curved arcs, coloured by latency.
 */

function latencyHex(ms: number): string {
  if (ms < 60) return '#34d399'
  if (ms < 120) return '#fbbf24'
  return '#f43f5e'
}

function markerRadius(count: number): number {
  return 4 + Math.min(count, 14) * 0.55
}

function arcPath(from: SiteMarker, to: SiteMarker): string {
  const x1 = from.x * MAP_WIDTH
  const y1 = from.y * MAP_HEIGHT
  const x2 = to.x * MAP_WIDTH
  const y2 = to.y * MAP_HEIGHT
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.hypot(dx, dy) || 1
  const curve = Math.min(60, dist * 0.18)
  const cx = mx - (dy / dist) * curve
  const cy = my + (dx / dist) * curve
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`
}

export interface GeoMapProps {
  markers: SiteMarker[]
  links: GeoLink[]
  selected: string | null
  onSelect: (site: string | null) => void
}

export function GeoMap({ markers, links, selected, onSelect }: GeoMapProps) {
  const bySite = new Map(markers.map((marker) => [marker.site, marker]))
  const graticuleX = [0, 1, 2, 3, 4, 5, 6].map((i) => (i / 6) * MAP_WIDTH)
  const graticuleY = [0, 1, 2, 3].map((i) => (i / 3) * MAP_HEIGHT)

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className="h-[360px] w-full rounded-lg bg-gradient-to-b from-sky-950/30 to-slate-950/40"
      role="img"
      aria-label="Geographic operations map"
      onClick={() => onSelect(null)}
    >
      <g className="stroke-border/40" strokeWidth={0.5}>
        {graticuleX.map((x) => (
          <line key={`x${x}`} x1={x} y1={0} x2={x} y2={MAP_HEIGHT} />
        ))}
        {graticuleY.map((y) => (
          <line key={`y${y}`} x1={0} y1={y} x2={MAP_WIDTH} y2={y} />
        ))}
      </g>

      {links.map((link) => {
        const from = bySite.get(link.source)
        const to = bySite.get(link.target)
        if (!from || !to) return null
        const active = selected === link.source || selected === link.target
        return (
          <path
            key={`${link.source}|${link.target}`}
            d={arcPath(from, to)}
            fill="none"
            stroke={latencyHex(link.avgLatencyMs)}
            strokeWidth={active ? 2.5 : Math.min(1 + link.weight, 3)}
            strokeOpacity={selected && !active ? 0.15 : 0.7}
            strokeLinecap="round"
          />
        )
      })}

      {markers.map((marker) => {
        const cx = marker.x * MAP_WIDTH
        const cy = marker.y * MAP_HEIGHT
        const active = selected === marker.site
        const labelY =
          cy < 16
            ? cy + markerRadius(marker.deviceCount) + 12
            : cy - markerRadius(marker.deviceCount) - 7
        return (
          <Fragment key={marker.site}>
            {marker.critical ? (
              <circle
                cx={cx}
                cy={cy}
                r={markerRadius(marker.deviceCount) + 4}
                fill="none"
                stroke={STATUS_HEX.offline}
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
            ) : null}
            <circle
              cx={cx}
              cy={cy}
              r={markerRadius(marker.deviceCount) + (active ? 3 : 0)}
              fill={STATUS_HEX[marker.worstStatus]}
              fillOpacity={active ? 1 : 0.85}
              stroke="#0f172a"
              strokeWidth={1}
              className="cursor-pointer"
              onClick={(event) => {
                event.stopPropagation()
                onSelect(active ? null : marker.site)
              }}
            >
              <title>
                {`${marker.site} · ${marker.deviceCount} devices · worst ${marker.worstStatus}`}
              </title>
            </circle>
            <text
              x={cx}
              y={labelY}
              textAnchor="middle"
              className="fill-foreground text-[9px] font-medium"
              style={{ pointerEvents: 'none' }}
            >
              {marker.site}
            </text>
          </Fragment>
        )
      })}
    </svg>
  )
}
