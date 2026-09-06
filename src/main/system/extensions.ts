import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CLAUDE_HOME } from '../store/project-paths'
import { childEnv, resolveClaudePath } from '../claude/resolve-cli'

const execFileAsync = promisify(execFile)

export interface McpServer {
  name: string
  target: string
  connected: boolean
  status: string
}

/**
 * MCP servers with their connection state.
 *
 * `claude mcp list` health-checks every server itself, which makes the call slow,
 * but it is the only source showing real state rather than just configuration.
 */
export async function listMcpServers(): Promise<McpServer[]> {
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync(await resolveClaudePath(), ['mcp', 'list'], {
      timeout: 30_000,
      env: await childEnv()
    }))
  } catch (err) {
    const e = err as { stdout?: string }
    if (!e.stdout) return []
    stdout = e.stdout
  }

  const servers: McpServer[] = []
  for (const line of stdout.split('\n')) {
    // Format: "name: target - ✔ Connected". The name may contain spaces and dots.
    const match = /^(.+?):\s+(\S+)\s+-\s+(.+)$/.exec(line.trim())
    if (!match) continue
    const status = match[3].trim()
    servers.push({
      name: match[1].trim(),
      target: match[2],
      connected: /connected|✔/i.test(status),
      status: status.replace(/^[✔✘×]\s*/, '')
    })
  }
  return servers
}

export interface HookEntry {
  event: string
  matcher?: string
  command: string
  /** Where the rule came from: global settings or project settings. */
  scope: 'user' | 'project' | 'local'
}

interface RawSettings {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>
}

async function readSettings(path: string): Promise<RawSettings | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RawSettings
  } catch {
    return undefined
  }
}

/**
 * Hooks from all three settings levels.
 *
 * The CLI merges global, project and local rules; they are shown together with
 * their origin, since otherwise there is no telling which file to edit.
 */
export async function listHooks(projectRoot?: string): Promise<HookEntry[]> {
  const sources: Array<{ path: string; scope: HookEntry['scope'] }> = [
    { path: join(CLAUDE_HOME, 'settings.json'), scope: 'user' }
  ]
  if (projectRoot) {
    sources.push(
      { path: join(projectRoot, '.claude', 'settings.json'), scope: 'project' },
      { path: join(projectRoot, '.claude', 'settings.local.json'), scope: 'local' }
    )
  }

  const entries: HookEntry[] = []
  for (const source of sources) {
    const settings = await readSettings(source.path)
    for (const [event, rules] of Object.entries(settings?.hooks ?? {})) {
      for (const rule of rules ?? []) {
        for (const hook of rule.hooks ?? []) {
          if (!hook.command) continue
          entries.push({
            event,
            matcher: rule.matcher,
            command: hook.command,
            scope: source.scope
          })
        }
      }
    }
  }
  return entries
}

export interface PluginEntry {
  name: string
  source?: string
  skills: number
}

/** Plugins from local marketplaces. */
export async function listPlugins(): Promise<PluginEntry[]> {
  const marketplacesFile = join(CLAUDE_HOME, 'plugins', 'known_marketplaces.json')
  const raw = await readFile(marketplacesFile, 'utf8').catch(() => '')
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw) as Record<string, { source?: { source?: string } }>
    return Object.entries(parsed).map(([name, value]) => ({
      name,
      source: value?.source?.source,
      skills: 0
    }))
  } catch {
    return []
  }
}

export interface AgentType {
  name: string
  /** Description from the listing the CLI injects into the prompt. */
  description?: string
}

/**
 * Agent types available to the model.
 *
 * The list arrives in an `agent_listing_delta` attachment inside the transcript,
 * the same way the skill list does. This is what the model actually sees.
 */
export async function listAgentTypes(): Promise<AgentType[]> {
  const { readdir, stat } = await import('node:fs/promises')
  const { PROJECTS_DIR } = await import('../store/project-paths')

  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])
  let newest: { mtime: number; agents: AgentType[] } | undefined

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dirPath = join(PROJECTS_DIR, d.name)
    const files = await readdir(dirPath).catch(() => [] as string[])
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const filePath = join(dirPath, f)
      const mtime = await stat(filePath)
        .then((s) => s.mtimeMs)
        .catch(() => 0)
      if (newest && mtime <= newest.mtime) continue

      const agents = await readAgentListing(filePath)
      if (agents.length) newest = { mtime, agents }
    }
  }
  return newest?.agents ?? []
}

async function readAgentListing(file: string): Promise<AgentType[]> {
  const text = await readFile(file, 'utf8').catch(() => '')
  let result: AgentType[] = []

  for (const line of text.split('\n')) {
    if (!line.includes('agent_listing')) continue
    try {
      const obj = JSON.parse(line) as {
        attachment?: { type?: string; addedTypes?: string[]; addedLines?: string[] }
      }
      const att = obj.attachment
      if (!att?.addedTypes?.length) continue

      // `addedLines` is markdown "- name: description" in the same order as the types.
      const descriptions = new Map<string, string>()
      for (const row of att.addedLines ?? []) {
        const m = /^-\s+([A-Za-z0-9_-]+):\s*(.+)$/.exec(row.trim())
        if (m) descriptions.set(m[1], m[2].trim())
      }
      result = att.addedTypes.map((name) => ({ name, description: descriptions.get(name) }))
    } catch {
      continue
    }
  }
  return result
}
