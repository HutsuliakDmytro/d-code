import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { Attachment, PermissionMode } from '@shared/types'
import { childEnv, resolveClaudePath } from './resolve-cli'
import type {
  ControlRequest,
  PermissionDecision,
  StreamMessage,
  UserInputMessage
} from './protocol'
import { needsShell } from '../system/platform'

export interface RunnerOptions {
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  /** Resume an existing session. Mutually exclusive with `sessionId`. */
  resumeSessionId?: string
  /** Create a new session under this UUID. */
  sessionId?: string
  /** On resume, branch into a new session instead of appending to the existing one. */
  forkSession?: boolean
  effort?: string
  addDirs?: string[]
  maxBudgetUsd?: number
  /** Path to the binary; taken from PATH by default. */
  claudePath?: string
}

export interface RunnerEvents {
  message: (msg: StreamMessage) => void
  permission: (req: ControlRequest) => void
  error: (err: Error) => void
  exit: (code: number | null) => void
  stderr: (line: string) => void
}

/**
 * Wrapper around `claude` in headless stream-json mode.
 *
 * The process lives for the whole conversation: NDJSON goes into stdin, NDJSON
 * comes out of stdout. Tool permissions arrive on a separate control channel
 * (`control_request`) and must be answered with a `control_response` carrying the
 * same `request_id`, or the CLI waits forever.
 */
export class ClaudeRunner extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams
  private stdoutReader?: Interface
  private pendingPermissions = new Map<string, ControlRequest>()
  /** Our own control requests awaiting a reply from the CLI. */
  private pendingControl = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private controlSeq = 0
  private closed = false

  readonly sessionId: string

  constructor(private readonly opts: RunnerOptions) {
    super()
    this.sessionId = opts.resumeSessionId ?? opts.sessionId ?? randomUUID()
  }

  get running(): boolean {
    return Boolean(this.child) && !this.closed
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('Process already running')

    const args = this.buildArgs()
    // Absolute path and a full PATH: launched from the Dock, the app inherits a
    // trimmed environment with neither claude nor the tools it runs.
    const command = this.opts.claudePath ?? (await resolveClaudePath())
    this.child = spawn(command, args, {
      cwd: this.opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: needsShell(command),
      env: await childEnv({
        // Tells the CLI it was not launched from a terminal.
        CLAUDE_CODE_ENTRYPOINT: 'sdk-cli'
      })
    })

    this.stdoutReader = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.stdoutReader.on('line', (line) => this.handleLine(line))

    const stderrReader = createInterface({ input: this.child.stderr, crlfDelay: Infinity })
    stderrReader.on('line', (line) => this.emit('stderr', line))

    this.child.on('error', (err) => this.emit('error', err))
    this.child.on('exit', (code) => {
      this.closed = true
      // Nothing will service the outstanding permission requests now.
      this.pendingPermissions.clear()
      for (const pending of this.pendingControl.values()) {
        pending.reject(new Error('process exited'))
      }
      this.pendingControl.clear()
      this.emit('exit', code)
    })
  }

  private buildArgs(): string[] {
    const o = this.opts
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--replay-user-messages',
      '--verbose',
      // Makes bypassPermissions AVAILABLE without enabling it: without this flag
      // the CLI refuses to switch a running session into that mode. The effective
      // mode is set by --permission-mode below.
      '--allow-dangerously-skip-permissions'
    ]

    if (o.resumeSessionId) {
      args.push('--resume', o.resumeSessionId)
      if (o.forkSession) args.push('--fork-session')
    } else {
      args.push('--session-id', this.sessionId)
    }

    if (o.model) args.push('--model', o.model)
    if (o.permissionMode) args.push('--permission-mode', o.permissionMode)
    if (o.effort) args.push('--effort', o.effort)
    if (o.maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(o.maxBudgetUsd))
    for (const dir of o.addDirs ?? []) args.push('--add-dir', dir)

    return args
  }

  private handleLine(line: string): void {
    if (!line.trim()) return
    let msg: StreamMessage
    try {
      msg = JSON.parse(line) as StreamMessage
    } catch {
      // An unparseable line must not kill the conversation — the CLI writes noise sometimes.
      this.emit('stderr', `invalid JSON in stream: ${line.slice(0, 200)}`)
      return
    }

    // A reply to one of our own control requests, e.g. a permission-mode change.
    if (msg.type === 'control_response') {
      const res = (
        msg as {
          response?: { request_id?: string; subtype?: string; error?: string; response?: unknown }
        }
      ).response
      const requestId = res?.request_id
      const pending = requestId ? this.pendingControl.get(requestId) : undefined
      if (pending && requestId) {
        this.pendingControl.delete(requestId)
        if (res?.subtype === 'error') {
          pending.reject(new Error(res.error ?? 'control request failed'))
        } else {
          pending.resolve(res?.response)
        }
      }
      return
    }

    if (msg.type === 'control_request') {
      const req = msg as ControlRequest
      if (req.request?.subtype === 'can_use_tool') {
        this.pendingPermissions.set(req.request_id, req)
        this.emit('permission', req)
        return
      }
      // Other control requests (hook_callback, mcp_message) have no handler here
      // yet: answer with an error, otherwise the CLI hangs waiting.
      this.respondControl(req.request_id, { error: `unsupported request: ${req.request?.subtype}` })
      return
    }

    this.emit('message', msg)
  }

  /**
   * Sends a user message. The process must already be running.
   *
   * Images travel as separate `image` blocks, referenced from the text by an
   * `[Image #N]` marker — that is exactly how the CLI writes them into transcripts
   * and exactly the input it accepts. Other attachments are mentioned by path so
   * the model reads them itself.
   */
  send(text: string, attachments?: Attachment[]): void {
    if (!this.child?.stdin.writable) throw new Error('Process is not accepting input')

    const images = (attachments ?? []).filter((a) => a.kind === 'image' && a.base64)
    const files = (attachments ?? []).filter((a) => a.kind === 'file' && a.path)

    let content: UserInputMessage['message']['content'] = text

    if (images.length > 0 || files.length > 0) {
      const parts: string[] = []
      images.forEach((_, i) => parts.push(`[Image #${i + 1}]`))
      if (files.length > 0) {
        parts.push(files.map((f) => f.path).join('\n'))
      }
      parts.push(text)

      content = [
        { type: 'text', text: parts.filter(Boolean).join('\n') },
        ...images.map((a) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: a.mediaType ?? 'image/png',
            data: a.base64!
          }
        }))
      ]
    }

    const payload: UserInputMessage = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  /** Answer to a permission request. Without it the CLI waits forever. */
  resolvePermission(requestId: string, decision: PermissionDecision): void {
    if (!this.pendingPermissions.delete(requestId)) return
    this.respondControl(requestId, { response: decision })
  }

  private respondControl(
    requestId: string,
    body: { response?: unknown; error?: string }
  ): void {
    if (!this.child?.stdin.writable) return
    const payload = {
      type: 'control_response',
      response: {
        subtype: body.error ? 'error' : 'success',
        request_id: requestId,
        ...body
      }
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  /**
   * Sends a control request to the CLI and waits for the reply.
   * The timeout is mandatory: an unknown subtype may never be answered at all.
   */
  private sendControl(request: Record<string, unknown>, timeoutMs = 5000): Promise<unknown> {
    const stdin = this.child?.stdin
    if (!stdin?.writable) return Promise.reject(new Error('process is not accepting input'))

    const requestId = `ui-${++this.controlSeq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingControl.delete(requestId)
        reject(new Error('the CLI did not answer the control request'))
      }, timeoutMs)

      this.pendingControl.set(requestId, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })

      stdin.write(
        `${JSON.stringify({ type: 'control_request', request_id: requestId, request })}\n`
      )
    })
  }

  /** Changes the permission mode of a running process, without restarting it. */
  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.sendControl({ subtype: 'set_permission_mode', mode })
  }

  /**
   * Switches the model in a running session.
   *
   * `--model` is fixed at launch, but the CLI accepts a `set_model` control request
   * and then emits an updated `system/init` carrying the new model.
   */
  async setModel(model: string): Promise<void> {
    await this.sendControl({ subtype: 'set_model', model })
  }

  /**
   * Interrupts the current turn without killing the process.
   *
   * A control request rather than SIGINT: the signal would end the whole process,
   * and the conversation would have to be brought back via `--resume`.
   */
  interrupt(): void {
    if (!this.child?.stdin.writable) return
    const payload = {
      type: 'control_request',
      request_id: `interrupt-${randomUUID()}`,
      request: { subtype: 'interrupt' }
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  /** Ends the conversation: stdin is closed so the CLI finishes the transcript. */
  stop(): void {
    if (!this.child) return
    this.closed = true
    this.child.stdin.end()
    // If the CLI has not exited on its own, take it down.
    const child = this.child
    setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM')
    }, 3000).unref()
  }
}
