import { create } from 'zustand'
import type {
  ActionResult,
  ChatState,
  ChatStreamEvent,
  PermissionReply,
  PermissionRequest
} from '@shared/ipc'
import type {
  Attachment,
  ChatMessage,
  ContentBlock,
  PermissionMode,
  ToolCall
} from '@shared/types'
import { MAX_ATTACHMENTS } from '@shared/types'
import { tr } from '../i18n'

interface AssistantPayload {
  uuid: string
  message?: { id?: string; model?: string; content?: ContentBlock[] }
}
interface StreamPayload {
  uuid: string
  event?: { type: string; delta?: { type: string; text?: string } }
}
interface UserPayload {
  uuid: string
  message?: { content?: string | ContentBlock[] }
}

/** Everything belonging to a single conversation tab. */
export interface ChatTab {
  id: string
  title: string
  /** Working directory — tabs can live in different projects. */
  cwd?: string
  /** Session being resumed; for a new one this fills in after start. */
  sessionId?: string
  state: ChatState
  live: ChatMessage[]
  streamingText: string
  queue: string[]
  attachments: Attachment[]
  attachmentError?: string
  permission?: PermissionRequest
  draft?: string
  lastSentText?: string
}

function newTab(id: string, title: string, cwd?: string, sessionId?: string): ChatTab {
  return {
    id,
    title,
    cwd,
    sessionId,
    state: { status: 'idle' },
    live: [],
    streamingText: '',
    queue: [],
    attachments: []
  }
}

interface ChatStore {
  tabs: ChatTab[]
  activeId: string

  /** Active tab's state — most of the interface works against this. */
  active: () => ChatTab

  openTab: (opts?: { title?: string; cwd?: string; sessionId?: string }) => string
  closeTab: (id: string) => Promise<void>
  setActive: (id: string) => void
  renameTab: (id: string, title: string) => void

  setState: (tabId: string, state: ChatState) => void
  applyEvent: (tabId: string, event: ChatStreamEvent) => void
  setPermission: (tabId: string, req?: PermissionRequest) => void
  clearLive: (tabId?: string) => void
  reset: (tabId?: string) => void

  editDraft: (text: string) => void
  takeDraft: () => string | undefined

  enqueue: (text: string) => void
  dequeue: (index: number) => void
  flushQueue: (tabId?: string) => Promise<void>

  addAttachments: (items: Attachment[]) => void
  removeAttachment: (id: string) => void
  setAttachmentError: (message?: string) => void

  start: (
    cwd: string,
    opts?: {
      model?: string
      resumeSessionId?: string
      permissionMode?: PermissionMode
      effort?: string
      forkSession?: boolean
    }
  ) => Promise<void>
  send: (text: string) => Promise<void>
  interrupt: () => Promise<void>
  reply: (reply: PermissionReply) => Promise<void>
  changePermissionMode: (mode: PermissionMode) => Promise<ActionResult>
  changeModel: (model: string) => Promise<ActionResult>
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && 'text' in b)
    .map((b) => b.text)
    .join('')
}

let tabCounterFallback = 0
function makeId(): string {
  // crypto.randomUUID exists in Electron; the fallback is there for tests.
  return globalThis.crypto?.randomUUID?.() ?? `tab-${++tabCounterFallback}`
}

const FIRST_TAB = makeId()

export const useChatStore = create<ChatStore>((set, get) => {
  /** Targeted tab update — everything else stays as it was. */
  const patch = (tabId: string, fn: (tab: ChatTab) => Partial<ChatTab>): void => {
    set((s) => ({
      tabs: s.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...fn(tab) } : tab))
    }))
  }

  return {
    tabs: [newTab(FIRST_TAB, 'Chat 1')],
    activeId: FIRST_TAB,

    active: () => get().tabs.find((t) => t.id === get().activeId) ?? get().tabs[0],

    openTab(opts) {
      const id = makeId()
      const title = opts?.title ?? `Chat ${get().tabs.length + 1}`
      set((s) => ({
        tabs: [...s.tabs, newTab(id, title, opts?.cwd, opts?.sessionId)],
        activeId: id
      }))
      return id
    },

    async closeTab(id) {
      // The CLI process must be stopped explicitly or it outlives the tab.
      await window.claudeUI.chatClose(id)
      set((s) => {
        const remaining = s.tabs.filter((t) => t.id !== id)
        if (remaining.length === 0) {
          const fresh = newTab(makeId(), 'Chat 1')
          return { tabs: [fresh], activeId: fresh.id }
        }
        const activeId = s.activeId === id ? remaining[remaining.length - 1].id : s.activeId
        return { tabs: remaining, activeId }
      })
    },

    setActive: (activeId) => set({ activeId }),
    renameTab: (id, title) => patch(id, () => ({ title })),

    setState: (tabId, state) => patch(tabId, () => ({ state })),
    setPermission: (tabId, permission) => patch(tabId, () => ({ permission })),
    clearLive: (tabId) => patch(tabId ?? get().activeId, () => ({ live: [], streamingText: '' })),

    reset: (tabId) =>
      patch(tabId ?? get().activeId, () => ({
        live: [],
        streamingText: '',
        permission: undefined,
        draft: undefined,
        lastSentText: undefined,
        attachments: [],
        attachmentError: undefined,
        queue: []
      })),

    applyEvent(tabId, { type, payload }) {
      if (type === 'user') {
        const p = payload as UserPayload
        const text = textOf(p.message?.content)
        if (!text.trim()) return
        patch(tabId, (tab) =>
          // The --replay-user-messages echo must not duplicate a shown message.
          tab.live.some((m) => m.role === 'user' && m.text === text)
            ? {}
            : {
                live: [
                  ...tab.live,
                  {
                    uuid: p.uuid,
                    role: 'user' as const,
                    timestamp: new Date().toISOString(),
                    text,
                    toolCalls: [],
                    isSynthetic: false
                  }
                ]
              }
        )
        return
      }

      if (type === 'stream_event') {
        const delta = (payload as StreamPayload).event?.delta
        if (delta?.type === 'text_delta' && delta.text) {
          patch(tabId, (tab) => ({ streamingText: tab.streamingText + delta.text }))
        }
        return
      }

      if (type === 'assistant') {
        const p = payload as AssistantPayload
        const content = p.message?.content ?? []
        const text = textOf(content)
        const toolCalls: ToolCall[] = content
          .filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
          .map((b) => ({ id: b.id, name: b.name, input: b.input }))

        if (!text.trim() && toolCalls.length === 0) {
          patch(tabId, () => ({ streamingText: '' }))
          return
        }
        patch(tabId, (tab) => ({
          streamingText: '',
          live: [
            ...tab.live,
            {
              uuid: p.uuid,
              role: 'assistant' as const,
              timestamp: new Date().toISOString(),
              text,
              toolCalls,
              model: p.message?.model,
              isSynthetic: p.message?.model === '<synthetic>'
            }
          ]
        }))
        return
      }

      if (type === 'result') patch(tabId, () => ({ streamingText: '' }))
    },

    editDraft: (text) => patch(get().activeId, () => ({ draft: text })),

    takeDraft() {
      const tab = get().active()
      if (tab.draft === undefined) return undefined
      patch(tab.id, () => ({ draft: undefined }))
      return tab.draft
    },

    enqueue: (text) => patch(get().activeId, (tab) => ({ queue: [...tab.queue, text] })),
    dequeue: (index) =>
      patch(get().activeId, (tab) => ({ queue: tab.queue.filter((_, i) => i !== index) })),

    async flushQueue(tabId) {
      const id = tabId ?? get().activeId
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || tab.queue.length === 0) return
      if (tab.state.status !== 'ready') return

      const [next, ...rest] = tab.queue
      patch(id, () => ({ queue: rest }))
      await sendTo(id, next)
    },

    addAttachments(items) {
      if (items.length === 0) return
      patch(get().activeId, (tab) => {
        const room = MAX_ATTACHMENTS - tab.attachments.length
        if (room <= 0) {
          return { attachmentError: tr('At most {max} attachments', { max: MAX_ATTACHMENTS }) }
        }
        return {
          attachments: [...tab.attachments, ...items.slice(0, room)],
          attachmentError:
            items.length > room
              ? tr('Only {count} added: the limit is {max}', { count: room, max: MAX_ATTACHMENTS })
              : undefined
        }
      })
    },

    removeAttachment: (id) =>
      patch(get().activeId, (tab) => ({ attachments: tab.attachments.filter((a) => a.id !== id) })),

    setAttachmentError: (attachmentError) => patch(get().activeId, () => ({ attachmentError })),

    async start(cwd, opts) {
      const id = get().activeId
      get().reset(id)
      const state = await window.claudeUI.chatStart(id, {
        cwd,
        model: opts?.model || undefined,
        effort: opts?.effort || undefined,
        resumeSessionId: opts?.resumeSessionId,
        forkSession: opts?.forkSession,
        permissionMode: opts?.permissionMode ?? 'acceptEdits'
      })
      patch(id, () => ({ state, cwd, sessionId: state.sessionId }))
    },

    send: (text) => sendTo(get().activeId, text),

    async interrupt() {
      const id = get().activeId
      await window.claudeUI.chatInterrupt(id)

      // The message already reached the CLI and landed in the transcript, so
      // removing it from the feed would be a lie. Instead the turn is marked as
      // interrupted and the text goes back to the composer for editing.
      patch(id, (tab) => ({
        draft: tab.lastSentText,
        streamingText: '',
        live: [
          ...tab.live,
          {
            uuid: `interrupt-${Date.now()}`,
            role: 'system' as const,
            timestamp: new Date().toISOString(),
            text: tr('Turn interrupted'),
            toolCalls: [],
            isSynthetic: false
          }
        ]
      }))
    },

    async reply(reply) {
      const tab = get().active()
      if (!tab.permission) return
      patch(tab.id, () => ({ permission: undefined }))
      await window.claudeUI.replyPermission(tab.id, tab.permission.requestId, reply)
    },

    async changePermissionMode(mode) {
      const id = get().activeId
      const result = await window.claudeUI.setPermissionMode(id, mode)
      if (result.ok) patch(id, (tab) => ({ state: { ...tab.state, permissionMode: mode } }))
      return result
    },

    changeModel: (model) => window.claudeUI.setModel(get().activeId, model)
  }

  /** Shared send path, used both directly and by the queue. */
  async function sendTo(tabId: string, text: string): Promise<void> {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return

    const attachments = tab.attachments
    const label = attachments.length
      ? `${attachments.map((a) => (a.kind === 'image' ? `🖼 ${a.name}` : `📎 ${a.name}`)).join('  ')}\n`
      : ''

    patch(tabId, (current) => ({
      lastSentText: text,
      attachments: [],
      attachmentError: undefined,
      live: [
        ...current.live,
        {
          uuid: `local-${Date.now()}`,
          role: 'user' as const,
          timestamp: new Date().toISOString(),
          text: label + text,
          toolCalls: [],
          isSynthetic: false
        }
      ]
    }))
    await window.claudeUI.chatSend(tabId, text, attachments)
  }
})
