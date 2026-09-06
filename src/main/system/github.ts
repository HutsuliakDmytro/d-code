import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { childEnv } from '../claude/resolve-cli'

const execFileAsync = promisify(execFile)

export interface GhStatus {
  available: boolean
  authenticated: boolean
  error?: string
}

/**
 * State of `gh`.
 *
 * Presence and authentication are checked separately: without that, the PR buttons
 * would look broken where a single login is all that is missing.
 */
export async function ghStatus(root: string): Promise<GhStatus> {
  const env = await childEnv()
  try {
    await execFileAsync('gh', ['--version'], { env, timeout: 8000 })
  } catch {
    return { available: false, authenticated: false, error: 'gh is not installed' }
  }

  try {
    await execFileAsync('gh', ['auth', 'status'], { cwd: root, env, timeout: 15_000 })
    return { available: true, authenticated: true }
  } catch (err) {
    const e = err as { stderr?: string }
    return {
      available: true,
      authenticated: false,
      error: (e.stderr ?? 'gh auth login required').trim().split('\n')[0]
    }
  }
}

export interface PullRequest {
  number: number
  title: string
  state: string
  isDraft: boolean
  url: string
  author?: string
  /** Check status: passing / failing / pending. */
  checks?: string
  headRefName?: string
  baseRefName?: string
}

/** Open pull requests in the repository. */
export async function listPullRequests(root: string): Promise<PullRequest[]> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      [
        'pr',
        'list',
        '--limit',
        '30',
        '--json',
        'number,title,state,isDraft,url,author,headRefName,baseRefName,statusCheckRollup'
      ],
      { cwd: root, env: await childEnv(), timeout: 25_000, maxBuffer: 8 * 1024 * 1024 }
    )

    const parsed = JSON.parse(stdout) as Array<{
      number: number
      title: string
      state: string
      isDraft: boolean
      url: string
      author?: { login?: string }
      headRefName?: string
      baseRefName?: string
      statusCheckRollup?: Array<{ conclusion?: string; status?: string }>
    }>

    return parsed.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      isDraft: pr.isDraft,
      url: pr.url,
      author: pr.author?.login,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      checks: summarizeChecks(pr.statusCheckRollup)
    }))
  } catch {
    return []
  }
}

/** Reduces checks to one word: the details get read on GitHub anyway. */
function summarizeChecks(
  checks?: Array<{ conclusion?: string; status?: string }>
): string | undefined {
  if (!checks?.length) return undefined
  const failing = checks.some((c) => c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT')
  if (failing) return 'failing'
  const pending = checks.some((c) => c.status && c.status !== 'COMPLETED')
  if (pending) return 'pending'
  return 'passing'
}

/** The pull request for the current branch, if any. */
export async function currentPullRequest(root: string): Promise<PullRequest | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', '--json', 'number,title,state,isDraft,url,author,headRefName,baseRefName'],
      { cwd: root, env: await childEnv(), timeout: 20_000 }
    )
    const pr = JSON.parse(stdout) as PullRequest & { author?: { login?: string } }
    return { ...pr, author: (pr.author as { login?: string } | undefined)?.login }
  } catch {
    return undefined
  }
}

export interface CreatePrResult {
  ok: boolean
  url?: string
  error?: string
}

/**
 * Creates a pull request from the current branch.
 *
 * `--fill` is not used: title and body come from the UI, where the model can draft
 * them and they can be reviewed before sending.
 */
export async function createPullRequest(
  root: string,
  opts: { title: string; body: string; draft?: boolean; base?: string }
): Promise<CreatePrResult> {
  const args = ['pr', 'create', '--title', opts.title, '--body', opts.body]
  if (opts.draft) args.push('--draft')
  if (opts.base) args.push('--base', opts.base)

  try {
    const { stdout } = await execFileAsync('gh', args, {
      cwd: root,
      env: await childEnv(),
      timeout: 60_000
    })
    // gh prints the new PR's URL as its last line.
    const url = stdout.trim().split('\n').filter(Boolean).at(-1)
    return { ok: true, url }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string }
    return { ok: false, error: (e.stderr || e.stdout || e.message).trim().split('\n')[0] }
  }
}
