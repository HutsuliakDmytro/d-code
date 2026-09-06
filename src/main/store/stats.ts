import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { PROJECTS_DIR } from './project-paths'

export interface DayBucket {
  /** YYYY-MM-DD in local time. */
  date: string
  outputTokens: number
  requests: number
  sessions: number
}

export interface ToolUsage {
  name: string
  count: number
  errors: number
}

export interface ProjectUsage {
  projectPath: string
  outputTokens: number
  requests: number
  sessions: number
}

export interface ActivityStats {
  days: DayBucket[]
  tools: ToolUsage[]
  projects: ProjectUsage[]
  /** Tokens read from cache versus written — the savings indicator. */
  cacheReadTokens: number
  cacheCreationTokens: number
}

const SYNTHETIC_MODEL = '<synthetic>'

function localDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // toISOString would use UTC and push late-evening activity into the next day.
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Aggregates for the activity panel: by day, by tool and by project.
 *
 * Computed in one pass over every transcript, subagent branches included — their
 * tool calls and tokens are part of the work too.
 */
export async function collectActivity(days = 30): Promise<ActivityStats> {
  const dayMap = new Map<string, DayBucket>()
  const toolMap = new Map<string, ToolUsage>()
  const projectMap = new Map<string, ProjectUsage>()
  const daySessions = new Map<string, Set<string>>()

  let cacheReadTokens = 0
  let cacheCreationTokens = 0

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dirPath = join(PROJECTS_DIR, d.name)
    for (const file of await collectJsonlFiles(dirPath)) {
      await scanForStats(file, cutoff, {
        dayMap,
        toolMap,
        projectMap,
        daySessions,
        addCache: (read, created) => {
          cacheReadTokens += read
          cacheCreationTokens += created
        }
      })
    }
  }

  for (const [date, sessions] of daySessions) {
    const bucket = dayMap.get(date)
    if (bucket) bucket.sessions = sessions.size
  }

  return {
    days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    tools: [...toolMap.values()].sort((a, b) => b.count - a.count),
    projects: [...projectMap.values()].sort((a, b) => b.outputTokens - a.outputTokens),
    cacheReadTokens,
    cacheCreationTokens
  }
}

/** Main transcripts together with their subagent branches. */
async function collectJsonlFiles(dirPath: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(join(dirPath, e.name))
      continue
    }
    if (!e.isDirectory()) continue
    const subDir = join(dirPath, e.name, 'subagents')
    const subs = await readdir(subDir).catch(() => [] as string[])
    for (const s of subs) {
      if (s.endsWith('.jsonl')) out.push(join(subDir, s))
    }
  }
  return out
}

interface Accumulators {
  dayMap: Map<string, DayBucket>
  toolMap: Map<string, ToolUsage>
  projectMap: Map<string, ProjectUsage>
  daySessions: Map<string, Set<string>>
  addCache: (read: number, created: number) => void
}

async function scanForStats(filePath: string, cutoff: number, acc: Accumulators): Promise<void> {
  const sessionId = basename(filePath, '.jsonl')
  const seenRequests = new Set<string>()
  /** tool_use_id → name, so an error is attributed to the right tool. */
  const toolNames = new Map<string, string>()
  let projectPath = ''

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  for await (const raw of rl) {
    if (!raw.trim()) continue
    let line: Record<string, unknown>
    try {
      line = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    if (!projectPath && typeof line.cwd === 'string') projectPath = line.cwd

    const ts = typeof line.timestamp === 'string' ? line.timestamp : ''
    if (!ts) continue
    const time = Date.parse(ts)
    if (!Number.isFinite(time) || time < cutoff) continue

    if (line.type === 'assistant') {
      const message = line.message as Record<string, unknown> | undefined
      if (!message) continue
      const model = typeof message.model === 'string' ? message.model : ''
      const key = (line.requestId as string) ?? (message.id as string)

      for (const block of (message.content as unknown[]) ?? []) {
        if (typeof block !== 'object' || block === null) continue
        const b = block as Record<string, unknown>
        if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
        const tool = acc.toolMap.get(b.name) ?? { name: b.name, count: 0, errors: 0 }
        tool.count++
        acc.toolMap.set(b.name, tool)
        if (typeof b.id === 'string') toolNames.set(b.id, b.name)
      }

      // Dedup by requestId — otherwise multi-block replies are counted twice.
      if (model === SYNTHETIC_MODEL || !key || seenRequests.has(key)) continue
      seenRequests.add(key)

      const usage = (message.usage ?? {}) as Record<string, number>
      const output = usage.output_tokens ?? 0
      const date = localDate(ts)

      const bucket = acc.dayMap.get(date) ?? { date, outputTokens: 0, requests: 0, sessions: 0 }
      bucket.outputTokens += output
      bucket.requests++
      acc.dayMap.set(date, bucket)

      const sessions = acc.daySessions.get(date) ?? new Set<string>()
      sessions.add(sessionId)
      acc.daySessions.set(date, sessions)

      acc.addCache(usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0)

      if (projectPath) {
        const proj = acc.projectMap.get(projectPath) ?? {
          projectPath,
          outputTokens: 0,
          requests: 0,
          sessions: 0
        }
        proj.outputTokens += output
        proj.requests++
        acc.projectMap.set(projectPath, proj)
      }
      continue
    }

    if (line.type === 'user') {
      const message = line.message as Record<string, unknown> | undefined
      for (const block of (message?.content as unknown[]) ?? []) {
        if (typeof block !== 'object' || block === null) continue
        const b = block as Record<string, unknown>
        if (b.type !== 'tool_result' || b.is_error !== true) continue
        const name = toolNames.get(String(b.tool_use_id ?? ''))
        if (!name) continue
        const tool = acc.toolMap.get(name)
        if (tool) tool.errors++
      }
    }
  }
}
