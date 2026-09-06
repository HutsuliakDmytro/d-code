import { create } from 'zustand'
import type { ProjectGroup, SessionListItem, TranscriptPayload } from '@shared/ipc'
import type { RateLimitState } from '@shared/types'

interface AppState {
  groups: ProjectGroup[]
  loadingSessions: boolean
  selected?: SessionListItem
  transcript?: TranscriptPayload
  loadingTranscript: boolean
  rateLimits?: RateLimitState
  query: string
  collapsedProjects: Set<string>
  /**
   * Session of the active conversation that is not on disk yet: the CLI does not
   * write the transcript instantly. Until it appears the selection is left alone,
   * otherwise the centre would jump to the project's previous session.
   */
  pendingSessionId?: string
  /** UUIDs of bookmarked messages in the selected session. */
  bookmarks: Set<string>

  loadSessions: () => Promise<void>
  selectSession: (item: SessionListItem) => Promise<void>
  /** Binds the centre to the active chat's session as soon as it exists. */
  followSession: (sessionId: string) => void
  toggleBookmark: (messageUuid: string) => Promise<void>
  refreshTranscript: () => Promise<void>
  setQuery: (q: string) => void
  toggleProject: (path: string) => void
  setRateLimits: (state: RateLimitState) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  groups: [],
  loadingSessions: true,
  loadingTranscript: false,
  query: '',
  collapsedProjects: new Set(),
  bookmarks: new Set(),

  async loadSessions() {
    set({ loadingSessions: true })
    const groups = await window.claudeUI.listSessions()
    set({ loadingSessions: false, groups })

    const all = groups.flatMap((g) => g.sessions)

    // Waiting for a just-started conversation's session takes priority over all.
    const pending = get().pendingSessionId
    if (pending) {
      const found = all.find((s) => s.meta.sessionId === pending)
      if (found) {
        set({ pendingSessionId: undefined })
        void get().selectSession(found)
      }
      // Not written yet — leave the centre alone rather than jolt the user.
      return
    }

    const current = get().selected
    if (current) {
      // Keep the selection on the same session after the index refreshes.
      const fresh = all.find((s) => s.meta.sessionId === current.meta.sessionId)
      if (fresh) set({ selected: fresh })
      return
    }

    // First run: open the newest session so the screen is not empty.
    const newest = all.at(0)
    if (newest) void get().selectSession(newest)
  },

  followSession(sessionId) {
    const { selected, groups } = get()
    if (selected?.meta.sessionId === sessionId) return

    const found = groups.flatMap((g) => g.sessions).find((s) => s.meta.sessionId === sessionId)
    if (found) {
      set({ pendingSessionId: undefined })
      void get().selectSession(found)
      return
    }

    // The session is not on disk yet: clear the selection so the centre shows the
    // live conversation rather than the previous transcript from the same folder.
    set({ pendingSessionId: sessionId, selected: undefined, transcript: undefined })
  },

  async selectSession(item) {
    // An explicit user choice cancels waiting for the newly created session.
    set({
      selected: item,
      loadingTranscript: true,
      transcript: undefined,
      pendingSessionId: undefined,
      bookmarks: new Set()
    })

    // Bookmarks belong to the session, so they reload with the transcript.
    void window.claudeUI.getNote(item.meta.sessionId).then((note) => {
      if (get().selected?.meta.sessionId !== item.meta.sessionId) return
      set({ bookmarks: new Set(note.bookmarks) })
    })
    try {
      const transcript = await window.claudeUI.readTranscript(
        item.meta.filePath,
        item.meta.projectPath,
        item.meta.encodedDir
      )
      // The user may have switched sessions while this was loading.
      if (get().selected?.meta.sessionId !== item.meta.sessionId) return
      set({ transcript, loadingTranscript: false })
    } catch {
      set({ loadingTranscript: false })
    }
  },

  /**
   * Re-reads the selected session's transcript from disk. Once a turn ends the file
   * is the single source of truth: it carries usage, tool results and subagent
   * branches that the live stream never contains.
   */
  async refreshTranscript() {
    const current = get().selected
    if (!current) return
    const transcript = await window.claudeUI.readTranscript(
      current.meta.filePath,
      current.meta.projectPath,
      current.meta.encodedDir
    )
    if (get().selected?.meta.sessionId !== current.meta.sessionId) return
    set({ transcript })
  },

  async toggleBookmark(messageUuid) {
    const sessionId = get().selected?.meta.sessionId
    if (!sessionId) return
    const updated = await window.claudeUI.toggleBookmark(sessionId, messageUuid)
    // The user may have switched sessions while we waited for the write.
    if (get().selected?.meta.sessionId !== sessionId) return
    set({ bookmarks: new Set(updated) })
  },

  setQuery: (query) => set({ query }),

  toggleProject(path) {
    const next = new Set(get().collapsedProjects)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    set({ collapsedProjects: next })
  },

  setRateLimits: (rateLimits) => set({ rateLimits })
}))
