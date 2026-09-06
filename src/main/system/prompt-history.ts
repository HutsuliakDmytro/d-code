import { readFile } from 'node:fs/promises'
import { HISTORY_FILE } from '../store/project-paths'

export interface PromptEntry {
  text: string
  timestamp: number
  project: string
}

/**
 * History of entered prompts.
 *
 * The CLI keeps one shared journal for every project in `~/.claude/history.jsonl`,
 * a line per prompt. Its `project` field holds the raw path, so filtering needs no
 * directory encoding.
 */
export async function readPromptHistory(opts: {
  project?: string
  limit?: number
}): Promise<PromptEntry[]> {
  const limit = opts.limit ?? 200
  let raw: string
  try {
    raw = await readFile(HISTORY_FILE, 'utf8')
  } catch {
    return []
  }

  const entries: PromptEntry[] = []
  const seen = new Set<string>()

  // Read from the end: recent prompts matter more and the file can be large.
  const lines = raw.split('\n')
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    const line = lines[i]
    if (!line.trim()) continue

    let entry: { display?: string; timestamp?: number; project?: string }
    try {
      entry = JSON.parse(line) as typeof entry
    } catch {
      continue
    }

    const text = entry.display?.trim()
    if (!text) continue
    if (opts.project && entry.project !== opts.project) continue
    // Repeats of the same prompt only get in the way when browsing.
    if (seen.has(text)) continue

    seen.add(text)
    entries.push({
      text,
      timestamp: entry.timestamp ?? 0,
      project: entry.project ?? ''
    })
  }

  return entries
}
