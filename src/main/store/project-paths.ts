import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { planUsageHistoryPath } from '../system/platform'

export const CLAUDE_HOME = join(homedir(), '.claude')
export const PROJECTS_DIR = join(CLAUDE_HOME, 'projects')
export const SESSIONS_DIR = join(CLAUDE_HOME, 'sessions')
export const HISTORY_FILE = join(CLAUDE_HOME, 'history.jsonl')
export const CLAUDE_CONFIG = join(homedir(), '.claude.json')
export const PLAN_USAGE_HISTORY = planUsageHistoryPath()

/** Length past which the CLI truncates the directory name and appends a hash. */
const MAX_ENCODED_LENGTH = 200

/**
 * String hash identical to the CLI's (the classic java-style hashCode with
 * 32-bit overflow).
 */
function hashPath(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return h
}

/**
 * Encodes a project path into a directory name under ~/.claude/projects/.
 *
 * EVERY character outside [a-zA-Z0-9] is replaced, not just path separators. That
 * makes the transform irreversible and ambiguous: `foo.bar`, `foo_bar`, `foo bar`
 * and `foo-bar` all yield the same directory. For the reverse direction use
 * `listKnownProjectPaths()` rather than attempting to decode.
 */
export function encodeProjectPath(projectPath: string): string {
  const encoded = projectPath.replace(/[^a-zA-Z0-9]/g, '-')
  if (encoded.length <= MAX_ENCODED_LENGTH) return encoded
  // The hash is computed over the FULL original path, not the truncated one.
  const suffix = Math.abs(hashPath(projectPath)).toString(36)
  return `${encoded.slice(0, MAX_ENCODED_LENGTH)}-${suffix}`
}

/** Directory holding a specific project's transcripts. */
export function projectDir(projectPath: string): string {
  return join(PROJECTS_DIR, encodeProjectPath(projectPath))
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return undefined
  }
}

/**
 * Raw project paths known to the CLI. The sources complement each other because
 * neither is complete: `~/.claude.json` only knows what was opened through the CLI,
 * and `history.jsonl` only where prompts were typed.
 */
export async function listKnownProjectPaths(): Promise<string[]> {
  const paths = new Set<string>()

  const config = await readJson<{ projects?: Record<string, unknown> }>(CLAUDE_CONFIG)
  for (const p of Object.keys(config?.projects ?? {})) paths.add(p)

  try {
    const history = await readFile(HISTORY_FILE, 'utf8')
    for (const line of history.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as { project?: string }
        if (entry.project) paths.add(entry.project)
      } catch {
        // A corrupt history line must not break the project list.
      }
    }
  } catch {
    // history.jsonl may not exist on a fresh installation.
  }

  return [...paths].sort()
}

/**
 * Map of `directory name → raw path`. Built forwards, by encoding known paths,
 * because the reverse transform does not exist.
 */
export async function buildDirToPathMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const p of await listKnownProjectPaths()) {
    map.set(encodeProjectPath(p), p)
  }
  return map
}
