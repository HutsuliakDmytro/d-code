import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  LiveSession,
  ModelUsage,
  PermissionMode,
  SessionMeta,
  SessionPullRequest,
  UsageTotals
} from '@shared/types'
import { PROJECTS_DIR, SESSIONS_DIR, buildDirToPathMap } from './project-paths'

const SYNTHETIC_MODEL = '<synthetic>'

export interface SessionIndexEntry {
  meta: SessionMeta
  usage: UsageTotals
  /** Subagent transcripts of this session; their tokens are not in the main file. */
  subagents: SubagentRef[]
}

export interface SubagentRef {
  agentId: string
  filePath: string
  agentType?: string
  description?: string
  toolUseId?: string
  spawnDepth?: number
  usage: UsageTotals
}

export function emptyTotals(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    thinkingTokens: 0,
    requests: 0,
    byModel: {}
  }
}

function addToTotals(totals: UsageTotals, model: string, usage: Record<string, unknown>): void {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const input = num(usage.input_tokens)
  const output = num(usage.output_tokens)
  const cacheCreation = num(usage.cache_creation_input_tokens)
  const cacheRead = num(usage.cache_read_input_tokens)
  const details = usage.output_tokens_details
  const thinking =
    typeof details === 'object' && details !== null
      ? num((details as Record<string, unknown>).thinking_tokens)
      : 0

  totals.inputTokens += input
  totals.outputTokens += output
  totals.cacheCreationTokens += cacheCreation
  totals.cacheReadTokens += cacheRead
  totals.thinkingTokens += thinking
  totals.requests += 1

  const per: ModelUsage = (totals.byModel[model] ??= {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    requests: 0
  })
  per.inputTokens += input
  per.outputTokens += output
  per.cacheCreationTokens += cacheCreation
  per.cacheReadTokens += cacheRead
  per.requests += 1
}

/** Adds b's totals into a (for "main session + subagents"). */
export function mergeTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  a.inputTokens += b.inputTokens
  a.outputTokens += b.outputTokens
  a.cacheCreationTokens += b.cacheCreationTokens
  a.cacheReadTokens += b.cacheReadTokens
  a.thinkingTokens += b.thinkingTokens
  a.requests += b.requests
  if (b.costUSD !== undefined) a.costUSD = (a.costUSD ?? 0) + b.costUSD
  for (const [model, u] of Object.entries(b.byModel)) {
    const per: ModelUsage = (a.byModel[model] ??= {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      requests: 0
    })
    per.inputTokens += u.inputTokens
    per.outputTokens += u.outputTokens
    per.cacheCreationTokens += u.cacheCreationTokens
    per.cacheReadTokens += u.cacheReadTokens
    per.requests += u.requests
    if (u.costUSD !== undefined) per.costUSD = (per.costUSD ?? 0) + u.costUSD
  }
  return a
}

/**
 * Light single-pass transcript scan: metadata for the session list plus token
 * totals. No messages are built — `parseTranscript` handles the chat feed.
 */
export async function scanTranscript(
  filePath: string,
  opts: { projectPath: string; encodedDir: string }
): Promise<{ meta: SessionMeta; usage: UsageTotals }> {
  const usage = emptyTotals()
  /** One API reply is written as several lines sharing a requestId. */
  const seenRequests = new Set<string>()

  let agentName: string | undefined
  let bridgeSessionId: string | undefined
  let aiTitle: string | undefined
  let lastPrompt: string | undefined
  let leafUuid: string | undefined
  let permissionMode: PermissionMode | undefined
  let firstUserText: string | undefined
  let createdAt: string | undefined
  let updatedAt: string | undefined
  let gitBranch: string | undefined
  let version: string | undefined
  const pullRequests = new Map<number, SessionPullRequest>()
  let cwd: string | undefined
  let messageCount = 0

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
      continue // truncated tail, if the CLI is writing right now
    }

    switch (line.type) {
      case 'agent-name':
        agentName = line.agentName as string
        continue
      case 'bridge-session':
        bridgeSessionId = line.bridgeSessionId as string
        continue
      case 'ai-title':
        aiTitle = line.aiTitle as string
        continue
      case 'last-prompt':
        lastPrompt = line.lastPrompt as string
        leafUuid = line.leafUuid as string
        continue
      case 'permission-mode':
        permissionMode = line.permissionMode as PermissionMode
        continue
      case 'pr-link': {
        // The same PR is mentioned every time the session returns to it, so
        // entries are keyed by number rather than collected as a list.
        const number = line.prNumber as number | undefined
        const url = line.prUrl as string | undefined
        if (typeof number === 'number' && url) {
          pullRequests.set(number, {
            number,
            url,
            repository: (line.prRepository as string) ?? '',
            createdAt: pullRequests.get(number)?.createdAt ?? (line.timestamp as string | undefined)
          })
        }
        continue
      }
    }

    const ts = line.timestamp
    if (typeof ts === 'string') {
      createdAt ??= ts
      updatedAt = ts
    }
    if (typeof line.gitBranch === 'string') gitBranch = line.gitBranch
    if (typeof line.version === 'string') version = line.version
    // The most reliable source of the project path: the directory name cannot be decoded.
    if (typeof line.cwd === 'string') cwd ??= line.cwd

    if (line.type === 'assistant') {
      const message = line.message as Record<string, unknown> | undefined
      if (!message) continue
      messageCount++
      const model = typeof message.model === 'string' ? message.model : 'unknown'
      const key = (line.requestId as string) ?? (message.id as string)
      // Synthetic lines are API errors with zero usage, not real calls.
      if (model !== SYNTHETIC_MODEL && key && !seenRequests.has(key)) {
        seenRequests.add(key)
        const u = message.usage
        if (typeof u === 'object' && u !== null) {
          addToTotals(usage, model, u as Record<string, unknown>)
        }
      }
      continue
    }

    if (line.type === 'user' && line.isMeta !== true) {
      const message = line.message as Record<string, unknown> | undefined
      const content = message?.content
      if (typeof content === 'string' && content.trim()) {
        firstUserText ??= content
        messageCount++
      }
    }
  }

  const clean = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 120)
  let title = 'Untitled'
  let titleSource: SessionMeta['titleSource'] = 'fallback'
  if (agentName?.trim()) {
    title = clean(agentName)
    titleSource = 'agent-name'
  } else if (aiTitle?.trim()) {
    title = clean(aiTitle)
    titleSource = 'ai-title'
  } else if (lastPrompt?.trim()) {
    title = clean(lastPrompt)
    titleSource = 'last-prompt'
  } else if (firstUserText?.trim()) {
    title = clean(firstUserText)
    titleSource = 'first-user'
  }

  return {
    meta: {
      sessionId: basename(filePath, '.jsonl'),
      projectPath: cwd ?? opts.projectPath,
      encodedDir: opts.encodedDir,
      filePath,
      title,
      titleSource,
      name: agentName,
      bridgeSessionId,
      lastPrompt,
      leafUuid,
      createdAt: createdAt ?? new Date(0).toISOString(),
      updatedAt: updatedAt ?? createdAt ?? new Date(0).toISOString(),
      messageCount,
      gitBranch,
      version,
      permissionMode,
      pullRequests: pullRequests.size > 0 ? [...pullRequests.values()] : undefined
    },
    usage
  }
}

/** Subagent transcripts sit beside the main one, under <session-id>/subagents/. */
async function scanSubagents(
  sessionDir: string,
  opts: { projectPath: string; encodedDir: string }
): Promise<SubagentRef[]> {
  const dir = join(sessionDir, 'subagents')
  const entries = await readdir(dir).catch(() => [] as string[])
  const refs: SubagentRef[] = []

  for (const f of entries) {
    if (!f.endsWith('.jsonl')) continue
    const filePath = join(dir, f)
    const agentId = basename(f, '.jsonl').replace(/^agent-/, '')
    const { usage } = await scanTranscript(filePath, opts)

    const meta = await readFile(join(dir, `agent-${agentId}.meta.json`), 'utf8')
      .then((t) => JSON.parse(t) as Record<string, unknown>)
      .catch(() => ({}) as Record<string, unknown>)

    refs.push({
      agentId,
      filePath,
      agentType: meta.agentType as string | undefined,
      description: meta.description as string | undefined,
      toolUseId: meta.toolUseId as string | undefined,
      spawnDepth: meta.spawnDepth as number | undefined,
      usage
    })
  }
  return refs
}

/** Full index of every session across every project. */
export async function scanAllSessions(): Promise<SessionIndexEntry[]> {
  const dirToPath = await buildDirToPathMap()
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])
  const live = await readLiveSessions()
  const liveById = new Map(live.map((l) => [l.sessionId, l]))

  const entries: SessionIndexEntry[] = []

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dirPath = join(PROJECTS_DIR, d.name)
    const files = await readdir(dirPath).catch(() => [] as string[])
    // The directory name is not reversible. The map only knows projects from
    // ~/.claude.json and history.jsonl, so for the rest scanTranscript supplies the
    // real path from the cwd field.
    const projectPath = dirToPath.get(d.name) ?? d.name
    const opts = { projectPath, encodedDir: d.name }

    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const filePath = join(dirPath, f)
      const { meta, usage } = await scanTranscript(filePath, opts)
      const subagents = await scanSubagents(join(dirPath, basename(f, '.jsonl')), opts)

      // A session's full cost is the main transcript plus all of its subagents.
      const total = mergeTotals(structuredClone(usage), emptyTotals())
      for (const s of subagents) mergeTotals(total, s.usage)

      meta.live = liveById.get(meta.sessionId)
      entries.push({ meta, usage: total, subagents })
    }
  }

  entries.sort((a, b) => b.meta.updatedAt.localeCompare(a.meta.updatedAt))
  return entries
}

/** Currently running CLI processes. The same registry `claude agents` shows. */
export async function readLiveSessions(): Promise<LiveSession[]> {
  const files = await readdir(SESSIONS_DIR).catch(() => [] as string[])
  const out: LiveSession[] = []

  for (const f of files) {
    if (!f.endsWith('.json')) continue
    const path = join(SESSIONS_DIR, f)
    try {
      const info = JSON.parse(await readFile(path, 'utf8')) as LiveSession
      // The registry is not cleaned immediately — drop entries for dead processes.
      if (!info.pid || !isProcessAlive(info.pid)) continue
      out.push(info)
    } catch {
      // The file may have been rewritten between readdir and readFile.
    }
  }
  return out
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** File mtime, used for incremental index updates. */
export async function fileMtime(path: string): Promise<number> {
  return stat(path)
    .then((s) => s.mtimeMs)
    .catch(() => 0)
}
