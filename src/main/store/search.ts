import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { PROJECTS_DIR } from './project-paths'

export interface SearchHit {
  sessionId: string
  filePath: string
  projectPath: string
  encodedDir: string
  /** Session title, so it need not be read again just for a name. */
  title: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  timestamp: string
  /** Snippet around the match. */
  snippet: string
  /** Match offset within the snippet, for highlighting. */
  matchStart: number
  matchLength: number
}

export interface SearchOptions {
  query: string
  /** Also search inside tool arguments and results. */
  includeTools?: boolean
  limit?: number
}

const SNIPPET_PADDING = 90

function makeSnippet(
  text: string,
  index: number,
  length: number
): { snippet: string; matchStart: number } {
  const start = Math.max(0, index - SNIPPET_PADDING)
  const end = Math.min(text.length, index + length + SNIPPET_PADDING)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return {
    snippet: prefix + text.slice(start, end).replace(/\s+/g, ' ') + suffix,
    // Collapsing whitespace can shift the offset, so it is recomputed on the snippet.
    matchStart: -1
  }
}

function extractText(content: unknown, includeTools: boolean): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
    else if (b.type === 'thinking' && typeof b.thinking === 'string') parts.push(b.thinking)
    else if (includeTools && b.type === 'tool_use') {
      parts.push(`${String(b.name ?? '')} ${JSON.stringify(b.input ?? {})}`)
    } else if (includeTools && b.type === 'tool_result') {
      parts.push(typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? ''))
    }
  }
  return parts.join('\n')
}

/**
 * Full-text search across every transcript.
 *
 * Runs line by line with no index: scanning 9 MB of history is cheaper than
 * keeping an index consistent while files are actively being written.
 */
export async function searchTranscripts(opts: SearchOptions): Promise<SearchHit[]> {
  const needle = opts.query.trim().toLowerCase()
  if (needle.length < 2) return []
  const limit = opts.limit ?? 200
  const includeTools = opts.includeTools ?? false

  const hits: SearchHit[] = []
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dirPath = join(PROJECTS_DIR, d.name)
    const files = await readdir(dirPath).catch(() => [] as string[])

    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      if (hits.length >= limit) return hits.slice(0, limit)
      await searchFile(join(dirPath, f), d.name, needle, includeTools, limit, hits)
    }
  }
  return hits.slice(0, limit)
}

async function searchFile(
  filePath: string,
  encodedDir: string,
  needle: string,
  includeTools: boolean,
  limit: number,
  hits: SearchHit[]
): Promise<void> {
  const sessionId = basename(filePath, '.jsonl')
  const found: SearchHit[] = []
  let title = ''
  let projectPath = ''

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  for await (const raw of rl) {
    if (!raw.trim()) continue

    // Title and path are needed for every hit, so they are always collected.
    if (raw.includes('"ai-title"') || raw.includes('"agent-name"') || !projectPath) {
      try {
        const meta = JSON.parse(raw) as Record<string, unknown>
        if (typeof meta.aiTitle === 'string') title = meta.aiTitle
        if (typeof meta.agentName === 'string') title = meta.agentName
        if (!projectPath && typeof meta.cwd === 'string') projectPath = meta.cwd
      } catch {
        // not critical
      }
    }

    // Cheap check before parsing JSON.
    if (!raw.toLowerCase().includes(needle)) continue

    let line: Record<string, unknown>
    try {
      line = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    const type = line.type
    if (type !== 'user' && type !== 'assistant') continue
    if (line.isMeta === true) continue

    const message = line.message as Record<string, unknown> | undefined
    const text = extractText(message?.content, includeTools)
    if (!text) continue

    const index = text.toLowerCase().indexOf(needle)
    if (index === -1) continue

    const { snippet } = makeSnippet(text, index, needle.length)
    const localIndex = snippet.toLowerCase().indexOf(needle)

    found.push({
      sessionId,
      filePath,
      projectPath,
      encodedDir,
      title,
      role: type === 'assistant' ? 'assistant' : 'user',
      timestamp: typeof line.timestamp === 'string' ? line.timestamp : '',
      snippet,
      matchStart: localIndex,
      matchLength: needle.length
    })

    if (hits.length + found.length >= limit) break
  }

  // The title is only known after a full pass — apply it to every hit at the end.
  for (const hit of found) {
    hit.title = title || hit.title || sessionId.slice(0, 8)
    hit.projectPath = projectPath || encodedDir
    hits.push(hit)
  }
}
