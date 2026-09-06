import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, constants } from 'node:fs/promises'
import { log, warn } from '../log'
import {
  IS_WIN,
  PATH_DELIMITER,
  claudeFallbackPaths,
  extraPathDirs,
  loginShell,
  shellArgs,
  whichCommand
} from '../system/platform'

const execFileAsync = promisify(execFile)

let resolved: string | undefined
let resolving: Promise<string> | undefined

async function isExecutable(path: string): Promise<boolean> {
  try {
    // Windows has no executable bit — the extension plays that role, and X_OK in
    // an access check degrades to plain "the file exists".
    await access(path, IS_WIN ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Absolute path to `claude`.
 *
 * Launched from the Dock or Finder, the app inherits a trimmed PATH with neither
 * `~/.local/bin` nor homebrew on it. That makes `spawn('claude')` fail with ENOENT
 * even though the same command works in a terminal. So the path is resolved once
 * through a login shell, which knows the user's real PATH.
 */
export function resolveClaudePath(): Promise<string> {
  if (resolved) return Promise.resolve(resolved)
  if (resolving) return resolving

  resolving = (async () => {
    try {
      const { stdout } = await execFileAsync(
        loginShell(),
        shellArgs(whichCommand('claude')),
        { timeout: 8000 }
      )
      const path = stdout.trim().split('\n').pop()?.trim()
      if (path && (await isExecutable(path))) {
        resolved = path
        log('[cli] found claude:', path)
        return path
      }
    } catch {
      // The shell may have failed to start or found nothing — try known locations.
    }

    for (const candidate of claudeFallbackPaths()) {
      if (await isExecutable(candidate)) {
        resolved = candidate
        log('[cli] found claude in a standard location:', candidate)
        return candidate
      }
    }

    // Fall back to the bare name: if PATH turns out to be enough, it will work.
    warn('[cli] claude not found — relying on PATH')
    resolved = 'claude'
    return resolved
  })()

  return resolving
}

/**
 * The user's full PATH for child processes.
 *
 * The CLI runs tools of its own (git, node, tests) and they need a sane PATH too,
 * otherwise they fail from inside the session.
 */
let shellPath: string | undefined

export async function resolveShellPath(): Promise<string> {
  if (shellPath) return shellPath
  try {
    // Windows hands processes the full PATH — asking a shell adds nothing.
    if (IS_WIN) throw new Error('on Windows the PATH comes from the process')
    const { stdout } = await execFileAsync(loginShell(), ['-lc', 'echo -n $PATH'], { timeout: 8000 })
    const value = stdout.trim()
    if (value) {
      shellPath = value
      return value
    }
  } catch {
    // Below: a fallback built from the usual directories.
  }

  shellPath = [
    ...new Set([...(process.env.PATH ?? '').split(PATH_DELIMITER), ...extraPathDirs()])
  ]
    .filter(Boolean)
    .join(PATH_DELIMITER)
  return shellPath
}

/** Builds a child-process environment with the full PATH. */
export async function childEnv(
  extra: Record<string, string> = {}
): Promise<NodeJS.ProcessEnv> {
  return { ...process.env, PATH: await resolveShellPath(), ...extra }
}
