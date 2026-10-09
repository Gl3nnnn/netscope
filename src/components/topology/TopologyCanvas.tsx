import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Network,
  Minus,
  Plus,
  RotateCcw,
  Router,
  Server,
  Shield,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { select } from 'd3'
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomTransform } from 'd3'
import type { Device, DeviceType, DeviceStatus } from '@/types'
import { STATUS_HEX, DEVICE_STATUS_LABELS } from '@/lib/health'
import { NODE_RADIUS, type TopoLink } from './topology'
import { useTopologyLayout, type TopoNode } from '@/hooks/useTopologyLayout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const TYPE_ICON: Record<DeviceType, LucideIcon> = {
  router: Router,
  switch: Network,
  firewall: Shield,
  server: Server,
  accessPoint: Wifi,
}

interface TopologyCanvasProps {
  devices: Device[]
  links: TopoLink[]
  selectedId: string | null
  onSelect: (device: Device) => void
}

export function TopologyCanvas({
  devices,
  links,
  selectedId,
  onSelect,
}: TopologyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 800, height: 560 })
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity)

  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    nodeX: number
    nodeY: number
  } | null>(null)

  const layout = useTopologyLayout(devices, links, size.width, size.height)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      setSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = svgRef.current
    if (!node) return
    const svg = select(node)
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 3])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        setTransform(event.transform)
      })
    svg.call(behavior)
    return () => {
      svg.on('.zoom', null)
    }
  }, [])

  const zoomBy = useCallback((factor: number) => {
    setTransform((current) => {
      const next = current.scale(factor)
      const nextK = Math.min(3, Math.max(0.35, next.k))
      return zoomIdentity.translate(current.x, current.y).scale(nextK)
    })
  }, [])

  const handlePointerDown = (
    node: TopoNode,
    event: React.PointerEvent<SVGGElement>,
  ) => {
    event.stopPropagation()
    event.preventDefault()
    ;(event.currentTarget as SVGGElement).setPointerCapture(event.pointerId)
    dragRef.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      nodeX: node.x,
      nodeY: node.y,
    }
  }

  const handlePointerMove = (event: React.PointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const k = transform.k || 1
    const dx = (event.clientX - drag.startX) / k
    const dy = (event.clientY - drag.startY) / k
    layout.dragNode(drag.id, drag.nodeX + dx, drag.nodeY + dy)
  }

  const handlePointerUp = (event: React.PointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    ;(event.currentTarget as SVGGElement).releasePointerCapture?.(
      event.pointerId,
    )
    layout.releaseNode(drag.id)
    dragRef.current = null
  }

  const linkStroke = (endpoint: string | TopoNode): string => {
    const id = typeof endpoint === 'string' ? endpoint : endpoint.id
    const device = devices.find((item) => item.id === id)
    return device ? STATUS_HEX[device.status] : '#334155'
  }

  const statuses: DeviceStatus[] = ['online', 'degraded', 'offline']

  return (
    <div
      ref={containerRef}
      className="grid-lines relative h-[clamp(360px,62vh,640px)] w-full overflow-hidden rounded-xl border border-border/70 bg-card/40"
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        role="img"
        aria-label="Interactive network topology. Drag nodes to rearrange; scroll to zoom; drag the background to pan."
        className="touch-none"
      >
        <g
          transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
        >
          {layout.links.map((link, index) => {
            const source = link.source as TopoNode
            const target = link.target as TopoNode
            if (typeof source === 'string' || typeof target === 'string')
              return null
            return (
              <line
                key={index}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={linkStroke(source)}
                strokeOpacity={0.28}
                strokeWidth={1.5}
              />
            )
          })}

          {layout.nodes.map((node) => {
            const device = node.device
            const radius = NODE_RADIUS[device.type]
            const Icon = TYPE_ICON[device.type]
            const selected = device.id === selectedId
            const color = STATUS_HEX[device.status]
            return (
              <g
                key={device.id}
                transform={`translate(${node.x},${node.y})`}
                className="cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => handlePointerDown(node, event)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onSelect(device)}
                tabIndex={0}
                role="button"
                aria-label={`${device.name}, ${DEVICE_STATUS_LABELS[device.status]}`}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(device)
                  }
                }}
              >
                {device.status !== 'online' ? (
                  <circle
                    r={radius}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    className="animate-pulse-ring"
                    style={{ transformOrigin: 'center' }}
                  />
                ) : null}
                {selected ? (
                  <circle
                    r={radius + 5}
                    fill="none"
                    stroke="hsl(199 89% 55%)"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                ) : null}
                <circle
                  r={radius}
                  fill="hsl(222 44% 10%)"
                  stroke={color}
                  strokeWidth={2.5}
                />
                <foreignObject
                  x={-radius}
                  y={-radius}
                  width={radius * 2}
                  height={radius * 2}
                  className="pointer-events-none"
                >
                  <div className="flex size-full items-center justify-center">
                    <Icon
                      style={{ width: radius, height: radius, color }}
                      aria-hidden
                    />
                  </div>
                </foreignObject>
                <text
                  y={radius + 12}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                  style={{ fontSize: 10 }}
                >
                  {device.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>

      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={() => zoomBy(1.3)}
          aria-label="Zoom in"
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => zoomBy(1 / 1.3)}
          aria-label="Zoom out"
        >
          <Minus className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            setTransform(zoomIdentity)
            layout.resetPositions()
          }}
          aria-label="Reset view"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-card/80 px-3 py-2 text-xs backdrop-blur">
        {statuses.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: STATUS_HEX[status] }}
            />
            {DEVICE_STATUS_LABELS[status]}
          </span>
        ))}
      </div>

      <span
        className={cn(
          'pointer-events-none absolute bottom-3 right-3 rounded-md border border-border/70 bg-card/80 px-2 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur',
        )}
      >
        {devices.length} nodes - zoom {transform.k.toFixed(2)}x
      </span>
    </div>
  )
}
