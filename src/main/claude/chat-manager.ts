import { EventEmitter } from 'node:events'
import { warn } from '../log'
import type {
  ChatStartOptions,
  ChatState,
  ChatStreamEvent,
  ContextUsage,
  PermissionReply,
  PermissionRequest
} from '@shared/ipc'
import type { Attachment, PermissionMode, RateLimitEventInfo } from '@shared/types'
import { ClaudeRunner } from './runner'
import type { ControlRequest, RateLimitEvent, ResultEvent, SystemInitEvent } from './protocol'

/**
 * Holds a single active conversation.
 *
 * One runner per conversation, deliberately: two processes writing to the same
 * transcript would corrupt it. For parallel work on one session there is
 * `--fork-session`.
 */
/**
 * How much context the last turn consumed.
 *
 * The CLI reports the window size in `modelUsage[].contextWindow`; what is used is
 * input tokens plus cached ones, since together they form the prompt the model
 * saw. Output tokens are not counted — they fall outside the request window.
 */
function contextFrom(result: ResultEvent, currentModel?: string): ContextUsage | undefined {
  const usage = result.usage
  if (!usage) return undefined

  const used =
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  if (used <= 0) return undefined

  const entries = Object.entries(result.modelUsage ?? {})
  if (entries.length === 0) return undefined

  // The conversation's model is the most reliable anchor. A reply can include
  // service calls to haiku (title generation), and on a short turn those easily
  // produce more output tokens than the main model.
  const byName = currentModel
    ? entries.find(([name, usage]) => name === currentModel || usage.canonicalModel === currentModel)
    : undefined

  // Otherwise take whichever read the most input context: service calls run
  // without cache and with a tiny prompt.
  const main =
    byName ??
    entries.sort(
      (a, b) =>
        b[1].cacheReadInputTokens + b[1].inputTokens - (a[1].cacheReadInputTokens + a[1].inputTokens)
    )[0]

  const total = main[1].contextWindow
  if (!total) return undefined

  return {
    used,
    total,
    percent: Math.min(100, Math.round((used / total) * 100)),
    model: main[1].canonicalModel ?? main[0]
  }
}

export class ChatManager extends EventEmitter {
  private runner?: ClaudeRunner
  private state: ChatState = { status: 'idle' }
  /** An interrupted turn comes back as an error `result`; that needs no notification. */
  private interruptedByUser = false

  getState(): ChatState {
    return this.state
  }

  private setState(patch: Partial<ChatState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  async start(opts: ChatStartOptions): Promise<ChatState> {
    // Switching conversations always closes the previous process.
    await this.stop()

    this.setState({
      status: 'starting',
      cwd: opts.cwd,
      model: opts.model,
      sessionId: opts.resumeSessionId,
      error: undefined,
      exitCode: undefined
    })

    const runner = new ClaudeRunner({
      cwd: opts.cwd,
      model: opts.model,
      permissionMode: opts.permissionMode,
      effort: opts.effort,
      resumeSessionId: opts.resumeSessionId,
      forkSession: opts.forkSession
    })
    this.runner = runner

    runner.on('message', (msg) => {
      switch (msg.type) {
        case 'system': {
          const init = msg as SystemInitEvent
          if (init.subtype === 'init') {
            // init only arrives after the first message, so status is left alone —
            // it has been 'ready' since the process started. Only metadata is
            // refined here. After a permission-mode change the CLI sends an init
            // with no model field, so the stored model must not be overwritten.
            this.setState({
              sessionId: init.session_id,
              ...(init.model ? { model: init.model } : {}),
              ...(init.permissionMode ? { permissionMode: init.permissionMode } : {})
            })
          }
          break
        }
        case 'assistant':
          // The model started replying — the composer should offer "stop".
          if (this.state.status === 'ready') this.setState({ status: 'thinking' })
          break
        case 'result': {
          this.setState({
            status: 'ready',
            context: contextFrom(msg as ResultEvent, this.state.model)
          })
          const wasInterrupted = this.interruptedByUser
          this.interruptedByUser = false
          this.emit('result', msg as ResultEvent, { interrupted: wasInterrupted })
          break
        }
        case 'rate_limit_event':
          this.emit('rateLimit', (msg as RateLimitEvent).rate_limit_info satisfies RateLimitEventInfo)
          break
      }
      this.emit('event', { type: msg.type, payload: msg } satisfies ChatStreamEvent)
    })

    runner.on('permission', (req: ControlRequest) => {
      this.emit('permission', {
        requestId: req.request_id,
        toolName: String(req.request.tool_name ?? 'unknown tool'),
        input: req.request.input
      } satisfies PermissionRequest)
    })

    runner.on('stderr', (line) => {
      warn('[claude stderr]', line)
    })

    runner.on('error', (err) => {
      this.setState({ status: 'error', error: err.message })
    })

    runner.on('exit', (code) => {
      // Code 0 is a normal exit after stop(); anything else means a failure.
      this.setState({
        status: code === 0 || code === null ? 'exited' : 'error',
        exitCode: code,
        error: code && code !== 0 ? `process exited with code ${code}` : undefined
      })
      if (this.runner === runner) this.runner = undefined
    })

    await runner.start()
    // The CLI does not send `system/init` until it receives the first message, so
    // waiting for it before allowing input would deadlock. stdin is accepted at once.
    this.setState({ status: 'ready', sessionId: runner.sessionId })
    return this.state
  }

  send(text: string, attachments?: Attachment[]): void {
    if (!this.runner?.running) throw new Error('No active conversation')
    this.interruptedByUser = false
    this.setState({ status: 'thinking' })
    this.runner.send(text, attachments)
  }

  interrupt(): void {
    if (!this.runner?.running) return
    this.interruptedByUser = true
    this.runner.interrupt()
  }

  /**
   * Changes the permission mode of a running process. CLI support is not
   * guaranteed, so a failure is returned as a result rather than thrown.
   */
  async setPermissionMode(mode: PermissionMode): Promise<{ ok: boolean; error?: string }> {
    if (!this.runner?.running) return { ok: false, error: 'no active conversation' }
    try {
      await this.runner.setPermissionMode(mode)
      this.setState({ permissionMode: mode })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  /**
   * Switches the active conversation's model without restarting the process.
   * The CLI confirms the change with a fresh `system/init` carrying the new model.
   */
  async setModel(model: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.runner?.running) return { ok: false, error: 'no active conversation' }
    try {
      await this.runner.setModel(model)
      this.setState({ model })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  replyPermission(requestId: string, reply: PermissionReply): void {
    this.runner?.resolvePermission(requestId, reply)
  }

  async stop(): Promise<void> {
    const runner = this.runner
    if (!runner) return
    this.runner = undefined

    await new Promise<void>((resolve) => {
      // Not waiting forever: if the process lingers, the runner finishes it off.
      const timer = setTimeout(resolve, 3500)
      runner.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      runner.stop()
    })
    this.setState({ status: 'idle' })
  }
}
