import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { access, constants, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { childEnv } from '../claude/resolve-cli'

const execFileAsync = promisify(execFile)

export interface FormatResult {
  ok: boolean
  /** Formatted text; absent when there is no formatter or it failed. */
  content?: string
  /** Which formatter ran — surfaced in the UI so the result is not a mystery. */
  tool?: string
  error?: string
}

/** Extensions worth handing to prettier. */
const PRETTIER_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'css',
  'scss',
  'html',
  'md',
  'yaml',
  'yml'
])

async function hasBin(root: string, name: string): Promise<string | undefined> {
  const local = join(root, 'node_modules/.bin', name)
  try {
    await access(local, constants.X_OK)
    return local
  } catch {
    return undefined
  }
}

/**
 * Formats file content with the project's own tool.
 *
 * Only the local `node_modules/.bin` is used, deliberately: a global prettier is
 * almost certainly a different version with different rules, and its output would
 * conflict with what the project's CI produces.
 */
export async function formatFile(
  root: string,
  path: string,
  content: string
): Promise<FormatResult> {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''

  if (PRETTIER_EXTENSIONS.has(extension)) {
    const prettier = await hasBin(root, 'prettier')
    if (!prettier) {
      return { ok: false, error: 'The project has no prettier' }
    }
    try {
      const { stdout } = await execFileAsync(
        prettier,
        ['--stdin-filepath', path],
        { cwd: root, env: await childEnv(), timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      )
      return { ok: true, content: stdout, tool: 'prettier' }
    } catch (err) {
      const e = err as { stderr?: string; message: string }
      return { ok: false, error: (e.stderr || e.message).trim().slice(0, 400) }
    }
  }

  if (extension === 'dart') {
    try {
      // `dart format` only works on files on disk, so the saved file is formatted.
      await execFileAsync('dart', ['format', path], {
        cwd: root,
        env: await childEnv(),
        timeout: 30_000
      })
      return { ok: true, content: await readFile(path, 'utf8'), tool: 'dart format' }
    } catch (err) {
      const e = err as { stderr?: string; message: string }
      return { ok: false, error: (e.stderr || e.message).trim().slice(0, 400) }
    }
  }

  if (extension === 'py') {
    const ruff = (await hasBin(root, 'ruff')) ?? 'ruff'
    return runWithStdin(ruff, ['format', '-'], content, root, 'ruff')
  }

  return { ok: false, error: `No formatter for .${extension}` }
}

/**
 * Runs a formatter, feeding content through stdin.
 * `execFile` cannot do that, so spawn is used directly.
 */
async function runWithStdin(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  tool: string
): Promise<FormatResult> {
  const env = await childEnv()
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (err) => resolve({ ok: false, error: err.message }))
    child.on('close', (code) => {
      if (code === 0 && stdout) resolve({ ok: true, content: stdout, tool })
      else resolve({ ok: false, error: (stderr || `exit code ${code}`).trim().slice(0, 400) })
    })

    child.stdin.end(input)
  })
}

/** Whether anything can format this file, so the UI does not offer the impossible. */
export async function canFormat(root: string, path: string): Promise<boolean> {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  if (PRETTIER_EXTENSIONS.has(extension)) return Boolean(await hasBin(root, 'prettier'))
  if (extension === 'dart' || extension === 'py') return true
  return false
}
