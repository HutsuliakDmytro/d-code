import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type * as PtyModule from 'node-pty'
import { warn } from '../log'
import { childEnv } from '../claude/resolve-cli'
import { IS_WIN, defaultTerminalShell } from './platform'

/** How much output to keep per session, so a tab can be restored after switching. */
const SCROLLBACK_LIMIT = 200_000

export interface TerminalInfo {
  id: string
  title: string
  cwd: string
  cols: number
  rows: number
  running: boolean
  exitCode?: number
}

export interface TerminalChunk {
  id: string
  data: string
}

/**
 * Real terminals over a pseudo-terminal.
 *
 * Unlike running scripts, this genuinely needs a pty: without one, interactive
 * programs see no TTY, print no colour and ignore window size. The price is the
 * native `node-pty` module, which has to be rebuilt against Electron's ABI.
 */
export class TerminalManager extends EventEmitter {
  private pty?: typeof PtyModule
  private sessions = new Map<
    string,
    { proc: PtyModule.IPty; info: TerminalInfo; buffer: string }
  >()

  /** Why terminals are unavailable; empty means all is well. */
  loadError?: string

  constructor() {
    super()
    try {
      // Dynamic require: if the native module is not built for the current ABI,
      // the app should keep working without terminals rather than die at startup.
      this.pty = require('node-pty') as typeof PtyModule
    } catch (err) {
      this.loadError = (err as Error).message
      warn('[terminal] node-pty unavailable:', this.loadError)
    }
  }

  get available(): boolean {
    return Boolean(this.pty)
  }

  async create(opts: {
    cwd?: string
    cols?: number
    rows?: number
    shell?: string
  }): Promise<TerminalInfo> {
    if (!this.pty) throw new Error(this.loadError ?? 'node-pty is unavailable')

    const id = randomUUID()
    const cwd = opts.cwd ?? homedir()
    const cols = opts.cols ?? 80
    const rows = opts.rows ?? 24
    const shell = opts.shell ?? defaultTerminalShell()
    // cmd.exe has no "login shell" flag — it simply is not needed there.
    const shellArguments = IS_WIN ? [] : ['-l']

    const proc = this.pty.spawn(shell, shellArguments, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: (await childEnv({
        TERM: 'xterm-256color',
        // Without this some tools disable colour, assuming the output is not a TTY.
        COLORTERM: 'truecolor'
      })) as Record<string, string>
    })

    const info: TerminalInfo = {
      id,
      title: cwd.split('/').at(-1) ?? 'terminal',
      cwd,
      cols,
      rows,
      running: true
    }
    this.sessions.set(id, { proc, info, buffer: '' })

    proc.onData((data) => {
      const session = this.sessions.get(id)
      if (session) {
        const combined = session.buffer + data
        session.buffer =
          combined.length > SCROLLBACK_LIMIT ? combined.slice(-SCROLLBACK_LIMIT) : combined
      }
      this.emit('data', { id, data } satisfies TerminalChunk)
    })

    proc.onExit(({ exitCode }) => {
      const session = this.sessions.get(id)
      if (!session) return
      session.info.running = false
      session.info.exitCode = exitCode
      this.emit('exit', session.info)
    })

    this.emit('created', info)
    return info
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session?.info.running) return
    try {
      session.proc.resize(cols, rows)
      session.info.cols = cols
      session.info.rows = rows
    } catch {
      // The process may have exited between the check and the call.
    }
  }

  /** Buffered output, needed to restore the screen after a tab switch. */
  getBuffer(id: string): string {
    return this.sessions.get(id)?.buffer ?? ''
  }

  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((s) => s.info)
  }

  close(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    if (session.info.running) {
      try {
        session.proc.kill()
      } catch {
        // Already dead — nothing to do.
      }
    }
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
}
