import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessage, SessionMeta } from '@shared/types'

/**
 * Notes and bookmarks live in the app's own data, not in `~/.claude`: this is our
 * own layer and the CLI knows nothing about it.
 */
function notesFile(): string {
  return join(app.getPath('userData'), 'session-notes.json')
}

export interface SessionNote {
  text: string
  /** UUIDs of bookmarked messages. */
  bookmarks: string[]
  updatedAt: number
}

type NotesMap = Record<string, SessionNote>

async function readAll(): Promise<NotesMap> {
  try {
    return JSON.parse(await readFile(notesFile(), 'utf8')) as NotesMap
  } catch {
    return {}
  }
}

async function writeAll(map: NotesMap): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(notesFile(), JSON.stringify(map, null, 2), 'utf8')
}

export async function getNote(sessionId: string): Promise<SessionNote> {
  const all = await readAll()
  return all[sessionId] ?? { text: '', bookmarks: [], updatedAt: 0 }
}

export async function saveNote(sessionId: string, text: string): Promise<void> {
  const all = await readAll()
  const existing = all[sessionId] ?? { text: '', bookmarks: [], updatedAt: 0 }
  all[sessionId] = { ...existing, text, updatedAt: Date.now() }
  await writeAll(all)
}

export async function toggleBookmark(sessionId: string, messageUuid: string): Promise<string[]> {
  const all = await readAll()
  const existing = all[sessionId] ?? { text: '', bookmarks: [], updatedAt: 0 }
  const bookmarks = existing.bookmarks.includes(messageUuid)
    ? existing.bookmarks.filter((id) => id !== messageUuid)
    : [...existing.bookmarks, messageUuid]

  all[sessionId] = { ...existing, bookmarks, updatedAt: Date.now() }
  await writeAll(all)
  return bookmarks
}

/** How many characters of a tool result to keep in the export. */
const TOOL_RESULT_LIMIT = 2000

/**
 * Markdown export of a session.
 *
 * Tool calls are folded into `<details>` — otherwise the document turns into one
 * long log and the conversation becomes unreadable.
 */
export function toMarkdown(
  meta: SessionMeta,
  messages: ChatMessage[],
  note?: SessionNote
): string {
  const lines: string[] = []
  const date = new Date(meta.createdAt)

  lines.push(`# ${meta.title}`, '')
  lines.push(`- **Project:** \`${meta.projectPath}\``)
  lines.push(`- **Session:** \`${meta.sessionId}\``)
  if (Number.isFinite(date.getTime())) {
    lines.push(`- **Started:** ${date.toLocaleString()}`)
  }
  if (meta.gitBranch) lines.push(`- **Branch:** \`${meta.gitBranch}\``)
  lines.push(`- **Messages:** ${messages.length}`, '')

  if (note?.text.trim()) {
    lines.push('## Notes', '', note.text.trim(), '')
  }

  lines.push('---', '')

  for (const message of messages) {
    const bookmarked = note?.bookmarks.includes(message.uuid) ? ' 🔖' : ''

    if (message.role === 'system') {
      lines.push(`> \`${message.text}\`${bookmarked}`, '')
      continue
    }

    lines.push(`### ${message.role === 'user' ? 'User' : 'Claude'}${bookmarked}`, '')

    if (message.thinking?.trim()) {
      lines.push('<details><summary>Thinking</summary>', '', message.thinking.trim(), '', '</details>', '')
    }
    if (message.text.trim()) lines.push(message.text.trim(), '')

    for (const call of message.toolCalls) {
      const summary = `${call.name}${call.result?.isError ? ' (error)' : ''}`
      lines.push(`<details><summary>🔧 ${summary}</summary>`, '')
      lines.push('```json', JSON.stringify(call.input, null, 2), '```', '')
      if (call.result) {
        const content = call.result.content.slice(0, TOOL_RESULT_LIMIT)
        const cut = call.result.content.length > TOOL_RESULT_LIMIT ? '\n… truncated' : ''
        lines.push('```', content + cut, '```', '')
      }
      lines.push('</details>', '')
    }
  }

  return lines.join('\n')
}
