import { shell } from 'electron'
import { runInTerminal, shellQuote } from '../system/platform'

/**
 * Session actions that reach outside our process: opening a terminal, stopping
 * someone else's CLI, revealing files in the file manager.
 */

/** Opens a session in a terminal via `claude --resume`. */
export async function openSessionInTerminal(cwd: string, sessionId?: string): Promise<void> {
  const parts = [`cd ${shellQuote(cwd)}`, sessionId ? `claude --resume ${sessionId}` : 'claude']
  await runInTerminal(parts.join(' && '))
}

/**
 * Starts an interactive session with Remote Control enabled.
 *
 * The `--remote-control` flag works ONLY for interactive sessions — it cannot be
 * turned on for an already running headless process, which is what our chat uses.
 * So this always spawns a new terminal process rather than toggling the current one.
 */
export async function startRemoteControlSession(cwd: string, name?: string): Promise<void> {
  const flag = name ? `--remote-control ${shellQuote(name)}` : '--remote-control'
  await runInTerminal(`cd ${shellQuote(cwd)} && claude ${flag}`)
}

/**
 * Asks someone else's CLI process to exit. SIGTERM rather than SIGKILL: the CLI
 * needs a moment to finish writing its transcript.
 */
export function stopProcess(pid: number): { ok: boolean; error?: string } {
  try {
    process.kill(pid, 'SIGTERM')
    return { ok: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // ESRCH means the process is already gone — from the user's side that is success.
    if (code === 'ESRCH') return { ok: true }
    if (code === 'EPERM') return { ok: false, error: 'not permitted to stop this process' }
    return { ok: false, error: (err as Error).message }
  }
}

export function revealInFinder(path: string): void {
  shell.showItemInFolder(path)
}

export async function openPath(path: string): Promise<string> {
  return shell.openPath(path)
}
