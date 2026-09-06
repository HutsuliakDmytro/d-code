import { MAX_IMAGE_BYTES, type Attachment } from '@shared/types'
import { tr } from '../i18n'

const IMAGE_MIME = /^image\/(png|jpeg|jpg|gif|webp)$/

function newId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Reads a Blob/File into base64 without the data-URL prefix. */
function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error(tr('Could not read the file')))
    reader.readAsDataURL(file)
  })
}

export interface ConvertResult {
  attachments: Attachment[]
  errors: string[]
}

/**
 * Turns clipboard or drag-and-drop payloads into attachments.
 *
 * Images are read in the renderer: a screenshot pasted from the clipboard has no
 * path on disk, so main cannot reach it. Other files need the opposite — a path,
 * which `getPathForFile` provides.
 */
export async function filesToAttachments(files: File[]): Promise<ConvertResult> {
  const attachments: Attachment[] = []
  const errors: string[] = []

  for (const file of files) {
    const isImage = IMAGE_MIME.test(file.type)

    if (isImage) {
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(`${file.name || tr('image')}: ${tr('larger than 5 MB')}`)
        continue
      }
      try {
        attachments.push({
          id: newId(),
          name: file.name || tr('pasted image.png'),
          kind: 'image',
          size: file.size,
          mediaType: file.type,
          base64: await toBase64(file)
        })
      } catch {
        errors.push(`${file.name || tr('image')}: ${tr('could not be read')}`)
      }
      continue
    }

    // For regular files a path is enough — the model will read them itself.
    const path = window.claudeUI.getPathForFile(file)
    if (!path) {
      errors.push(`${file.name}: ${tr('unknown path, attach via the button')}`)
      continue
    }
    attachments.push({ id: newId(), name: file.name, kind: 'file', size: file.size, path })
  }

  return { attachments, errors }
}

/** Extracts files from a paste event; empty array when it carries only text. */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) out.push(file)
  }
  return out
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
