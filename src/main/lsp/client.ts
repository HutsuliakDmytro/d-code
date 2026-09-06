import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { warn } from '../log'
import { needsShell } from '../system/platform'

/**
 * Language Server Protocol client.
 *
 * LSP rides on JSON-RPC with `Content-Length` headers, so the stream cannot be
 * read line by line: one message easily arrives in several chunks, and several
 * small ones arrive as a single chunk. Hence a buffer, cut at exactly the number
 * of bytes the header declares.
 */
export class LspClient extends EventEmitter {
  private child?: ChildProcess
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >()

  /** Ready once `initialize` has been answered. */
  ready = false

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly rootUri: string,
    /** Server-specific settings: the tsserver path and similar. */
    private readonly initializationOptions?: Record<string, unknown>
  ) {
    super()
  }

  async start(): Promise<void> {
    if (this.child) return

    this.child = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: needsShell(this.command)
    })
    this.child.stdout?.on('data', (chunk: Buffer) => this.onData(chunk))
    this.child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      // Language servers like to write noise to stderr — that is not fatal.
      if (text) this.emit('stderr', text)
    })
    this.child.on('exit', (code) => {
      this.ready = false
      this.child = undefined
      this.rejectAll(new Error(`language server exited with code ${code}`))
      this.emit('exit', code)
    })

    await this.request('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      initializationOptions: this.initializationOptions,
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          completion: {
            completionItem: { snippetSupport: false, documentationFormat: ['plaintext'] }
          },
          hover: { contentFormat: ['plaintext', 'markdown'] },
          definition: { linkSupport: false },
          references: {},
          rename: { prepareSupport: true }
        },
        workspace: { workspaceEdit: { documentChanges: true } }
      }
    })

    this.notify('initialized', {})
    this.ready = true
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    // A single read can carry several messages back to back.
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return

      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /content-length:\s*(\d+)/i.exec(header)
      if (!match) {
        // A header with no length means the stream is out of sync; reading on is futile.
        warn('[lsp] message without Content-Length')
        this.buffer = Buffer.alloc(0)
        return
      }

      const length = Number(match[1])
      const start = headerEnd + 4
      if (this.buffer.length < start + length) return // body not fully received yet

      const body = this.buffer.subarray(start, start + length).toString('utf8')
      this.buffer = this.buffer.subarray(start + length)

      try {
        this.handleMessage(JSON.parse(body) as Record<string, unknown>)
      } catch {
        warn('[lsp] unparseable message')
      }
    }
  }

  private handleMessage(message: Record<string, unknown>): void {
    const id = message.id as number | undefined

    if (id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(id)
      if (!entry) return
      this.pending.delete(id)
      clearTimeout(entry.timer)

      const error = message.error as { message?: string } | undefined
      if (error) entry.reject(new Error(error.message ?? 'language server error'))
      else entry.resolve(message.result)
      return
    }

    // The server pushes diagnostics and other notifications on its own.
    if (typeof message.method === 'string') {
      this.emit('notification', message.method, message.params)
    }
  }

  private send(payload: Record<string, unknown>): void {
    const stdin = this.child?.stdin
    if (!stdin?.writable) return
    const body = Buffer.from(JSON.stringify(payload), 'utf8')
    stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    stdin.write(body)
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 15_000): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method}: the server did not answer`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params })
  }

  private rejectAll(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  async stop(): Promise<void> {
    if (!this.child) return
    const child = this.child
    this.child = undefined
    this.ready = false

    try {
      // Polite shutdown: the server needs a moment to flush caches to disk.
      this.send({ jsonrpc: '2.0', id: this.nextId++, method: 'shutdown', params: null })
      this.send({ jsonrpc: '2.0', method: 'exit', params: null })
    } catch {
      // The process may already be gone.
    }

    this.rejectAll(new Error('language server stopped'))
    setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM')
    }, 2000).unref()
  }
}
