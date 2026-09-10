import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
