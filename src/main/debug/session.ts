import { spawn, type ChildProcess } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { childEnv } from '../claude/resolve-cli'
import { warn } from '../log'

export interface Breakpoint {
  path: string
  line: number
  /** Confirmed by the engine — meaning this line holds executable code. */
  verified?: boolean
}

export interface StackFrame {
  id: string
  name: string
  path?: string
  line: number
  column: number
}

export interface Variable {
  name: string
  value: string
  type?: string
  /** Handle for expanding an object; absent for primitive values. */
  objectId?: string
}

export interface Scope {
  name: string
  objectId?: string
}

export interface DebugState {
  running: boolean
  paused: boolean
  reason?: string
  frames: StackFrame[]
  error?: string
  output: string
}

/**
 * Node debugging over the Chrome DevTools Protocol.
 *
 * Deliberately not DAP: an adapter would mean pulling in a heavy extra package,
 * whereas Node speaks CDP natively — `--inspect-brk` plus a WebSocket to the
 * address it prints on stderr is all it takes. For "run a script and stop on a
 * line" that is entirely sufficient.
 */
export class DebugSession extends EventEmitter {
  private child?: ChildProcess
  private socket?: WebSocket
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (err: Error) => void }
  >()

  /**
   * Script URLs by engine id.
   *
   * Stack frames carry no path of their own, only a `scriptId`, so without this
   * table there is no telling which file execution stopped in.
   */
  private urlByScriptId = new Map<string, string>()
  /**
   * Real path → the path the file is open under in the editor.
   *
   * The engine only knows files by their resolved paths, so `/var/…` becomes
   * `/private/var/…`. Without this table a breakpoint set in a tab would land on
   * an address the engine does not recognise, and silently never fire.
   */
  private realToEditor = new Map<string, string>()
  private breakpoints = new Map<string, number[]>()
  private state: DebugState = { running: false, paused: false, frames: [], output: '' }
  private callFrames: Array<{ callFrameId: string; scopeChain: unknown[] }> = []
  /**
   * `--inspect-brk` halts the script on its first line before anything runs at
   * all. That pause is an artefact nobody asked for, so it is skipped.
   */
  private awaitingFirstPause = true

  getState(): DebugState {
    return this.state
  }

  private setState(patch: Partial<DebugState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  listBreakpoints(): Breakpoint[] {
    const out: Breakpoint[] = []
    for (const [path, lines] of this.breakpoints) {
      for (const line of lines) out.push({ path, line })
    }
    return out
  }

  /** Breakpoints can be set before launch; they are sent to the engine on connect. */
  toggleBreakpoint(path: string, line: number): Breakpoint[] {
    const lines = this.breakpoints.get(path) ?? []
    const next = lines.includes(line)
      ? lines.filter((l) => l !== line)
      : [...lines, line].sort((a, b) => a - b)

    if (next.length === 0) this.breakpoints.delete(path)
    else this.breakpoints.set(path, next)

    if (this.socket) void this.syncBreakpoints()
    const result = this.listBreakpoints()
    this.emit('breakpoints', result)
    return result
  }

  async start(opts: { root: string; program: string; args?: string[] }): Promise<DebugState> {
    await this.stop()

    const env = await childEnv()
    const child = spawn(
      process.execPath,
      ['--inspect-brk=0', opts.program, ...(opts.args ?? [])],
      { cwd: opts.root, env, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    this.child = child
    this.awaitingFirstPause = true
    this.setState({ running: true, paused: false, frames: [], output: '', error: undefined })

    child.stdout?.on('data', (chunk: Buffer) => this.appendOutput(chunk.toString()))

    // The inspector address arrives on stderr, as the very first line.
    const onStderr = (chunk: Buffer): void => {
      const text = chunk.toString()
      const match = /ws:\/\/[^\s]+/.exec(text)
      if (match) {
        child.stderr?.off('data', onStderr)
        void this.connect(match[0])
      }
      this.appendOutput(text)
    }
    child.stderr?.on('data', onStderr)

    child.on('exit', (code) => {
      this.child = undefined
      this.socket?.close()
      this.socket = undefined
      this.setState({
        running: false,
        paused: false,
        frames: [],
        reason: `process exited with code ${code}`
      })
    })

    return this.state
  }

  private appendOutput(text: string): void {
    // Keep only the tail: a long log would eat memory and stall rendering.
    const combined = this.state.output + text
    this.setState({ output: combined.length > 200_000 ? combined.slice(-200_000) : combined })
  }

  private async connect(url: string): Promise<void> {
    const socket = new WebSocket(url)
    this.socket = socket

    socket.addEventListener('message', (event) => {
      try {
        this.handleMessage(JSON.parse(String(event.data)) as Record<string, unknown>)
      } catch {
        warn('[dbg] unparseable message')
      }
    })
    socket.addEventListener('error', () => this.setState({ error: 'could not connect' }))

    await new Promise<void>((resolve) => {
      socket.addEventListener('open', () => resolve(), { once: true })
    })

    await this.send('Runtime.enable', {})
    await this.send('Debugger.enable', {})
    await this.syncBreakpoints()
    // The script is parked on line one by --inspect-brk; release it so execution
    // stops at the user's breakpoint instead.
    await this.send('Runtime.runIfWaitingForDebugger', {})
  }

  private send(method: string, params: unknown): Promise<Record<string, unknown>> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('no connection to the engine'))
    }

    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method}: the engine did not answer`))
      }, 10_000)
    })
  }

  private handleMessage(message: Record<string, unknown>): void {
    const id = message.id as number | undefined
    if (id !== undefined) {
      const entry = this.pending.get(id)
      if (!entry) return
      this.pending.delete(id)

      const error = message.error as { message?: string } | undefined
      if (error) entry.reject(new Error(error.message ?? 'engine error'))
      else entry.resolve((message.result ?? {}) as Record<string, unknown>)
      return
    }

    const method = message.method as string | undefined
    const params = message.params as Record<string, unknown> | undefined

    if (method === 'Debugger.scriptParsed' && params) {
      const url = String(params.url ?? '')
      if (url.startsWith('file://')) this.urlByScriptId.set(String(params.scriptId), url)
      return
    }

    if (method === 'Debugger.paused' && params) {
      if (this.awaitingFirstPause) {
        this.awaitingFirstPause = false
        void this.send('Debugger.resume', {}).catch(() => undefined)
        return
      }

      const frames = (params.callFrames ?? []) as Array<{
        callFrameId: string
        functionName?: string
        location: { scriptId: string; lineNumber: number; columnNumber?: number }
        url?: string
        scopeChain: unknown[]
      }>

      this.callFrames = frames.map((f) => ({ callFrameId: f.callFrameId, scopeChain: f.scopeChain }))

      const mapped = frames.map((f) => {
        const url = f.url || this.urlByScriptId.get(f.location.scriptId)
        const real = url?.startsWith('file://') ? fileURLToPath(url) : undefined
        return {
          id: f.callFrameId,
          name: f.functionName || '(anonymous)',
          path: real ? (this.realToEditor.get(real) ?? real) : undefined,
          // CDP counts lines from zero, the editor from one.
          line: f.location.lineNumber + 1,
          column: (f.location.columnNumber ?? 0) + 1
        }
      })

      // Beneath the user's code there is always Node's module machinery — a dozen
      // frames that say nothing. They are shown only when no own code is on the
      // stack at all.
      const own = mapped.filter((f) => f.path)
      this.setState({
        paused: true,
        reason: String((params.reason as string) ?? 'paused'),
        frames: own.length > 0 ? own : mapped
      })
      return
    }

    if (method === 'Debugger.resumed') {
      this.callFrames = []
      this.setState({ paused: false, frames: [] })
      return
    }

    if (method === 'Runtime.executionContextDestroyed') {
      // The script has finished, but Node will not exit while a debugger is
      // attached — it politely waits ("Waiting for the debugger to disconnect...").
      // Releasing the socket is what lets it go; otherwise the session hangs.
      this.socket?.close()
      this.socket = undefined
      return
    }

    if (method === 'Runtime.consoleAPICalled' && params) {
      const args = (params.args ?? []) as Array<{ value?: unknown; description?: string }>
      const text = args.map((a) => String(a.value ?? a.description ?? '')).join(' ')
      this.appendOutput(`${text}\n`)
    }
  }

  private async syncBreakpoints(): Promise<void> {
    for (const [path, lines] of this.breakpoints) {
      const real = await realpath(path).catch(() => path)
      if (real !== path) this.realToEditor.set(real, path)
      const url = pathToFileURL(real).toString()
      for (const line of lines) {
        try {
          await this.send('Debugger.setBreakpointByUrl', {
            url,
            // The engine expects zero-based numbering.
            lineNumber: line - 1,
            columnNumber: 0
          })
        } catch {
          // A line with no executable code is refused; that is not a session error.
        }
      }
    }
  }

  async resume(): Promise<void> {
    await this.send('Debugger.resume', {}).catch(() => undefined)
  }

  async stepOver(): Promise<void> {
    await this.send('Debugger.stepOver', {}).catch(() => undefined)
  }

  async stepInto(): Promise<void> {
    await this.send('Debugger.stepInto', {}).catch(() => undefined)
  }

  async stepOut(): Promise<void> {
    await this.send('Debugger.stepOut', {}).catch(() => undefined)
  }

  /** Scopes of a frame: local, closure, global. */
  async scopes(frameId: string): Promise<Scope[]> {
    const frame = this.callFrames.find((f) => f.callFrameId === frameId)
    if (!frame) return []

    return (frame.scopeChain as Array<{ type: string; object?: { objectId?: string } }>)
      .filter((scope) => scope.type !== 'global') // the global scope is hundreds of entries
      .map((scope) => ({ name: scope.type, objectId: scope.object?.objectId }))
  }

  async variables(objectId: string): Promise<Variable[]> {
    try {
      const result = await this.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        generatePreview: true
      })

      const props = (result.result ?? []) as Array<{
        name: string
        value?: { type?: string; value?: unknown; description?: string; objectId?: string }
      }>

      return props
        .filter((p) => p.value)
        .map((p) => ({
          name: p.name,
          value: String(p.value?.value ?? p.value?.description ?? p.value?.type ?? ''),
          type: p.value?.type,
          objectId: p.value?.objectId
        }))
    } catch {
      return []
    }
  }

  /** Evaluates an expression in the context of a paused frame. */
  async evaluate(frameId: string, expression: string): Promise<string> {
    try {
      const result = await this.send('Debugger.evaluateOnCallFrame', {
        callFrameId: frameId,
        expression,
        returnByValue: false,
        generatePreview: true
      })
      const value = result.result as { value?: unknown; description?: string } | undefined
      return String(value?.value ?? value?.description ?? '')
    } catch (err) {
      return `error: ${(err as Error).message}`
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined

    for (const [, entry] of this.pending) entry.reject(new Error('session stopped'))
    this.pending.clear()
    this.callFrames = []
    this.urlByScriptId.clear()
    this.realToEditor.clear()

    this.socket?.close()
    this.socket = undefined

    if (child) {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 2000).unref()
    }

    this.setState({ running: false, paused: false, frames: [] })
  }
}
