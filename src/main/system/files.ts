import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Directories that never belong in the project tree. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  // Build output: hundreds of megabytes of binary data that grep chokes on for
  // tens of seconds.
  'release',
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

/** Above this a file is not opened as text: the renderer would choke. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

export interface FileNode {
  name: string
  path: string
  /** Path relative to the project root — this is what the UI shows. */
  relativePath: string
  isDirectory: boolean
  size: number
  /** Directories only: whether anything visible lives inside. */
  hasChildren?: boolean
}

/**
 * Contents of a single tree level.
 *
 * Read lazily, one directory at a time: walking a large repository recursively
 * would block the interface, and most branches are never expanded anyway.
 */
export async function listDirectory(root: string, dirPath?: string): Promise<FileNode[]> {
  const target = dirPath ?? root
  // Do not let ../ escape the project.
  const rel = relative(root, target)
  if (rel.startsWith('..')) throw new Error('Path is outside the project')

  const entries = await readdir(target, { withFileTypes: true })
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue

    const full = join(target, entry.name)
    const isDirectory = entry.isDirectory()
    let size = 0
    if (!isDirectory) {
      size = await stat(full)
        .then((s) => s.size)
        .catch(() => 0)
    }

    nodes.push({
      name: entry.name,
      path: full,
      relativePath: relative(root, full),
      isDirectory,
      size,
      hasChildren: isDirectory ? await hasVisibleChildren(full) : undefined
    })
  }

  // Directories first, then alphabetical — that is what the eye expects.
  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function hasVisibleChildren(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.some(
    (e) => !e.name.startsWith('.') && !(e.isDirectory() && IGNORED_DIRS.has(e.name))
  )
}

export interface FileContent {
  path: string
  content: string
  size: number
  /** Highlighting language, derived from the extension. */
  language: string
  truncated: boolean
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.sh': 'bash',
  '.zsh': 'bash',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.dart': 'dart',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.m': 'objectivec',
  '.mm': 'objectivec',
  '.sql': 'sql',
  '.toml': 'toml',
  '.xml': 'xml'
}

export function languageOf(path: string): string {
  return LANGUAGE_BY_EXT[extname(path).toLowerCase()] ?? 'text'
}

export async function readTextFile(path: string): Promise<FileContent | { error: string }> {
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return { error: 'Not a file' }
    size = info.size
  } catch {
    return { error: 'File is not accessible' }
  }

  try {
    const buffer = await readFile(path)
    // A null byte in the first kilobyte is a reliable binary marker.
    if (buffer.subarray(0, 1024).includes(0)) {
      return { error: 'Binary file — cannot display' }
    }
    const truncated = buffer.length > MAX_TEXT_BYTES
    return {
      path,
      content: buffer.subarray(0, MAX_TEXT_BYTES).toString('utf8'),
      size,
      language: languageOf(path),
      truncated
    }
  } catch {
    return { error: 'Could not read the file' }
  }
}

export interface CodeSearchHit {
  path: string
  relativePath: string
  line: number
  text: string
  matchStart: number
  matchLength: number
}

/**
 * Walking the tree ourselves when the directory is not a git repository.
 *
 * Calling `grep -r` is tempting, but it does not exist on Windows, and keeping two
 * different execution paths for one case is worse than reading the files here. A
 * tree without git is usually small: everything heavy (`node_modules`, build
 * output) is filtered out anyway.
 */
async function searchByWalking(
  root: string,
  needle: string,
  opts: { caseSensitive?: boolean; limit: number }
): Promise<CodeSearchHit[]> {
  const hits: CodeSearchHit[] = []
  const lower = needle.toLowerCase()
  /** Files larger than this are almost certainly data or artefacts, not code. */
  const MAX_FILE_BYTES = 2 * 1024 * 1024

  const walk = async (dir: string): Promise<void> => {
    if (hits.length >= opts.limit) return

    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (hits.length >= opts.limit) return
      const full = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue

      const info = await stat(full).catch(() => undefined)
      if (!info || info.size > MAX_FILE_BYTES) continue

      const content = await readFile(full, 'utf8').catch(() => undefined)
      if (content === undefined) continue
      // Binary files are spotted by a null byte; searching them is pointless.
      if (content.includes('\u0000')) continue

      const haystack = opts.caseSensitive ? content : content.toLowerCase()
      if (!haystack.includes(opts.caseSensitive ? needle : lower)) continue

      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= opts.limit) return
        const text = lines[i]
        const line = opts.caseSensitive ? text : text.toLowerCase()
        const matchStart = line.indexOf(opts.caseSensitive ? needle : lower)
        if (matchStart === -1) continue

        hits.push({
          path: full,
          relativePath: relative(root, full),
          line: i + 1,
          text: text.length > 400 ? `${text.slice(0, 400)}…` : text,
          matchStart,
          matchLength: needle.length
        })
      }
    }
  }

  await walk(root)
  return hits
}

/**
 * Search across project code.
 *
 * `git grep` is used wherever this is a repository: it honours .gitignore and is
 * an order of magnitude faster than walking the tree. Outside git we walk it ourselves.
 */
export async function searchCode(
  root: string,
  query: string,
  opts: { caseSensitive?: boolean; limit?: number } = {}
): Promise<CodeSearchHit[]> {
  const needle = query.trim()
  if (needle.length < 2) return []
  const limit = opts.limit ?? 300

  const isRepo = await execFileAsync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'])
    .then(() => true)
    .catch(() => false)

  if (!isRepo) return searchByWalking(root, needle, { ...opts, limit })

  const args = [
    '-C',
    root,
    'grep',
    '-n',
    '--fixed-strings',
    ...(opts.caseSensitive ? [] : ['-i']),
    needle
  ]

  const { stdout } = await execFileAsync('git', args, {
    maxBuffer: 16 * 1024 * 1024,
    timeout: 20_000
  }).catch((err: { stdout?: string; code?: number }) => ({
    // git grep exits 1 when nothing is found — that is not an error.
    stdout: err.stdout ?? ''
  }))

  const hits: CodeSearchHit[] = []
  const lower = needle.toLowerCase()

  for (const raw of stdout.split('\n')) {
    if (!raw.trim() || hits.length >= limit) break
    // Format is path:line:text — but the path itself can contain a colon.
    const first = raw.indexOf(':')
    const second = raw.indexOf(':', first + 1)
    if (first === -1 || second === -1) continue

    const filePart = raw.slice(0, first)
    const lineNum = Number(raw.slice(first + 1, second))
    if (!Number.isFinite(lineNum)) continue

    const text = raw.slice(second + 1)
    const haystack = opts.caseSensitive ? text : text.toLowerCase()
    const matchStart = haystack.indexOf(opts.caseSensitive ? needle : lower)

    hits.push({
      path: join(root, filePart),
      relativePath: filePart,
      line: lineNum,
      text: text.length > 400 ? `${text.slice(0, 400)}…` : text,
      matchStart,
      matchLength: needle.length
    })
  }

  return hits
}

/** Splits a relative path into breadcrumb segments. */
export function pathSegments(relativePath: string): string[] {
  return relativePath.split(sep).filter(Boolean)
}
