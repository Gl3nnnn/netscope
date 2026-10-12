import { create } from 'zustand'
import {
  MAX_REPLAY_FRAMES,
  nearestFrameIndex,
  pushFrame,
  type ReplayFrame,
} from '@/lib/replay'

/**
 * Time Machine frame buffer. Bounded and entirely ephemeral — frames are never
 * persisted, so a reload starts a fresh recording.
 */
interface ReplayState {
  frames: ReplayFrame[]
  /** Playhead position into `frames`. */
  index: number
  playing: boolean
  maxFrames: number
  push: (frame: ReplayFrame) => void
  clear: () => void
  setIndex: (index: number) => void
  step: (delta: number) => void
  play: () => void
  pause: () => void
  /** Advance one frame; returns false once the end is reached. */
  advance: () => boolean
  seekToTime: (t: number) => void
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  frames: [],
  index: 0,
  playing: false,
  maxFrames: MAX_REPLAY_FRAMES,

  push: (frame) => {
    const { frames, index, maxFrames } = get()
    const atEnd = frames.length === 0 || index >= frames.length - 1
    const next = pushFrame(frames, frame, maxFrames)
    const removed = frames.length + 1 > maxFrames ? 1 : 0
    const nextIndex = atEnd
      ? next.length - 1
      : Math.max(0, Math.min(next.length - 1, index - removed))
    set({ frames: next, index: nextIndex })
  },

  clear: () => set({ frames: [], index: 0, playing: false }),

  setIndex: (index) =>
    set((state) => ({
      index: Math.max(0, Math.min(state.frames.length - 1, index)),
      playing: false,
    })),

  step: (delta) =>
    set((state) => ({
      index: Math.max(
        0,
        Math.min(state.frames.length - 1, state.index + delta),
      ),
      playing: false,
    })),

  play: () => {
    if (get().frames.length < 2) return
    set((state) => ({
      playing: true,
      index: state.index >= state.frames.length - 1 ? 0 : state.index,
    }))
  },

  pause: () => set({ playing: false }),

  advance: () => {
    const { index, frames } = get()
    if (index >= frames.length - 1) {
      set({ playing: false })
      return false
    }
    set({ index: index + 1 })
    return true
  },

  seekToTime: (t) =>
    set((state) => ({
      index: nearestFrameIndex(state.frames, t),
      playing: false,
    })),
}))
