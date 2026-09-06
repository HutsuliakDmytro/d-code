import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { childEnv } from '../claude/resolve-cli'
import { loginShell, shellArgs } from './platform'

export interface ScriptEntry {
  name: string
  command: string
  /** Category driving the icon and list order. */
  kind: 'test' | 'build' | 'dev' | 'lint' | 'other'
}

function classify(name: string): ScriptEntry['kind'] {
  if (/^(test|tests?:|vitest|jest|spec)/.test(name)) return 'test'
  if (/^(build|compile|bundle|dist)/.test(name)) return 'build'
  if (/^(dev|start|serve|watch|preview)/.test(name)) return 'dev'
  if (/^(lint|format|typecheck|tsc|check)/.test(name)) return 'lint'
  return 'other'
}

const ORDER: Record<ScriptEntry['kind'], number> = { test: 0, lint: 1, build: 2, dev: 3, other: 4 }

/** Scripts from the project's package.json. */
export async function listScripts(root: string): Promise<ScriptEntry[]> {
  try {
    const raw = await readFile(join(root, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
    return Object.entries(pkg.scripts ?? {})
      .map(([name, command]) => ({ name, command, kind: classify(name) }))
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export interface TaskSummary {
  passed?: number
  failed?: number
  skipped?: number
  /** Number of TypeScript or linter errors. */
  problems?: number
}

export interface TaskState {
  id: string
  script: string
  root: string
  running: boolean
  exitCode?: number | null
  startedAt: number
  finishedAt?: number
  summary?: TaskSummary
}

/**
 * Extracts a summary from the output.
 *
 * Tool output formats are mutually incompatible, so only the common ones are
 * parsed and the result is treated as a hint: raw output stays the primary source.
 */
export function parseSummary(output: string): TaskSummary | undefined {
  const summary: TaskSummary = {}

  // vitest / jest: «Tests  81 passed | 9 skipped (90)»
  const vitest = /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?/i.exec(
    output
  )
  if (vitest) {
    if (vitest[1]) summary.failed = Number(vitest[1])
    summary.passed = Number(vitest[2])
    if (vitest[3]) summary.skipped = Number(vitest[3])
  }

  // tsc: "Found 3 errors", plus individual "error TS1234:" lines
  const tsc = /Found (\d+) errors?/i.exec(output)
  if (tsc) summary.problems = Number(tsc[1])
  else {
    const errorLines = output.match(/error TS\d+:/g)
    if (errorLines) summary.problems = errorLines.length
  }

  return Object.keys(summary).length > 0 ? summary : undefined
}

export interface TaskChunk {
  id: string
  /** Stream the text came from: errors deserve their own colour. */
  stream: 'stdout' | 'stderr'
  text: string
}

/** How much output to keep in memory per task. */
const MAX_OUTPUT = 400_000

/**
 * Runs project scripts.
 *
 * This is not a terminal: processes start without a pty, over plain pipes. That is
 * enough for `npm run`, and it drags no native module into the dependencies.
 */
export class TaskRunner extends EventEmitter {
  private tasks = new Map<string, { state: TaskState; child: ChildProcess }>()
  private output = new Map<string, string>()

  async start(root: string, script: string): Promise<TaskState> {
    const id = randomUUID()
    const state: TaskState = { id, script, root, running: true, startedAt: Date.now() }

    // Login shell: a GUI app inherits a trimmed PATH that may not contain node.
    const child = spawn(loginShell(), shellArgs(`npm run ${script}`), {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: await childEnv({ FORCE_COLOR: '0', CI: '1' })
    })

    this.tasks.set(id, { state, child })
    this.output.set(id, '')

    const append = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = data.toString()
      const previous = this.output.get(id) ?? ''
      // Keep only the tail: long builds would otherwise eat memory.
      const combined = previous + text
      this.output.set(id, combined.length > MAX_OUTPUT ? combined.slice(-MAX_OUTPUT) : combined)
      this.emit('chunk', { id, stream, text } satisfies TaskChunk)
    }

    child.stdout?.on('data', append('stdout'))
    child.stderr?.on('data', append('stderr'))

    child.on('error', (err) => {
      this.emit('chunk', { id, stream: 'stderr', text: `${err.message}\n` } satisfies TaskChunk)
    })

    child.on('exit', (code) => {
      state.running = false
      state.exitCode = code
      state.finishedAt = Date.now()
      state.summary = parseSummary(this.output.get(id) ?? '')
      this.emit('state', state)
    })

    this.emit('state', state)
    return state
  }

  stop(id: string): void {
    const task = this.tasks.get(id)
    if (!task?.state.running) return
    // Gently first: npm run spawns children that also need a chance to exit.
    task.child.kill('SIGTERM')
    setTimeout(() => {
      if (task.state.running) task.child.kill('SIGKILL')
    }, 3000).unref()
  }

  getOutput(id: string): string {
    return this.output.get(id) ?? ''
  }

  list(): TaskState[] {
    return [...this.tasks.values()].map((t) => t.state).sort((a, b) => b.startedAt - a.startedAt)
  }

  /** Drops a finished task together with its output. */
  forget(id: string): void {
    const task = this.tasks.get(id)
    if (task?.state.running) return
    this.tasks.delete(id)
    this.output.delete(id)
  }

  stopAll(): void {
    for (const [id] of this.tasks) this.stop(id)
  }
}
