import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

async function git(root: string, args: string[], timeout = 15_000): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    maxBuffer: 32 * 1024 * 1024,
    timeout
  })
  return stdout
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitFile {
  path: string
  absolutePath: string
  status: FileStatus
  staged: boolean
  /** For renames: where the file came from. */
  from?: string
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  /** Commits ahead of and behind the remote branch. */
  ahead?: number
  behind?: number
  upstream?: string
  files: GitFile[]
  /** True when the repository has no commits at all. */
  unborn?: boolean
}

/** Maps a status letter from `git status --porcelain=v1` to our type. */
function mapCode(code: string): FileStatus {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'U':
      return 'conflicted'
    case '?':
      return 'untracked'
    default:
      return 'modified'
  }
}

/**
 * Working tree state.
 *
 * `--porcelain=v1 -z` is deliberate: the format is stable across git versions, and
 * the NUL separator survives file names with spaces and newlines.
 */
export async function status(root: string): Promise<GitStatus> {
  const isRepo = await git(root, ['rev-parse', '--is-inside-work-tree'])
    .then((s) => s.trim() === 'true')
    .catch(() => false)
  if (!isRepo) return { isRepo: false, files: [] }

  const branch = (await git(root, ['branch', '--show-current']).catch(() => '')).trim() || undefined

  let ahead: number | undefined
  let behind: number | undefined
  let upstream: string | undefined
  try {
    upstream = (await git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
    const counts = (await git(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`])).trim()
    const [b, a] = counts.split(/\s+/).map(Number)
    behind = b
    ahead = a
  } catch {
    // A branch without an upstream is perfectly normal.
  }

  const unborn = await git(root, ['rev-parse', '--verify', 'HEAD'])
    .then(() => false)
    .catch(() => true)

  const raw = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const files = parsePorcelain(raw, root)

  return { isRepo: true, branch, ahead, behind, upstream, files, unborn }
}

function parsePorcelain(raw: string, root: string): GitFile[] {
  const parts = raw.split('\0')
  const files: GitFile[] = []

  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (entry.length < 4) continue

    const indexCode = entry[0]
    const workCode = entry[1]
    const path = entry.slice(3)

    // A rename yields TWO consecutive entries: the new name first, then the old.
    let from: string | undefined
    if (indexCode === 'R' || workCode === 'R') {
      from = parts[++i]
    }

    if (indexCode === '?' && workCode === '?') {
      files.push({ path, absolutePath: join(root, path), status: 'untracked', staged: false })
      continue
    }

    // A file can be both staged and modified — that is two rows in the UI.
    if (indexCode !== ' ' && indexCode !== '?') {
      files.push({
        path,
        absolutePath: join(root, path),
        status: mapCode(indexCode),
        staged: true,
        from
      })
    }
    if (workCode !== ' ' && workCode !== '?') {
      files.push({
        path,
        absolutePath: join(root, path),
        status: mapCode(workCode),
        staged: false,
        from
      })
    }
  }
  return files
}

/** Diff of one file. For untracked files the whole content is shown as added. */
export async function diffFile(
  root: string,
  path: string,
  staged: boolean
): Promise<{ diff: string } | { error: string }> {
  try {
    const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path]
    let diff = await git(root, args)
    if (!diff.trim()) {
      // git diff ignores untracked files — treat it as newly added.
      diff = await git(root, ['diff', '--no-index', '--', '/dev/null', path]).catch(() => '')
    }
    return { diff }
  } catch (err) {
    return { error: (err as Error).message }
  }
}

export async function stage(root: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await git(root, ['add', '--', ...paths])
}

export async function unstage(root: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await git(root, ['restore', '--staged', '--', ...paths])
}

/** Discards changes in a file. Irreversible — only call after explicit confirmation. */
export async function discard(root: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  await git(root, ['restore', '--', ...paths])
}

export async function commit(
  root: string,
  message: string,
  opts: { amend?: boolean } = {}
): Promise<{ ok: boolean; output?: string; error?: string }> {
  if (!message.trim() && !opts.amend) return { ok: false, error: 'Empty commit message' }
  try {
    const args = ['commit', '-m', message]
    if (opts.amend) args.push('--amend')
    return { ok: true, output: await git(root, args, 30_000) }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return { ok: false, error: (e.stderr || e.stdout || e.message).trim() }
  }
}

export interface Commit {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
  refs?: string
}

/** Commit history. Control characters as separators, so text cannot be confused for one. */
export async function log(root: string, limit = 60, branch?: string): Promise<Commit[]> {
  const format = ['%H', '%h', '%s', '%an', '%aI', '%D'].join('\x1f')
  const args = ['log', `--max-count=${limit}`, `--format=${format}`]
  if (branch) args.push(branch)

  const raw = await git(root, args).catch(() => '')
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, subject, author, date, refs] = line.split('\x1f')
      return { hash, shortHash, subject, author, date, refs: refs || undefined }
    })
}

export interface Branch {
  name: string
  current: boolean
  remote: boolean
  lastCommit?: string
}

export async function branches(root: string): Promise<Branch[]> {
  const raw = await git(root, [
    'branch',
    '--all',
    '--format=%(refname:short)\x1f%(HEAD)\x1f%(committerdate:relative)'
  ]).catch(() => '')

  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, head, date] = line.split('\x1f')
      return {
        name,
        current: head === '*',
        remote: name.startsWith('remotes/') || name.startsWith('origin/'),
        lastCommit: date
      }
    })
    // HEAD -> origin/main among the refs is just noise.
    .filter((b) => !b.name.includes('HEAD'))
}

export async function checkout(
  root: string,
  branch: string,
  opts: { create?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {
  try {
    await git(root, opts.create ? ['checkout', '-b', branch] : ['checkout', branch], 30_000)
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    return { ok: false, error: (e.stderr || e.message).trim() }
  }
}

/** Shows a commit in full. */
export async function showCommit(root: string, hash: string): Promise<string> {
  return git(root, ['show', '--stat', '--patch', hash]).catch(() => '')
}

export interface BlameLine {
  hash: string
  author: string
  date: string
  line: number
  text: string
}

export async function blame(root: string, path: string): Promise<BlameLine[]> {
  const raw = await git(root, ['blame', '--line-porcelain', '--', path]).catch(() => '')
  const lines: BlameLine[] = []

  let current: Partial<BlameLine> = {}
  for (const line of raw.split('\n')) {
    if (/^[0-9a-f]{40} /.test(line)) {
      const parts = line.split(' ')
      current = { hash: parts[0], line: Number(parts[2]) }
    } else if (line.startsWith('author ')) {
      current.author = line.slice(7)
    } else if (line.startsWith('author-time ')) {
      current.date = new Date(Number(line.slice(12)) * 1000).toISOString()
    } else if (line.startsWith('\t')) {
      lines.push({
        hash: current.hash ?? '',
        author: current.author ?? '',
        date: current.date ?? '',
        line: current.line ?? 0,
        text: line.slice(1)
      })
    }
  }
  return lines
}
