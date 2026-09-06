import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { CLAUDE_HOME } from './project-paths'

export const FILE_HISTORY_DIR = join(CLAUDE_HOME, 'file-history')

export interface FileVersion {
  version: number
  /** Backup file name (`<hash>@v<N>`). null means the file did not exist before. */
  backupFileName: string | null
  backupTime: string
}

export interface ChangedFile {
  /** Absolute path to the file in the project. */
  path: string
  /** The path as written in the transcript — shorter and clearer for the UI. */
  displayPath: string
  versions: FileVersion[]
  /** The file may have been deleted after the session. */
  exists: boolean
  /** True when the session created the file from scratch (earliest version has no backup). */
  createdBySession: boolean
}

interface RawBackup {
  backupFileName?: string | null
  version?: number
  backupTime?: string
  realParentDir?: string
}

/** `trackingPath` can be relative — `realParentDir` from the same record is the base. */
function resolvePath(trackingPath: string, realParentDir?: string): string {
  if (isAbsolute(trackingPath)) return trackingPath
  return realParentDir ? join(realParentDir, trackingPath) : trackingPath
}

/**
 * Files a session modified.
 *
 * The CLI keeps its own history: every change produces a `file-history-delta`
 * record with a backup of the state BEFORE the edit under
 * `~/.claude/file-history/<session-id>/`. Snapshots (`file-history-snapshot`)
 * duplicate the same information as a map, so both types are read and merged by path.
 */
export async function listChangedFiles(
  transcriptPath: string,
  sessionId: string
): Promise<ChangedFile[]> {
  const byPath = new Map<string, { displayPath: string; versions: Map<number, FileVersion> }>()

  const add = (trackingPath: string, backup: RawBackup): void => {
    if (!trackingPath || typeof backup.version !== 'number') return
    const full = resolvePath(trackingPath, backup.realParentDir)
    let entry = byPath.get(full)
    if (!entry) {
      entry = { displayPath: trackingPath, versions: new Map() }
      byPath.set(full, entry)
    }
    // A version can appear in both a delta and a snapshot — keep one of each.
    entry.versions.set(backup.version, {
      version: backup.version,
      backupFileName: backup.backupFileName ?? null,
      backupTime: backup.backupTime ?? ''
    })
  }

  const rl = createInterface({
    input: createReadStream(transcriptPath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  for await (const raw of rl) {
    // Cheap filter: parsing every line of a long transcript is expensive.
    if (!raw.includes('file-history-')) continue
    let line: Record<string, unknown>
    try {
      line = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    if (line.type === 'file-history-delta') {
      add(String(line.trackingPath ?? ''), (line.backup ?? {}) as RawBackup)
      continue
    }

    if (line.type === 'file-history-snapshot') {
      const snapshot = line.snapshot as { trackedFileBackups?: Record<string, RawBackup> } | undefined
      for (const [path, backup] of Object.entries(snapshot?.trackedFileBackups ?? {})) {
        add(path, backup)
      }
    }
  }

  const files = await Promise.all(
    [...byPath.entries()].map(async ([path, entry]): Promise<ChangedFile> => {
      const versions = [...entry.versions.values()].sort((a, b) => a.version - b.version)
      return {
        path,
        displayPath: entry.displayPath,
        versions,
        exists: await stat(path)
          .then((s) => s.isFile())
          .catch(() => false),
        // No earliest backup means the file did not exist before the session.
        createdBySession: versions[0]?.backupFileName === null
      }
    })
  )

  void sessionId // the backup path only depends on the session when reading content
  return files.sort((a, b) => a.displayPath.localeCompare(b.displayPath))
}

/** Backup content is the file's state BEFORE the corresponding change. */
export async function readBackup(
  sessionId: string,
  backupFileName: string
): Promise<string | undefined> {
  try {
    return await readFile(join(FILE_HISTORY_DIR, sessionId, backupFileName), 'utf8')
  } catch {
    return undefined
  }
}

export async function readCurrent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Restores a file to a backed-up state.
 *
 * This overwrites the working file, so the call assumes the user has already seen
 * the difference and confirmed it. The current content is returned so the UI can
 * offer to undo the restore.
 */
export async function restoreBackup(opts: {
  sessionId: string
  backupFileName: string
  targetPath: string
}): Promise<{ ok: boolean; error?: string; previousContent?: string }> {
  const backup = await readBackup(opts.sessionId, opts.backupFileName)
  if (backup === undefined) {
    return { ok: false, error: 'Backup not found — it may have been cleaned up' }
  }

  const previousContent = await readCurrent(opts.targetPath)
  try {
    await writeFile(opts.targetPath, backup, 'utf8')
    return { ok: true, previousContent }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Restores the content saved before a rollback (the "undo" button). */
export async function writeContent(
  targetPath: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await writeFile(targetPath, content, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
