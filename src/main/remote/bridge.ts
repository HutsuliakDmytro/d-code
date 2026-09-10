import { join } from 'node:path'
import type { ChatState, ChatStreamEvent, PermissionReply, PermissionRequest } from '@shared/ipc'
import type { ChatPool } from '../claude/chat-pool'
import { parseTranscript } from '../store/parser'
import { encodeProjectPath, projectDir } from '../store/project-paths'
import type { RemoteBridge, RemoteMessage, RemoteServer, RemoteTab } from './server'

/**
 * Connects the remote server to the conversations the desktop app is running.
 *
 * The phone drives the same `ChatPool` tabs, not a parallel set of its own: two
 * processes appending to one transcript would corrupt it, and a session you
 * cannot see from the desktop after touching it on the phone would be worse
 * than no remote access at all.
 */

interface ContentBlock {
  type: string
  text?: string
  name?: string
  id?: string
}

interface AssistantPayload {
  uuid?: string
  message?: { content?: ContentBlock[]; model?: string }
}

interface UserPayload {
  uuid?: string
  message?: { content?: string | ContentBlock[] }
}

function textOf(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
}

/** Titles a tab the way it reads on a small screen: the directory, then the branch. */
function titleFor(state: ChatState): string {
  const cwd = state.cwd
  if (!cwd) return 'New conversation'
  const name = cwd.split(/[/\\]/).filter(Boolean).pop()
  return name || cwd
}

export class ChatPoolBridge implements RemoteBridge {
  /** Permission requests still waiting, so a phone joining late still sees them. */
  private pending = new Map<string, PermissionRequest>()

  constructor(private pool: ChatPool) {}

  listTabs(): RemoteTab[] {
    return this.pool.listTabs().map(({ tabId, state }) => ({
      id: tabId,
      title: titleFor(state),
      cwd: state.cwd,
      status: state.status,
      model: state.model,
      sessionId: state.sessionId,
      pending: this.pending.get(tabId)
    }))
  }

  send(tabId: string, text: string): void {
    this.pool.send(tabId, text)
  }

  interrupt(tabId: string): void {
    this.pool.interrupt(tabId)
  }

  replyPermission(tabId: string, requestId: string, reply: PermissionReply): void {
    this.pool.replyPermission(tabId, requestId, reply)
    this.pending.delete(tabId)
  }

  notePermission(tabId: string, request: PermissionRequest): void {
    this.pending.set(tabId, request)
  }

  clearPermission(tabId: string): void {
    this.pending.delete(tabId)
  }

  /**
   * History from the transcript the CLI is writing.
   *
   * The file is the authority — it is what the desktop app reads too — so a
   * phone and a laptop looking at the same session cannot disagree.
   */
  async history(tabId: string): Promise<RemoteMessage[]> {
    const state = this.pool.getState(tabId)
    if (!state.sessionId || !state.cwd) return []

    const filePath = join(projectDir(state.cwd), `${state.sessionId}.jsonl`)
    const parsed = await parseTranscript(filePath, {
      projectPath: state.cwd,
      encodedDir: encodeProjectPath(state.cwd)
    }).catch(() => undefined)
    if (!parsed) return []

    return parsed.messages
      .filter((m) => m.role !== 'system' && !m.isSynthetic)
      .map((m) => ({
        uuid: m.uuid,
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        text: m.text,
        tools: m.toolCalls.map((c) => c.name),
        timestamp: m.timestamp
      }))
      .filter((m) => m.text.trim() || m.tools.length > 0)
  }
}

/**
 * Forwards conversation events into the server.
 *
 * The normalisation matches the renderer's: assistant turns arrive first as
 * `stream_event` deltas and then once more as a complete `assistant` message,
 * so the delta is only ever a preview that the finished message replaces.
 */
export function forwardToRemote(
  server: RemoteServer,
  bridge: ChatPoolBridge,
  tabId: string,
  event: ChatStreamEvent
): void {
  const { type, payload } = event

  if (type === 'stream_event') {
    const delta = (payload as { event?: { delta?: { type?: string; text?: string } } }).event?.delta
    if (delta?.type === 'text_delta' && delta.text) server.pushDelta(tabId, delta.text)
    return
  }

  if (type === 'user') {
    const p = payload as UserPayload
    const text = textOf(p.message?.content)
    if (!text.trim()) return
    server.addMessage(tabId, {
      uuid: p.uuid ?? `user-${Date.now()}`,
      role: 'user',
      text,
      tools: [],
      timestamp: new Date().toISOString()
    })
    return
  }

  if (type === 'assistant') {
    const p = payload as AssistantPayload
    const content = p.message?.content ?? []
    const text = textOf(content)
    const tools = content.filter((b) => b.type === 'tool_use').map((b) => b.name ?? 'tool')
    if (!text.trim() && tools.length === 0) return

    server.addMessage(tabId, {
      uuid: p.uuid ?? `assistant-${Date.now()}`,
      role: 'assistant',
      text,
      tools,
      timestamp: new Date().toISOString()
    })
    return
  }

  if (type === 'result') {
    bridge.clearPermission(tabId)
    server.pushTurnEnd(tabId)
  }
}
