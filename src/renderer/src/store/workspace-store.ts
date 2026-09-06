import { create } from 'zustand'
import type { FileContent, FileNode, GitStatus } from '@shared/ipc'

export type SidebarTab = 'sessions' | 'files' | 'git' | 'tasks' | 'problems'

/** Bottom panel modes: terminals, localhost preview and the debugger. */
export type BottomTab = 'terminal' | 'preview' | 'debug'

export interface OpenFile {
  path: string
  relativePath: string
  content: FileContent
  /** Unsaved edits; undefined means the file is untouched. */
  draft?: string
  gotoLine?: number
}

interface WorkspaceState {
  tab: SidebarTab
  /** Project root, taken from the selected session or the active conversation. */
  root?: string
  tree: Record<string, FileNode[]>
  expanded: Set<string>
  loadingDir: Set<string>

  /** Open files in tab order. */
  openFiles: OpenFile[]
  activePath?: string
  /**
   * File in the editor's right-hand column.
   *
   * Deliberately one extra column rather than arbitrary groups: the real need is
   * seeing two files side by side, and full tab groups would cost a rewrite of the
   * whole state for a rare case.
   */
  splitPath?: string
  /** Which column receives newly opened files. */
  focusedPane: 'main' | 'split'
  openError?: string
  loadingFile: boolean

  git?: GitStatus
  gitLoading: boolean

  /** Bottom panel with the terminals. */
  terminalOpen: boolean
  toggleTerminal: () => void
  bottomTab: BottomTab
  setBottomTab: (tab: BottomTab) => void

  /** Navigation history for back/forward. */
  history: Array<{ path: string; line?: number }>
  historyIndex: number
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  /** Recently opened files, newest first. */
  recent: string[]

  /**
   * The symbol palette opens from both a shortcut and the breadcrumbs, so its
   * state lives here rather than in a component.
   */
  symbolPaletteOpen: boolean
  setSymbolPaletteOpen: (open: boolean) => void

  setTab: (tab: SidebarTab) => void
  setRoot: (root?: string) => void
  loadDir: (dirPath?: string) => Promise<void>
  toggleDir: (dirPath: string) => Promise<void>

  openFile: (path: string, line?: number) => Promise<void>
  closeFile: (path?: string) => void
  closeAllFiles: () => void
  /** Shows a file in the second column. */
  openInSplit: (path: string, line?: number) => Promise<void>
  closeSplit: () => void
  setFocusedPane: (pane: 'main' | 'split') => void
  /** The right column's file, if one is open. */
  splitFile: () => OpenFile | undefined
  setActiveFile: (path: string) => void
  /** Active file — the one the editor works on. */
  activeFile: () => OpenFile | undefined
  /** How many files carry unsaved edits. */
  dirtyCount: () => number

  setDraft: (text: string) => void
  saveFile: (path?: string) => Promise<{ ok: boolean; error?: string }>
  /** Format content before writing, when the project ships a formatter. */
  formatOnSave: boolean
  setFormatOnSave: (value: boolean) => void
  refreshGit: () => Promise<void>

  /** Re-reads a changed directory, and its parent when needed. */
  refreshDir: (dirPath: string) => Promise<void>
  /** Closes the tab of a vanished file — otherwise the editor shows a ghost. */
  forgetFile: (path: string) => void
}

/** History cap: nobody scrolls past this, and memory is finite. */
const MAX_HISTORY = 100

/**
 * Records a navigation step.
 *
 * Jumping to the same place twice adds no new entry — otherwise "back" would have
 * to be pressed twice with nothing visibly happening.
 */
function pushHistory(
  state: { history: Array<{ path: string; line?: number }>; historyIndex: number },
  path: string,
  line?: number
): { history: Array<{ path: string; line?: number }>; historyIndex: number } {
  const current = state.history[state.historyIndex]
  if (current?.path === path && current.line === line) return {
    history: state.history,
    historyIndex: state.historyIndex
  }

  // Navigating after "back" truncates the forward branch, as browsers do.
  const trimmed = state.history.slice(0, state.historyIndex + 1)
  const next = [...trimmed, { path, line }].slice(-MAX_HISTORY)
  return { history: next, historyIndex: next.length - 1 }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tab: 'sessions',
  tree: {},
  expanded: new Set(),
  loadingDir: new Set(),
  openFiles: [],
  focusedPane: 'main',
  loadingFile: false,
  gitLoading: false,
  terminalOpen: false,
  bottomTab: 'terminal',

  setBottomTab: (bottomTab) => set({ bottomTab, terminalOpen: true }),
  history: [],
  historyIndex: -1,
  recent: [],
  symbolPaletteOpen: false,

  setSymbolPaletteOpen: (symbolPaletteOpen) => set({ symbolPaletteOpen }),
  // Remembered across runs: this is a personal habit, not project state.
  formatOnSave: localStorage.getItem('ccui-format-on-save') === '1',

  toggleTerminal: () => set((s) => ({ terminalOpen: !s.terminalOpen })),

  setFormatOnSave(value) {
    localStorage.setItem('ccui-format-on-save', value ? '1' : '0')
    set({ formatOnSave: value })
  },

  setTab: (tab) => set({ tab }),

  setRoot(root) {
    if (get().root === root) return
    // Changing project resets everything: tree, open files and git state belong to the root.
    set({
      root,
      tree: {},
      expanded: new Set(),
      openFiles: [],
      activePath: undefined,
      splitPath: undefined,
      openError: undefined,
      git: undefined
    })
    if (root) {
      void get().loadDir()
      void get().refreshGit()
    }
  },

  async loadDir(dirPath) {
    const { root } = get()
    if (!root) return
    const key = dirPath ?? root

    set((s) => ({ loadingDir: new Set(s.loadingDir).add(key) }))
    try {
      const nodes = await window.claudeUI.listDirectory(root, dirPath)
      set((s) => ({ tree: { ...s.tree, [key]: nodes } }))
    } catch {
      // The directory may be deleted or unreadable — leave the branch empty.
      set((s) => ({ tree: { ...s.tree, [key]: [] } }))
    } finally {
      set((s) => {
        const next = new Set(s.loadingDir)
        next.delete(key)
        return { loadingDir: next }
      })
    }
  },

  async toggleDir(dirPath) {
    const { expanded, tree } = get()
    const next = new Set(expanded)
    if (next.has(dirPath)) {
      next.delete(dirPath)
      set({ expanded: next })
      return
    }
    next.add(dirPath)
    set({ expanded: next })
    // Content is read once and cached: reopening must be instant.
    if (!tree[dirPath]) await get().loadDir(dirPath)
  },

  async openFile(path, line) {
    // An already-open file is just activated, keeping its unsaved edits.
    if (get().openFiles.some((f) => f.path === path)) {
      set((s) => ({
        activePath: path,
        openFiles: s.openFiles.map((f) => (f.path === path ? { ...f, gotoLine: line } : f)),
        ...pushHistory(s, path, line),
        recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 30)
      }))
      return
    }

    set({ loadingFile: true, openError: undefined })
    const result = await window.claudeUI.readTextFile(path)
    if ('error' in result) {
      set({ loadingFile: false, openError: result.error })
      return
    }

    const { root } = get()
    const file: OpenFile = {
      path,
      relativePath: root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path,
      content: result,
      gotoLine: line
    }
    set((s) => ({
      loadingFile: false,
      openFiles: [...s.openFiles, file],
      activePath: path,
      ...pushHistory(s, path, line),
      recent: [path, ...s.recent.filter((p) => p !== path)].slice(0, 30)
    }))
  },

  goBack() {
    const { history, historyIndex } = get()
    if (historyIndex <= 0) return
    const entry = history[historyIndex - 1]
    // Navigation must not spawn new history entries, so only the index moves.
    set({ historyIndex: historyIndex - 1 })
    void get().openFile(entry.path, entry.line)
  },

  goForward() {
    const { history, historyIndex } = get()
    if (historyIndex >= history.length - 1) return
    const entry = history[historyIndex + 1]
    set({ historyIndex: historyIndex + 1 })
    void get().openFile(entry.path, entry.line)
  },

  canGoBack: () => get().historyIndex > 0,
  canGoForward: () => get().historyIndex < get().history.length - 1,

  closeFile(path) {
    const target = path ?? get().activePath
    if (!target) return

    set((s) => {
      const index = s.openFiles.findIndex((f) => f.path === target)
      const remaining = s.openFiles.filter((f) => f.path !== target)
      const wasActive = s.activePath === target
      // Closing the active tab moves to a neighbour rather than to nothing.
      const next = remaining[index] ?? remaining[index - 1]
      return {
        openFiles: remaining,
        activePath: wasActive ? next?.path : s.activePath,
        // A closed file cannot stay in the second column.
        splitPath: s.splitPath === target ? undefined : s.splitPath,
        openError: undefined
      }
    })
  },

  closeAllFiles: () =>
    set({ openFiles: [], activePath: undefined, splitPath: undefined, openError: undefined }),

  async openInSplit(path, line) {
    // The file must already be open: the split shows a tab, not a separate buffer.
    if (!get().openFiles.some((f) => f.path === path)) {
      await get().openFile(path, line)
    }
    set({ splitPath: path, focusedPane: 'split' })
  },

  closeSplit: () => set({ splitPath: undefined, focusedPane: 'main' }),

  setFocusedPane: (focusedPane) => set({ focusedPane }),

  splitFile: () => get().openFiles.find((f) => f.path === get().splitPath),

  setActiveFile: (path) => set({ activePath: path }),

  activeFile: () => get().openFiles.find((f) => f.path === get().activePath),

  dirtyCount: () => get().openFiles.filter((f) => f.draft !== undefined).length,

  setDraft(text) {
    const path = get().activePath
    if (!path) return
    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        // Returning to the original text clears the unsaved marker.
        f.path === path ? { ...f, draft: text === f.content.content ? undefined : text } : f
      )
    }))
  },

  async saveFile(path) {
    const { root } = get()
    const target = path ?? get().activePath
    const file = get().openFiles.find((f) => f.path === target)
    if (!file || file.draft === undefined) return { ok: true }

    let saved = file.draft

    // Format before writing: otherwise an unformatted file would briefly sit on
    // disk and git status would flicker with a spurious change.
    if (get().formatOnSave && root) {
      const formatted = await window.claudeUI.formatFile(root, file.path, saved)
      // A formatter failure must not block saving — write the content as is.
      if (formatted.ok && formatted.content) saved = formatted.content
    }

    const result = await window.claudeUI.writeFileContent(file.path, saved)
    if (!result.ok) return result

    set((s) => ({
      openFiles: s.openFiles.map((f) =>
        f.path === file.path
          ? { ...f, content: { ...f.content, content: saved }, draft: undefined }
          : f
      )
    }))
    void get().refreshGit()
    return { ok: true }
  },

  async refreshDir(dirPath) {
    const { root, tree } = get()
    if (!root) return
    // Only already-loaded branches are re-read; the rest fill in on demand.
    if (dirPath === root || tree[dirPath]) await get().loadDir(dirPath === root ? undefined : dirPath)
    else await get().loadDir()
  },

  forgetFile(path) {
    set((s) => {
      const remaining = s.openFiles.filter((f) => f.path !== path)
      if (remaining.length === s.openFiles.length) return s
      return {
        openFiles: remaining,
        activePath: s.activePath === path ? remaining.at(-1)?.path : s.activePath
      }
    })
  },

  async refreshGit() {
    const { root } = get()
    if (!root) return
    set({ gitLoading: true })
    try {
      set({ git: await window.claudeUI.gitStatus(root) })
    } finally {
      set({ gitLoading: false })
    }
  }
}))
