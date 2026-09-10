import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CLAUDE_HOME } from '../store/project-paths'
import { childEnv, resolveClaudePath } from '../claude/resolve-cli'
import type { HookEntry } from './extensions'

const execFileAsync = promisify(execFile)

/**
 * Writing to the CLI's own configuration.
 *
 * Everything here touches files the user also edits by hand and the CLI reads
 * on every run, so the rules are strict: read-modify-write of the parsed object
 * (never a blind overwrite), one backup before the first change, and an atomic
 * rename so a crash mid-write cannot leave the CLI with a truncated
 * `settings.json`.
 */

export type SettingsScope = 'user' | 'project' | 'local'

export interface ScopeInfo {
  scope: SettingsScope
  path: string
  exists: boolean
  /** Set when the file is present but not valid JSON — editing must not proceed. */
  error?: string
}

/** Where each scope's settings file lives. */
export function settingsPath(scope: SettingsScope, projectRoot?: string): string {
  if (scope === 'user') return join(CLAUDE_HOME, 'settings.json')
  if (!projectRoot) throw new Error(`Scope "${scope}" needs a project directory`)
  return join(projectRoot, '.claude', scope === 'local' ? 'settings.local.json' : 'settings.json')
}

type Settings = Record<string, unknown>

interface HookRule {
  matcher?: string
  hooks?: Array<{ type?: string; command?: string }>
}

async function readSettings(path: string): Promise<{ data: Settings; error?: string }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    // A missing file is the normal case — most projects have no settings at all.
    return { data: {} }
  }
  if (!raw.trim()) return { data: {} }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: {}, error: 'settings.json must contain a JSON object' }
    }
    return { data: parsed as Settings }
  } catch (err) {
    return { data: {}, error: (err as Error).message }
  }
}

/**
 * Writes settings atomically, keeping one backup of the previous content.
 *
 * The backup is `.bak` next to the file rather than a timestamped history: the
 * value is recovering from *this* edit, and a directory slowly filling with
 * copies of a config file is its own kind of damage.
 */
async function writeSettings(path: string, data: Settings): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await copyFile(path, `${path}.bak`).catch(() => {
    // Nothing to back up on the first write.
  })

  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

/** State of all three settings files, so the UI can say where a change will land. */
export async function settingsScopes(projectRoot?: string): Promise<ScopeInfo[]> {
  const scopes: SettingsScope[] = projectRoot ? ['user', 'project', 'local'] : ['user']
  return Promise.all(
    scopes.map(async (scope) => {
      const path = settingsPath(scope, projectRoot)
      const raw = await readFile(path, 'utf8').catch(() => undefined)
      if (raw === undefined) return { scope, path, exists: false }
      const { error } = await readSettings(path)
      return { scope, path, exists: true, error }
    })
  )
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export interface HookInput {
  event: string
  matcher?: string
  command: string
}

/** Events the CLI recognises. An unknown event silently never fires. */
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact'
] as const

export interface EditResult {
  ok: boolean
  error?: string
  path?: string
}

function hookRules(data: Settings, event: string): HookRule[] {
  const hooks = (data.hooks ?? {}) as Record<string, HookRule[]>
  return Array.isArray(hooks[event]) ? hooks[event] : []
}

/**
 * Adds a hook to one settings file.
 *
 * A rule already matching the same event and matcher gains another command
 * rather than being replaced — the CLI runs every command in a rule, and
 * silently dropping someone's existing hook would be the worst possible
 * outcome of an "add" button.
 */
export async function addHook(
  scope: SettingsScope,
  input: HookInput,
  projectRoot?: string
): Promise<EditResult> {
  if (!input.command.trim()) return { ok: false, error: 'Command is empty' }
  if (!input.event.trim()) return { ok: false, error: 'Event is empty' }

  const path = settingsPath(scope, projectRoot)
  const { data, error } = await readSettings(path)
  if (error) return { ok: false, error: `${path}: ${error}` }

  const hooks = (data.hooks ?? {}) as Record<string, HookRule[]>
  const rules = hookRules(data, input.event)
  const matcher = input.matcher?.trim() || undefined
  const existing = rules.find((r) => (r.matcher ?? undefined) === matcher)

  if (existing) {
    const commands = existing.hooks ?? []
    if (commands.some((h) => h.command === input.command)) {
      return { ok: false, error: 'This hook is already configured' }
    }
    existing.hooks = [...commands, { type: 'command', command: input.command }]
  } else {
    rules.push({
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: input.command }]
    })
  }

  hooks[input.event] = rules
  data.hooks = hooks
  await writeSettings(path, data)
  return { ok: true, path }
}

/**
 * Removes one hook command, and prunes the rule and the event once they are
 * empty — a settings file left full of `{"PreToolUse": [{"hooks": []}]}` is
 * confusing to read and to hand-edit later.
 */
export async function removeHook(
  scope: SettingsScope,
  input: HookInput,
  projectRoot?: string
): Promise<EditResult> {
  const path = settingsPath(scope, projectRoot)
  const { data, error } = await readSettings(path)
  if (error) return { ok: false, error: `${path}: ${error}` }

  const hooks = (data.hooks ?? {}) as Record<string, HookRule[]>
  const matcher = input.matcher?.trim() || undefined
  const rules = hookRules(data, input.event)

  let removed = false
  for (const rule of rules) {
    if ((rule.matcher ?? undefined) !== matcher) continue
    const before = rule.hooks?.length ?? 0
    rule.hooks = (rule.hooks ?? []).filter((h) => h.command !== input.command)
    if ((rule.hooks?.length ?? 0) !== before) removed = true
  }
  if (!removed) return { ok: false, error: 'Hook not found in this file' }

  const kept = rules.filter((r) => (r.hooks?.length ?? 0) > 0)
  if (kept.length > 0) hooks[input.event] = kept
  else delete hooks[input.event]

  if (Object.keys(hooks).length > 0) data.hooks = hooks
  else delete data.hooks

  await writeSettings(path, data)
  return { ok: true, path }
}

/** Convenience for the UI, which holds a `HookEntry` rather than a `HookInput`. */
export function hookInputOf(entry: HookEntry): HookInput {
  return { event: entry.event, matcher: entry.matcher, command: entry.command }
}

// ─── MCP servers ─────────────────────────────────────────────────────────────

export interface McpServerInput {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  /** For stdio: the command and its arguments. For sse/http: the URL. */
  target: string
  scope: SettingsScope
  /** Extra environment for a stdio server, `KEY=value` per entry. */
  env?: string[]
}

/**
 * Splits a stdio command line into argv.
 *
 * Deliberately small: it understands quotes, because MCP commands routinely
 * contain paths with spaces, and nothing else. Anything needing real shell
 * syntax belongs in a wrapper script, not in a text field.
 */
export function splitCommand(line: string): string[] {
  const parts: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3])
  }
  return parts
}

/** Builds the `claude mcp add` argument list for a server definition. */
export function mcpAddArgs(input: McpServerInput): string[] {
  const args = ['mcp', 'add', '--scope', input.scope === 'user' ? 'user' : input.scope]
  if (input.transport !== 'stdio') args.push('--transport', input.transport)
  for (const pair of input.env ?? []) {
    if (pair.includes('=')) args.push('--env', pair)
  }
  args.push(input.name)

  if (input.transport === 'stdio') {
    // `--` keeps the server's own flags from being read as flags of `claude`.
    args.push('--', ...splitCommand(input.target))
  } else {
    args.push(input.target)
  }
  return args
}

async function runClaude(args: string[]): Promise<EditResult> {
  try {
    await execFileAsync(await resolveClaudePath(), args, {
      timeout: 30_000,
      env: await childEnv()
    })
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string }
    const text = (e.stderr || e.stdout || e.message || '').trim()
    return { ok: false, error: text.split('\n').slice(0, 3).join(' ') || 'command failed' }
  }
}

/**
 * Registers an MCP server through the CLI rather than by editing `.mcp.json`.
 *
 * The CLI owns three different config files depending on scope and normalises
 * the entry as it writes; reimplementing that here would drift the moment the
 * format changes.
 */
export async function addMcpServer(input: McpServerInput): Promise<EditResult> {
  if (!input.name.trim()) return { ok: false, error: 'Name is empty' }
  if (!input.target.trim()) return { ok: false, error: 'Command or URL is empty' }
  return runClaude(mcpAddArgs(input))
}

/**
 * Removes an MCP server.
 *
 * `claude mcp list` does not say which scope a server was defined in, and
 * `mcp remove` refuses when the scope is wrong. With no scope given the three
 * are tried in the CLI's own precedence order — a removal that "did nothing"
 * because the guess was wrong is worse than three cheap attempts.
 */
export async function removeMcpServer(
  name: string,
  scope?: SettingsScope
): Promise<EditResult> {
  if (!name.trim()) return { ok: false, error: 'Name is empty' }
  if (scope) return runClaude(['mcp', 'remove', '--scope', scope, name])

  let last: EditResult = { ok: false, error: 'not found in any scope' }
  for (const candidate of ['local', 'project', 'user'] as const) {
    const result = await runClaude(['mcp', 'remove', '--scope', candidate, name])
    if (result.ok) return result
    last = result
  }
  return last
}
