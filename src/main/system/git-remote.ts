import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { childEnv } from '../claude/resolve-cli'

const execFileAsync = promisify(execFile)

export interface RemoteOpResult {
  ok: boolean
  output: string
  error?: string
}

export type RemoteOperation = 'fetch' | 'pull' | 'push'

/**
 * Long-running operations against a remote.
 *
 * Run through streaming `spawn`, because pushing a large branch takes tens of
 * seconds and a silent window for that long reads as a freeze. Git writes progress
 * to stderr, so both streams are collected.
 */
export class GitRemoteRunner extends EventEmitter {
  private child?: ReturnType<typeof spawn>

  get running(): boolean {
    return Boolean(this.child)
  }

  async run(
    root: string,
    operation: RemoteOperation,
    opts: { setUpstream?: boolean; branch?: string; force?: boolean } = {}
  ): Promise<RemoteOpResult> {
    if (this.child) return { ok: false, output: '', error: 'An operation is already running' }

    const args = ['-C', root, operation, '--progress']
    if (operation === 'push') {
      if (opts.setUpstream && opts.branch) args.push('--set-upstream', 'origin', opts.branch)
      // Only the safe variant: a plain --force overwrites someone else's work.
      if (opts.force) args.push('--force-with-lease')
    }

    const env = await childEnv()
    this.emit('start', operation)

    return new Promise((resolve) => {
      const child = spawn('git', args, { cwd: root, env })
      this.child = child

      let output = ''
      const append = (data: Buffer): void => {
        const text = data.toString()
        output += text
        this.emit('progress', text)
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)

      child.on('error', (err) => {
        this.child = undefined
        this.emit('done', operation)
        resolve({ ok: false, output, error: err.message })
      })

      child.on('close', (code) => {
        this.child = undefined
        this.emit('done', operation)
        resolve({
          ok: code === 0,
          output,
          error: code === 0 ? undefined : output.trim().split('\n').slice(-4).join('\n')
        })
      })
    })
  }

  cancel(): void {
    this.child?.kill('SIGTERM')
    this.child = undefined
  }
}

// ─── Stash ───────────────────────────────────────────────────────────────────

export interface StashEntry {
  index: number
  label: string
  branch?: string
  date?: string
}

export async function listStash(root: string): Promise<StashEntry[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'stash', 'list', '--format=%gd%x1f%gs%x1f%cr'],
      { env: await childEnv() }
    )
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line, index) => {
        const [, subject, date] = line.split('\x1f')
        // "WIP on main: 1a2b3c message" — the branch is visible at the line start.
        const branch = /on ([^:]+):/.exec(subject ?? '')?.[1]
        return { index, label: subject ?? '', branch, date }
      })
  } catch {
    return []
  }
}

export async function stashSave(root: string, message?: string): Promise<RemoteOpResult> {
  const args = ['-C', root, 'stash', 'push', '--include-untracked']
  if (message?.trim()) args.push('-m', message.trim())
  return runGit(root, args)
}

/** `pop` applies and drops the entry, `apply` leaves it in place. */
export async function stashApply(
  root: string,
  index: number,
  drop: boolean
): Promise<RemoteOpResult> {
  return runGit(root, ['-C', root, 'stash', drop ? 'pop' : 'apply', `stash@{${index}}`])
}

export async function stashDrop(root: string, index: number): Promise<RemoteOpResult> {
  return runGit(root, ['-C', root, 'stash', 'drop', `stash@{${index}}`])
}

async function runGit(root: string, args: string[]): Promise<RemoteOpResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: root,
      env: await childEnv(),
      maxBuffer: 8 * 1024 * 1024
    })
    return { ok: true, output: stdout || stderr }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string }
    return { ok: false, output: e.stdout ?? '', error: (e.stderr || e.message).trim() }
  }
}

// ─── Branch comparison ───────────────────────────────────────────────────────

export interface BranchDiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  added: number
  removed: number
}

/**
 * Which files differ between two branches.
 *
 * `base...head` (three dots) is deliberate: it shows head's changes since the
 * merge base, not every difference including whatever moved in base meanwhile.
 */
export async function diffBranches(
  root: string,
  base: string,
  head: string
): Promise<BranchDiffFile[]> {
  const env = await childEnv()
  const range = `${base}...${head}`

  const [names, stats] = await Promise.all([
    execFileAsync('git', ['-C', root, 'diff', '--name-status', range], {
      env,
      maxBuffer: 16 * 1024 * 1024
    }).catch(() => ({ stdout: '' })),
    execFileAsync('git', ['-C', root, 'diff', '--numstat', range], {
      env,
      maxBuffer: 16 * 1024 * 1024
    }).catch(() => ({ stdout: '' }))
  ])

  const counts = new Map<string, { added: number; removed: number }>()
  for (const line of stats.stdout.split('\n')) {
    const [added, removed, path] = line.split('\t')
    if (!path) continue
    counts.set(path, {
      // For binary files git writes "-" instead of numbers.
      added: added === '-' ? 0 : Number(added),
      removed: removed === '-' ? 0 : Number(removed)
    })
  }

  const files: BranchDiffFile[] = []
  for (const line of names.stdout.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const code = parts[0][0]
    const path = parts[parts.length - 1]
    const status =
      code === 'A' ? 'added' : code === 'D' ? 'deleted' : code === 'R' ? 'renamed' : 'modified'
    files.push({ path, status, ...(counts.get(path) ?? { added: 0, removed: 0 }) })
  }

  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/** Diff of a single file between branches, for viewing in the same window. */
export async function diffBranchFile(
  root: string,
  base: string,
  head: string,
  path: string
): Promise<{ before: string; after: string }> {
  const env = await childEnv()
  const read = async (ref: string): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('git', ['-C', root, 'show', `${ref}:${path}`], {
        env,
        maxBuffer: 16 * 1024 * 1024
      })
      return stdout
    } catch {
      // The file is absent from this branch — normal for additions and deletions.
      return ''
    }
  }

  // Compared against the merge base rather than the tip of base.
  const mergeBase = await execFileAsync('git', ['-C', root, 'merge-base', base, head], { env })
    .then((r) => r.stdout.trim())
    .catch(() => base)

  return { before: await read(mergeBase), after: await read(head) }
}

// ─── Merge conflicts ─────────────────────────────────────────────────────────

export interface ConflictBlock {
  /** Zero-based index of the block within the file. */
  index: number
  startLine: number
  endLine: number
  ours: string
  theirs: string
  /** Labels from the markers: usually HEAD and a branch name. */
  oursLabel: string
  theirsLabel: string
}

/**
 * Parses conflict markers in a file.
 *
 * Works on the text rather than the git index: the user sees exactly what is on
 * disk and fixes exactly that.
 */
export function parseConflicts(content: string): ConflictBlock[] {
  const lines = content.split('\n')
  const blocks: ConflictBlock[] = []

  let start = -1
  let separator = -1
  let oursLabel = ''

  lines.forEach((line, i) => {
    if (line.startsWith('<<<<<<<')) {
      start = i
      separator = -1
      oursLabel = line.slice(7).trim()
      return
    }
    if (line.startsWith('=======') && start !== -1) {
      separator = i
      return
    }
    if (line.startsWith('>>>>>>>') && start !== -1 && separator !== -1) {
      blocks.push({
        index: blocks.length,
        startLine: start,
        endLine: i,
        ours: lines.slice(start + 1, separator).join('\n'),
        theirs: lines.slice(separator + 1, i).join('\n'),
        oursLabel: oursLabel || 'ours',
        theirsLabel: line.slice(7).trim() || 'theirs'
      })
      start = -1
      separator = -1
    }
  })

  return blocks
}

export type ConflictChoice = 'ours' | 'theirs' | 'both'

/** Applies a choice to one conflict block and returns the new file text. */
export function resolveConflict(
  content: string,
  blockIndex: number,
  choice: ConflictChoice
): string {
  const blocks = parseConflicts(content)
  const block = blocks[blockIndex]
  if (!block) return content

  const lines = content.split('\n')
  const replacement =
    choice === 'ours'
      ? block.ours
      : choice === 'theirs'
        ? block.theirs
        : `${block.ours}\n${block.theirs}`

  const before = lines.slice(0, block.startLine)
  const after = lines.slice(block.endLine + 1)
  // An empty choice must not leave a stray blank line.
  const middle = replacement === '' ? [] : replacement.split('\n')
  return [...before, ...middle, ...after].join('\n')
}

/** Marks a file resolved by staging it. */
export async function markResolved(root: string, path: string): Promise<RemoteOpResult> {
  return runGit(root, ['-C', root, 'add', '--', path])
}

export async function readConflictFile(root: string, path: string): Promise<string> {
  return readFile(join(root, path), 'utf8').catch(() => '')
}

export async function writeConflictFile(
  root: string,
  path: string,
  content: string
): Promise<RemoteOpResult> {
  try {
    await writeFile(join(root, path), content, 'utf8')
    return { ok: true, output: '' }
  } catch (err) {
    return { ok: false, output: '', error: (err as Error).message }
  }
}
