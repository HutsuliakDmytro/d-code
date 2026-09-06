import { access, readdir } from 'node:fs/promises'
import { CLAUDE_CONFIG, PROJECTS_DIR } from '../src/main/store/project-paths'
import { resolveClaudePath } from '../src/main/claude/resolve-cli'

/**
 * Detection of a real Claude Code installation.
 *
 * A good part of this suite runs against actual transcripts rather than fixtures:
 * the CLI's format shifts between versions, and a fixture frozen today would keep
 * passing long after the real format has moved on. The trade-off is that those
 * tests need data only a machine that has used the CLI can have.
 *
 * On a fresh clone or a CI runner there is none, so they skip instead of failing.
 * A red suite on first `npm test` says nothing true about the code.
 */

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Whether `~/.claude.json` is present — the CLI's own project registry. */
export const hasClaudeConfig = await exists(CLAUDE_CONFIG)

/** Whether there are transcripts to read. */
export const hasTranscripts = await (async () => {
  const dirs = await readdir(PROJECTS_DIR).catch(() => [])
  return dirs.length > 0
})()

/**
 * Whether the `claude` binary resolves to a real path.
 *
 * `resolveClaudePath` falls back to the bare name when it finds nothing, which is
 * exactly the case where the resolution tests have nothing to assert about.
 */
export const hasClaudeBinary = await (async () => {
  const path = await resolveClaudePath().catch(() => 'claude')
  return path.startsWith('/') || /^[A-Za-z]:\\/.test(path)
})()

/** True when every local prerequisite is in place. */
export const hasLocalClaudeData = hasClaudeConfig && hasTranscripts
