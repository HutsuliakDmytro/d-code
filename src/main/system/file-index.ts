import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const execFileAsync = promisify(execFile)

/** The same directories the file tree hides. */
const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'Pods',
  '.gradle',
  '.idea',
  'DerivedData'
])

const MAX_FILES = 20_000

interface CacheEntry {
  files: string[]
  at: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30_000

/**
 * Flat list of project files for fast search by name.
 *
 * In a git repository `git ls-files` does the job — it is instant and already
 * honours .gitignore. Outside git the tree is walked manually with the same
 * exclusions. The result is cached for half a minute: the list is needed on every
 * keystroke in the completion popup.
 */
export async function listProjectFiles(root: string): Promise<string[]> {
  const cached = cache.get(root)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.files

  let files: string[]
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'],
      { maxBuffer: 16 * 1024 * 1024, timeout: 10_000 }
    )
    files = stdout.split('\n').filter(Boolean)
  } catch {
    files = await walk(root, root, [])
  }

  const limited = files.slice(0, MAX_FILES)
  cache.set(root, { files: limited, at: Date.now() })
  return limited
}

async function walk(root: string, dir: string, acc: string[]): Promise<string[]> {
  if (acc.length >= MAX_FILES) return acc
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED.has(entry.name)) continue
      await walk(root, full, acc)
    } else if (entry.isFile()) {
      acc.push(relative(root, full))
      if (acc.length >= MAX_FILES) break
    }
  }
  return acc
}

export interface FileMatch {
  path: string
  score: number
}

/**
 * ⌘P-style fuzzy search: query characters must appear in order.
 * Matches in the file name beat matches in the directory, consecutive beats scattered.
 */
export function fuzzyMatch(query: string, candidates: string[], limit = 30): FileMatch[] {
  const needle = query.toLowerCase().replace(/\s+/g, '')
  if (!needle) return candidates.slice(0, limit).map((path) => ({ path, score: 0 }))

  const results: FileMatch[] = []
  for (const path of candidates) {
    const score = scorePath(needle, path)
    if (score > 0) results.push({ path, score })
  }

  results.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
  return results.slice(0, limit)
}

function scorePath(needle: string, path: string): number {
  const lower = path.toLowerCase()
  const fileNameStart = lower.lastIndexOf('/') + 1

  let score = 0
  let cursor = 0
  let previousIndex = -1

  for (const char of needle) {
    const index = lower.indexOf(char, cursor)
    if (index === -1) return 0

    score += 1
    if (index >= fileNameStart) score += 2 // a hit in the file name matters more
    if (index === previousIndex + 1) score += 3 // consecutive characters
    if (index === fileNameStart) score += 4 // start of the name

    previousIndex = index
    cursor = index + 1
  }

  // With equal scores the shorter path is closer to what was meant.
  return score + Math.max(0, 20 - path.length / 8)
}
