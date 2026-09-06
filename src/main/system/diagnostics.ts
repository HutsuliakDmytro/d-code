import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { access, constants } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { childEnv } from '../claude/resolve-cli'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  path: string
  relativePath: string
  line: number
  column: number
  severity: DiagnosticSeverity
  code?: string
  message: string
  source: 'typescript' | 'eslint'
}

export interface DiagnosticsState {
  running: boolean
  source?: 'typescript' | 'eslint'
  diagnostics: Diagnostic[]
  finishedAt?: number
  error?: string
}

async function binExists(root: string, name: string): Promise<string | undefined> {
  const local = join(root, 'node_modules/.bin', name)
  try {
    await access(local, constants.X_OK)
    return local
  } catch {
    return undefined
  }
}

/**
 * Parses `tsc` output.
 *
 * The format has been stable for years: `path(line,col): error TS1234: text`. The
 * path can be relative to the root or absolute; both are normalised.
 */
export function parseTscOutput(output: string, root: string): Diagnostic[] {
  const result: Diagnostic[] = []
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/

  for (const line of output.split('\n')) {
    const match = pattern.exec(line.trim())
    if (!match) continue

    const [, rawPath, lineNo, column, severity, code, message] = match
    const absolute = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath)
    result.push({
      path: absolute,
      relativePath: absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : rawPath,
      line: Number(lineNo),
      column: Number(column),
      severity: severity === 'warning' ? 'warning' : 'error',
      code,
      message: message.trim(),
      source: 'typescript'
    })
  }
  return result
}

/** Parses eslint's compact output (`--format unix`). */
export function parseEslintOutput(output: string, root: string): Diagnostic[] {
  const result: Diagnostic[] = []
  // `path:line:col: message [Error/rule-name]`
  const pattern = /^(.+?):(\d+):(\d+):\s+(.+?)\s+\[(Error|Warning)\/(.+?)\]$/

  for (const line of output.split('\n')) {
    const match = pattern.exec(line.trim())
    if (!match) continue

    const [, rawPath, lineNo, column, message, level, rule] = match
    const absolute = isAbsolute(rawPath) ? rawPath : resolve(root, rawPath)
    result.push({
      path: absolute,
      relativePath: absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : rawPath,
      line: Number(lineNo),
      column: Number(column),
      severity: level === 'Warning' ? 'warning' : 'error',
      code: rule,
      message,
      source: 'eslint'
    })
  }
  return result
}

const MAX_OUTPUT = 4 * 1024 * 1024

/**
 * Type and lint checking for the project.
 *
 * Runs on demand rather than on every keystroke: `tsc` takes seconds on a large
 * project, and doing that while typing would be wasted effort.
 */
export class DiagnosticsRunner extends EventEmitter {
  private state: DiagnosticsState = { running: false, diagnostics: [] }
  private child?: ReturnType<typeof spawn>

  getState(): DiagnosticsState {
    return this.state
  }

  private setState(patch: Partial<DiagnosticsState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  async run(root: string, source: 'typescript' | 'eslint' = 'typescript'): Promise<DiagnosticsState> {
    this.stop()

    const bin = await binExists(root, source === 'typescript' ? 'tsc' : 'eslint')
    if (!bin) {
      const name = source === 'typescript' ? 'TypeScript' : 'ESLint'
      this.setState({
        running: false,
        source,
        diagnostics: [],
        error: `The project has no ${name}`,
        finishedAt: Date.now()
      })
      return this.state
    }

    const args =
      source === 'typescript'
        ? ['--noEmit', '--pretty', 'false']
        : ['.', '--format', 'unix', '--ext', '.ts,.tsx,.js,.jsx']

    this.setState({ running: true, source, diagnostics: [], error: undefined })

    // Full PATH: project tools invoke node themselves and fail without it.
    const env = await childEnv()

    return new Promise((resolveRun) => {
      const child = spawn(bin, args, { cwd: root, env })
      this.child = child

      let output = ''
      const append = (data: Buffer): void => {
        if (output.length < MAX_OUTPUT) output += data.toString()
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)

      child.on('error', (err) => {
        this.setState({ running: false, error: err.message, finishedAt: Date.now() })
        resolveRun(this.state)
      })

      child.on('close', () => {
        this.child = undefined
        // A non-zero exit code is expected: it means problems were found.
        const diagnostics =
          source === 'typescript' ? parseTscOutput(output, root) : parseEslintOutput(output, root)
        this.setState({ running: false, diagnostics, finishedAt: Date.now() })
        resolveRun(this.state)
      })
    })
  }

  stop(): void {
    if (!this.child) return
    this.child.kill('SIGTERM')
    this.child = undefined
    this.setState({ running: false })
  }
}
