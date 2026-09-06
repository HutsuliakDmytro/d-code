import { create } from 'zustand'
import type { Breakpoint, DebugScope, DebugState, DebugVariable } from '@shared/ipc'

const EMPTY: DebugState = { running: false, paused: false, frames: [], output: '' }

interface DebugStore {
  state: DebugState
  breakpoints: Breakpoint[]
  /** Frame the user is inspecting; the top one by default. */
  selectedFrame?: string
  scopes: DebugScope[]
  variables: Record<string, DebugVariable[]>

  setState: (state: DebugState) => void
  loadBreakpoints: () => Promise<void>
  toggleBreakpoint: (path: string, line: number) => Promise<void>
  selectFrame: (frameId: string) => Promise<void>
  expand: (objectId: string) => Promise<void>
  start: (root: string, program: string) => Promise<void>
  stop: () => Promise<void>
}

/**
 * Debugger state.
 *
 * Variables are not kept in session state: they live exactly until the next step,
 * and fetching them upfront for every frame would mean dozens of pointless engine
 * round-trips. They load on demand, when a frame is actually opened.
 */
export const useDebugStore = create<DebugStore>((set, get) => ({
  state: EMPTY,
  breakpoints: [],
  scopes: [],
  variables: {},

  setState: (state) => {
    const previous = get().state
    // Every step yields a fresh frame set — the old variables do not belong to it.
    const moved = state.frames[0]?.id !== previous.frames[0]?.id
    set({
      state,
      ...(moved ? { scopes: [], variables: {}, selectedFrame: undefined } : {})
    })
    if (state.paused && moved && state.frames[0]) void get().selectFrame(state.frames[0].id)
  },

  loadBreakpoints: async () => set({ breakpoints: await window.claudeUI.debugBreakpoints() }),

  toggleBreakpoint: async (path, line) => {
    set({ breakpoints: await window.claudeUI.debugBreakpoint(path, line) })
  },

  selectFrame: async (frameId) => {
    const scopes = await window.claudeUI.debugScopes(frameId)
    set({ selectedFrame: frameId, scopes, variables: {} })

    // Expand the local scope right away: that is what a debugger is for.
    const local = scopes.find((s) => s.name === 'local') ?? scopes[0]
    if (local?.objectId) await get().expand(local.objectId)
  },

  expand: async (objectId) => {
    if (get().variables[objectId]) return
    const list = await window.claudeUI.debugVariables(objectId)
    set((s) => ({ variables: { ...s.variables, [objectId]: list } }))
  },

  start: async (root, program) => {
    set({ scopes: [], variables: {}, selectedFrame: undefined })
    set({ state: await window.claudeUI.debugStart({ root, program }) })
  },

  stop: async () => {
    await window.claudeUI.debugStop()
    set({ state: EMPTY, scopes: [], variables: {}, selectedFrame: undefined })
  }
}))
