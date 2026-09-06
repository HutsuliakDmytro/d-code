import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MAX_IMAGE_BYTES, type Attachment } from '@shared/types'

/** Extensions the CLI accepts as images in an `image` block. */
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

export function imageMediaType(nameOrPath: string): string | undefined {
  return IMAGE_TYPES[extname(nameOrPath).toLowerCase()]
}

/**
 * Prepares a file for sending.
 *
 * Images are read into base64 — otherwise the model cannot see them. Everything
 * else travels as a path: the model has Read and will fetch exactly what it needs
 * instead of dragging the whole content into the prompt.
 */
export async function readAttachment(path: string): Promise<Attachment | { error: string }> {
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return { error: 'Not a file' }
    size = info.size
  } catch {
    return { error: 'File is not accessible' }
  }

  const name = basename(path)
  const mediaType = imageMediaType(path)

  if (!mediaType) {
    return { id: randomUUID(), name, kind: 'file', size, path }
  }

  if (size > MAX_IMAGE_BYTES) {
    return { error: `Image too large (${Math.round(size / 1024 / 1024)} MB, limit 5 MB)` }
  }

  try {
    const data = await readFile(path)
    return {
      id: randomUUID(),
      name,
      kind: 'image',
      size,
      mediaType,
      base64: data.toString('base64')
    }
  } catch {
    return { error: 'Could not read the image' }
  }
}
