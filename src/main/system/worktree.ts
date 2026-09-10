import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, join } from 'node:path'

const execFileAsync = promisify(execFile)

/**
 * Git worktrees.
 *
 * The reason they matter here is parallel agents: two conversations editing one
 * checkout fight over the same files, while two worktrees of the same
 * repository share history and nothing else. A worktree is therefore treated as
 * a first-class place to open a session in, not as a git curiosity.
 */

export interface Worktree {
  path: string
  /** Short branch name, absent when the worktree is on a detached HEAD. */
  branch?: string
  head?: string
  /** The worktree the repository was cloned into — it cannot be removed. */
  isMain: boolean
  locked: boolean
  lockReason?: string
  /** Git considers the directory gone; `prune` would drop the entry. */
  prunable: boolean
  /** Sessions already recorded for this directory, filled in by the caller. */
  sessionCount?: number
}

export interface WorktreeResult {
  ok: boolean
  error?: string
  path?: string
}

async function git(root: string, args: string[], timeout = 30_000): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], {
    maxBuffer: 8 * 1024 * 1024,
    timeout
  })
  return stdout
}

/**
 * Parses `git worktree list --porcelain`.
 *
 * Records are separated by a blank line and each attribute sits on its own
 * line; `branch` carries a full ref, and `detached`, `bare`, `locked` and
 * `prunable` appear as bare markers with an optional reason.
 */
export function parseWorktreeList(stdout: string): Worktree[] {
  const worktrees: Worktree[] = []
  let current: Worktree | undefined

  for (const line of stdout.split('\n')) {
    const text = line.trimEnd()
    if (!text) {
      if (current) worktrees.push(current)
      current = undefined
      continue
    }

    const space = text.indexOf(' ')
    const key = space === -1 ? text : text.slice(0, space)
    const value = space === -1 ? '' : text.slice(space + 1)

    switch (key) {
      case 'worktree':
        // The first record is always the main worktree.
        current = { path: value, isMain: worktrees.length === 0, locked: false, prunable: false }
        break
      case 'HEAD':
        if (current) current.head = value
        break
      case 'branch':
        if (current) current.branch = value.replace(/^refs\/heads\//, '')
        break
      case 'locked':
        if (current) {
          current.locked = true
          current.lockReason = value || undefined
        }
        break
      case 'prunable':
        if (current) current.prunable = true
        break
      default:
        break
    }
  }
  if (current) worktrees.push(current)
  return worktrees
}

export async function listWorktrees(root: string): Promise<Worktree[]> {
  try {
    return parseWorktreeList(await git(root, ['worktree', 'list', '--porcelain']))
  } catch {
    // Not a repository, or a git too old for --porcelain: an empty list is the
    // honest answer, and the UI treats it as "this feature is unavailable here".
    return []
  }
}

/** Characters git refuses in a ref, plus the ones that make a bad directory name. */
const UNSAFE_BRANCH = /[\s~^:?*[\]\\]|\.\.|^-|^\/|\/$|\.lock$/

export function isValidBranchName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !UNSAFE_BRANCH.test(name)
}

/**
 * Where a new worktree should go by default.
 *
 * Sibling of the repository rather than inside it: a worktree nested in its own
 * repository ends up in the parent's file listings, its own `.gitignore` and
 * every `rg` the agent runs.
 */
export function defaultWorktreePath(root: string, branch: string): string {
  const safe = branch.replace(/[/\\]/g, '-')
  return join(dirname(root), `${basename(root)}-${safe}`)
}

export interface AddWorktreeInput {
  /** Destination directory. Must not exist yet. */
  path: string
  branch: string
  /** Create the branch, rather than checking out an existing one. */
  createBranch: boolean
  /** Starting point for a new branch; defaults to the current HEAD. */
  startPoint?: string
}

/**
 * Creates a worktree.
 *
 * Errors are returned rather than thrown: every failure here is a normal
 * situation the user can fix — the branch is already checked out somewhere
 * else, the directory exists, the name is not a valid ref.
 */
export async function addWorktree(root: string, input: AddWorktreeInput): Promise<WorktreeResult> {
  if (!isValidBranchName(input.branch)) {
    return { ok: false, error: `"${input.branch}" is not a valid branch name` }
  }
  if (!input.path.trim()) return { ok: false, error: 'Path is empty' }

  const args = ['worktree', 'add']
  if (input.createBranch) args.push('-b', input.branch)
  args.push(input.path)
  if (input.createBranch) {
    if (input.startPoint) args.push(input.startPoint)
  } else {
    args.push(input.branch)
  }

  try {
    await git(root, args, 120_000)
    return { ok: true, path: input.path }
  } catch (err) {
    return { ok: false, error: gitError(err) }
  }
}

/**
 * Removes a worktree.
 *
 * Without `force` git refuses when the tree has uncommitted changes, which is
 * exactly the protection wanted here — the UI asks again instead of deciding
 * on the user's behalf.
 */
export async function removeWorktree(
  root: string,
  path: string,
  force = false
): Promise<WorktreeResult> {
  try {
    await git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), path], 60_000)
    return { ok: true, path }
  } catch (err) {
    return { ok: false, error: gitError(err) }
  }
}

/** Drops registrations whose directory no longer exists. */
export async function pruneWorktrees(root: string): Promise<WorktreeResult> {
  try {
    await git(root, ['worktree', 'prune'])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: gitError(err) }
  }
}

/** git writes the useful part of a failure to stderr; the exit code says nothing. */
function gitError(err: unknown): string {
  const e = err as { stderr?: string; message?: string }
  const text = (e.stderr || e.message || '').trim()
  return (
    text
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('hint:'))
      .slice(0, 2)
      .join(' ') || 'git failed'
  )
}
