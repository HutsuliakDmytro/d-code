import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { FILE_HISTORY_DIR, readBackup } from './file-history'

export interface CheckpointFile {
  path: string
  displayPath: string
  backupFileName: string | null
  version: number
}

export interface Checkpoint {
  /** UUID of the user message the snapshot was taken before. */
  messageId: string
  timestamp: string
  /** Text of that message — how the checkpoint is recognised in the UI. */
  label?: string
  files: CheckpointFile[]
}

interface RawBackup {
  backupFileName?: string | null
  version?: number
  realParentDir?: string
}

function resolvePath(trackingPath: string, realParentDir?: string): string {
  if (isAbsolute(trackingPath)) return trackingPath
  return realParentDir ? join(realParentDir, trackingPath) : trackingPath
}

/**
 * Points files can be rolled back to.
 *
 * The CLI snapshots state before every user message: in the transcript that is a
 * `file-history-snapshot` whose `messageId` matches the message's uuid. All that is
 * left is matching snapshots to message text so they can be recognised.
 */
export async function listCheckpoints(transcriptPath: string): Promise<Checkpoint[]> {
  const snapshots: Checkpoint[] = []
  /** Message uuid → its text, used to label the checkpoint. */
  const labels = new Map<string, string>()

  const rl = createInterface({
    input: createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  for await (const raw of rl) {
    if (!raw.trim()) continue
    let line: Record<string, unknown>
    try {
      line = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    if (line.type === 'user' && line.isMeta !== true) {
      const message = line.message as { content?: unknown } | undefined
      if (typeof message?.content === 'string' && typeof line.uuid === 'string') {
        labels.set(line.uuid, message.content)
      }
      continue
    }

    if (line.type !== 'file-history-snapshot') continue
    const snapshot = line.snapshot as
      | { trackedFileBackups?: Record<string, RawBackup>; timestamp?: string }
      | undefined
    const backups = Object.entries(snapshot?.trackedFileBackups ?? {})
    // A snapshot with no backups means nothing had changed at that point.
    if (backups.length === 0) continue

    snapshots.push({
      messageId: String(line.messageId ?? ''),
      timestamp: snapshot?.timestamp ?? '',
      files: backups.map(([trackingPath, backup]) => ({
        path: resolvePath(trackingPath, backup.realParentDir),
        displayPath: trackingPath,
        backupFileName: backup.backupFileName ?? null,
        version: backup.version ?? 1
      }))
    })
  }

  for (const checkpoint of snapshots) {
    const label = labels.get(checkpoint.messageId)
    if (label) checkpoint.label = label.replace(/\s+/g, ' ').trim().slice(0, 100)
  }

  // Newest first — those are the ones people return to. Sorting by timestamp
  // rather than reversing file order: the CLI writes snapshots as it goes, but a
  // resumed session appends turns whose snapshots carry earlier timestamps, so
  // file order and chronology genuinely diverge.
  return snapshots.sort((a, b) => {
    const left = Date.parse(a.timestamp)
    const right = Date.parse(b.timestamp)
    // Snapshots without a usable timestamp keep their relative file order.
    if (!Number.isFinite(left) || !Number.isFinite(right)) return 0
    return right - left
  })
}

export interface RestoreResult {
  ok: boolean
  restored: string[]
  failed: Array<{ path: string; error: string }>
  /** Previous content of each file, so the restore can be undone. */
  previous: Record<string, string>
}

/**
 * Restores every file in a checkpoint to its saved state.
 *
 * This overwrites working files, so it may only be called after explicit
 * confirmation. The previous content is returned so the UI can offer an undo.
 */
export async function restoreCheckpoint(
  sessionId: string,
  files: CheckpointFile[]
): Promise<RestoreResult> {
  const result: RestoreResult = { ok: true, restored: [], failed: [], previous: {} }

  for (const file of files) {
    if (!file.backupFileName) {
      // The file did not exist before this point — there is nothing to roll back to.
      result.failed.push({ path: file.displayPath, error: 'created after this point' })
      result.ok = false
      continue
    }

    const backup = await readBackup(sessionId, file.backupFileName)
    if (backup === undefined) {
      result.failed.push({ path: file.displayPath, error: 'backup not found' })
      result.ok = false
      continue
    }

    const current = await readFile(file.path, 'utf8').catch(() => undefined)
    try {
      await writeFile(file.path, backup, 'utf8')
      if (current !== undefined) result.previous[file.path] = current
      result.restored.push(file.displayPath)
    } catch (err) {
      result.failed.push({ path: file.displayPath, error: (err as Error).message })
      result.ok = false
    }
  }

  return result
}

/** The session's backup directory, surfaced in the UI for diagnostics. */
export function checkpointDir(sessionId: string): string {
  return join(FILE_HISTORY_DIR, sessionId)
}
