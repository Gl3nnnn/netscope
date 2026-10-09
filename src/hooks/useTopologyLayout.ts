/* eslint-disable react-hooks/refs -- D3 force-graph node/link positions are read
   each frame from refs; React re-renders are driven by the `frame` counter. The
   layout is intentionally an external, mutable system. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3'
import type { Device } from '@/types'
import type { TopoLink } from '@/components/topology/topology'

const SAVED_LAYOUT_KEY = 'netscope:topology'

interface SavedPosition {
  id: string
  x: number
  y: number
}

function loadSavedLayout(): Map<string, SavedPosition> {
  if (typeof localStorage === 'undefined') return new Map()
  try {
    const raw = localStorage.getItem(SAVED_LAYOUT_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const valid = parsed.filter(
      (entry): entry is SavedPosition =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SavedPosition).id === 'string' &&
        Number.isFinite((entry as SavedPosition).x) &&
        Number.isFinite((entry as SavedPosition).y),
    )
    return new Map(valid.map((entry) => [entry.id, entry]))
  } catch {
    return new Map()
  }
}

function saveLayout(nodes: TopoNode[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    const positions: SavedPosition[] = nodes.map((node) => ({
      id: node.id,
      x: Math.round(node.x),
      y: Math.round(node.y),
    }))
    localStorage.setItem(SAVED_LAYOUT_KEY, JSON.stringify(positions))
  } catch {
    /* storage unavailable - ignore */
  }
}

export interface TopoNode extends SimulationNodeDatum {
  id: string
  device: Device
  x: number
  y: number
}

interface TopoLinkDatum extends SimulationLinkDatum<TopoNode> {
  source: string | TopoNode
  target: string | TopoNode
}

export interface TopologyLayout {
  nodes: TopoNode[]
  links: TopoLinkDatum[]
  frame: number
  dragNode: (id: string, x: number, y: number) => void
  releaseNode: (id: string) => void
  reheat: (alpha?: number) => void
  resetPositions: () => void
}

/**
 * Owns the D3 force simulation and node coordinates for the topology view.
 *
 * IMPORTANT: all layout state (positions, velocities, drag pins) lives here in
 * refs and local state, completely separate from the Zustand monitoring store.
 * Monitoring ticks therefore never disturb the visual layout, and dragging a
 * node never writes back to the monitoring model.
 */
export function useTopologyLayout(
  devices: Device[],
  links: TopoLink[],
  width: number,
  height: number,
): TopologyLayout {
  const nodesRef = useRef<TopoNode[]>([])
  const linksRef = useRef<TopoLinkDatum[]>([])
  const simRef = useRef<Simulation<TopoNode, TopoLinkDatum> | null>(null)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]))
    const saved = loadSavedLayout()
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 3

    const nodes: TopoNode[] = devices.map((device, index) => {
      const existing = previous.get(device.id)
      if (existing) {
        existing.device = device
        return existing
      }
      const savedPosition = saved.get(device.id)
      if (savedPosition) {
        return {
          id: device.id,
          device,
          x: savedPosition.x,
          y: savedPosition.y,
          fx: savedPosition.x,
          fy: savedPosition.y,
        }
      }
      const angle = (index / Math.max(1, devices.length)) * Math.PI * 2
      return {
        id: device.id,
        device,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      }
    })

    const satellite = links.map((link) => ({
      source: link.source,
      target: link.target,
    }))
    nodesRef.current = nodes
    linksRef.current = satellite

    const simulation = forceSimulation<TopoNode>(nodes)
      .force('charge', forceManyBody<TopoNode>().strength(-340))
      .force(
        'link',
        forceLink<TopoNode, TopoLinkDatum>(satellite)
          .id((node) => node.id)
          .distance(96)
          .strength(0.55),
      )
      .force('center', forceCenter(cx, cy))
      .force('collide', forceCollide<TopoNode>().radius(34))
      .alpha(0.9)
      .alphaDecay(0.03)
      .on('tick', () => setFrame((value) => (value + 1) % 1_000_000))

    simRef.current = simulation
    return () => {
      simulation.stop()
    }
  }, [devices, links, width, height])

  const dragNode = useCallback((id: string, x: number, y: number) => {
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node) return
    node.fx = x
    node.fy = y
    const simulation = simRef.current
    if (simulation && simulation.alpha() < 0.15) {
      simulation.alpha(0.3).restart()
    }
  }, [])

  const releaseNode = useCallback((id: string) => {
    const node = nodesRef.current.find((item) => item.id === id)
    if (!node) return
    node.fx = null
    node.fy = null
    saveLayout(nodesRef.current)
    simRef.current?.alpha(0.25).restart()
  }, [])

  const reheat = useCallback((alpha = 0.5) => {
    simRef.current?.alpha(alpha).restart()
  }, [])

  const resetPositions = useCallback(() => {
    const cx = width / 2
    const cy = height / 2
    const radius = Math.min(width, height) / 3
    try {
      localStorage.removeItem(SAVED_LAYOUT_KEY)
    } catch {
      /* storage unavailable - ignore */
    }
    nodesRef.current.forEach((node, index) => {
      const angle = (index / Math.max(1, nodesRef.current.length)) * Math.PI * 2
      node.fx = null
      node.fy = null
      node.x = cx + Math.cos(angle) * radius
      node.y = cy + Math.sin(angle) * radius
    })
    simRef.current?.alpha(0.9).restart()
  }, [width, height])

  return {
    nodes: nodesRef.current,
    links: linksRef.current,
    frame,
    dragNode,
    releaseNode,
    reheat,
    resetPositions,
  }
}
