import { EventEmitter } from 'node:events'
import type {
  ChatStartOptions,
  ChatState,
  ChatStreamEvent,
  PermissionReply,
  PermissionRequest
} from '@shared/ipc'
import type { Attachment, PermissionMode, RateLimitEventInfo } from '@shared/types'
import { ChatManager } from './chat-manager'
import type { ResultEvent } from './protocol'

/**
 * Several conversations in parallel.
 *
 * Each tab is a separate `ChatManager` with its own CLI process: two processes
 * writing to one transcript would corrupt it, so tabs always hold distinct
 * sessions. The pool only routes calls and tags events with `tabId` so the
 * renderer knows which tab they belong to.
 */
export class ChatPool extends EventEmitter {
  private tabs = new Map<string, ChatManager>()

  /** Creates the tab if it does not exist yet and subscribes to its events. */
  private ensure(tabId: string): ChatManager {
    const existing = this.tabs.get(tabId)
    if (existing) return existing

    const chat = new ChatManager()
    chat.on('state', (state: ChatState) => this.emit('state', { tabId, state }))
    chat.on('event', (event: ChatStreamEvent) => this.emit('event', { tabId, event }))
    chat.on('permission', (request: PermissionRequest) =>
      this.emit('permission', { tabId, request })
    )
    chat.on('result', (result: ResultEvent, meta?: { interrupted?: boolean }) =>
      this.emit('result', { tabId, result, meta })
    )
    chat.on('rateLimit', (info: RateLimitEventInfo) => this.emit('rateLimit', info))

    this.tabs.set(tabId, chat)
    return chat
  }

  async start(tabId: string, opts: ChatStartOptions): Promise<ChatState> {
    return this.ensure(tabId).start(opts)
  }

  send(tabId: string, text: string, attachments?: Attachment[]): void {
    const chat = this.tabs.get(tabId)
    if (!chat) throw new Error('No such conversation')
    chat.send(text, attachments)
  }

  interrupt(tabId: string): void {
    this.tabs.get(tabId)?.interrupt()
  }

  replyPermission(tabId: string, requestId: string, reply: PermissionReply): void {
    this.tabs.get(tabId)?.replyPermission(requestId, reply)
  }

  setPermissionMode(tabId: string, mode: PermissionMode): Promise<{ ok: boolean; error?: string }> {
    const chat = this.tabs.get(tabId)
    if (!chat) return Promise.resolve({ ok: false, error: 'no active conversation' })
    return chat.setPermissionMode(mode)
  }

  setModel(tabId: string, model: string): Promise<{ ok: boolean; error?: string }> {
    const chat = this.tabs.get(tabId)
    if (!chat) return Promise.resolve({ ok: false, error: 'no active conversation' })
    return chat.setModel(model)
  }

  getState(tabId: string): ChatState {
    return this.tabs.get(tabId)?.getState() ?? { status: 'idle' }
  }

  /** Stops a tab and removes it from the pool. */
  async close(tabId: string): Promise<void> {
    const chat = this.tabs.get(tabId)
    if (!chat) return
    this.tabs.delete(tabId)
    await chat.stop()
    chat.removeAllListeners()
  }

  /** Stops every conversation — used when the app quits. */
  async stopAll(): Promise<void> {
    await Promise.all([...this.tabs.keys()].map((id) => this.close(id)))
  }

  /** How many conversations currently hold a live process. */
  activeCount(): number {
    let count = 0
    for (const chat of this.tabs.values()) {
      const status = chat.getState().status
      if (status === 'ready' || status === 'thinking') count++
    }
    return count
  }
}
