import { access, constants, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { shell } from 'electron'

export interface OpResult {
  ok: boolean
  error?: string
  /** New path after creation or rename. */
  path?: string
}

/**
 * Keeps operations inside the project.
 *
 * The tree accepts names from the user, and a `../` in one would turn a safe
 * operation into a write anywhere on the filesystem.
 */
function ensureInside(root: string, target: string): string | undefined {
  const absolute = resolve(target)
  const rel = relative(resolve(root), absolute)
  if (rel.startsWith('..') || resolve(root) === absolute) return undefined
  return absolute
}

function invalidName(name: string): string | undefined {
  if (!name.trim()) return 'Empty name'
  if (name.includes('/') || name.includes('\\')) return 'Name cannot contain path separators'
  if (name === '.' || name === '..') return 'Invalid name'
  return undefined
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function createFile(
  root: string,
  dirPath: string,
  name: string
): Promise<OpResult> {
  const nameError = invalidName(name)
  if (nameError) return { ok: false, error: nameError }

  const target = ensureInside(root, join(dirPath, name))
  if (!target) return { ok: false, error: 'Path is outside the project' }
  if (await exists(target)) return { ok: false, error: 'That file already exists' }

  try {
    await mkdir(dirname(target), { recursive: true })
    // `wx` guarantees we do not clobber a file created between check and write.
    await writeFile(target, '', { flag: 'wx' })
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function createDirectory(
  root: string,
  dirPath: string,
  name: string
): Promise<OpResult> {
  const nameError = invalidName(name)
  if (nameError) return { ok: false, error: nameError }

  const target = ensureInside(root, join(dirPath, name))
  if (!target) return { ok: false, error: 'Path is outside the project' }
  if (await exists(target)) return { ok: false, error: 'That directory already exists' }

  try {
    await mkdir(target, { recursive: false })
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function renamePath(
  root: string,
  path: string,
  newName: string
): Promise<OpResult> {
  const nameError = invalidName(newName)
  if (nameError) return { ok: false, error: nameError }

  const source = ensureInside(root, path)
  if (!source) return { ok: false, error: 'Path is outside the project' }

  const target = ensureInside(root, join(dirname(source), newName))
  if (!target) return { ok: false, error: 'Path is outside the project' }
  if (source === target) return { ok: true, path: target }
  if (await exists(target)) return { ok: false, error: 'That name is already taken' }

  try {
    await rename(source, target)
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Deletion goes to the trash, not away for good.
 *
 * A tree is exactly where a misclick happens, and an irreversible `rm -rf` in such
 * an interface costs far too much.
 */
export async function movePathToTrash(root: string, path: string): Promise<OpResult> {
  const target = ensureInside(root, path)
  if (!target) return { ok: false, error: 'Path is outside the project' }

  try {
    await stat(target)
  } catch {
    return { ok: false, error: 'The file no longer exists' }
  }

  try {
    await shell.trashItem(target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Drag-and-drop move: the file lands in another directory of the same project. */
export async function movePath(
  root: string,
  path: string,
  targetDir: string
): Promise<OpResult> {
  const source = ensureInside(root, path)
  if (!source) return { ok: false, error: 'Path is outside the project' }

  const directory = ensureInside(root, targetDir) ?? resolve(root)
  const target = join(directory, source.split('/').at(-1) ?? '')
  if (source === target) return { ok: true, path: target }

  // A directory cannot be moved inside itself.
  if (target.startsWith(`${source}/`)) {
    return { ok: false, error: 'Cannot move a directory into itself' }
  }
  if (await exists(target)) return { ok: false, error: 'That folder already has such a file' }

  try {
    await rename(source, target)
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Removes empty directories left behind by moves. Invoked manually. */
export async function removeEmptyDir(root: string, path: string): Promise<OpResult> {
  const target = ensureInside(root, path)
  if (!target) return { ok: false, error: 'Path is outside the project' }
  try {
    await rm(target, { recursive: false })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
