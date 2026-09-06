import { readFile, writeFile } from 'node:fs/promises'
import { searchCode, type CodeSearchHit } from './files'

export interface ReplacePreviewFile {
  path: string
  relativePath: string
  /** How many occurrences will be replaced in this file. */
  count: number
  /** Sample lines: before and after. */
  samples: Array<{ line: number; before: string; after: string }>
}

export interface ReplacePreview {
  files: ReplacePreviewFile[]
  total: number
  /** Set when the regular expression is invalid. */
  error?: string
}

export interface ReplaceOptions {
  root: string
  query: string
  replacement: string
  caseSensitive?: boolean
  useRegex?: boolean
}

/** Escapes a string so it can be used as a literal pattern. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPattern(opts: ReplaceOptions): RegExp | { error: string } {
  const source = opts.useRegex ? opts.query : escapeRegExp(opts.query)
  const flags = opts.caseSensitive ? 'g' : 'gi'
  try {
    return new RegExp(source, flags)
  } catch (err) {
    return { error: `Invalid expression: ${(err as Error).message}` }
  }
}

const MAX_SAMPLES = 3

/**
 * Shows what would change, without touching the disk.
 *
 * A project-wide replace cannot be undone in one move, so a preview is always
 * computed and shown first.
 */
export async function previewReplace(opts: ReplaceOptions): Promise<ReplacePreview> {
  const pattern = buildPattern(opts)
  if ('error' in pattern) return { files: [], total: 0, error: pattern.error }

  // Candidates come from the ordinary search: fast and .gitignore-aware.
  const probe = opts.useRegex ? extractLiteral(opts.query) : opts.query
  const hits: CodeSearchHit[] = probe
    ? await searchCode(opts.root, probe, { caseSensitive: opts.caseSensitive, limit: 5000 })
    : []

  const byFile = new Map<string, string>()
  for (const hit of hits) byFile.set(hit.path, hit.relativePath)

  const files: ReplacePreviewFile[] = []
  let total = 0

  for (const [path, relativePath] of byFile) {
    const content = await readFile(path, 'utf8').catch(() => undefined)
    if (content === undefined) continue

    const lines = content.split('\n')
    const samples: ReplacePreviewFile['samples'] = []
    let count = 0

    lines.forEach((line, index) => {
      pattern.lastIndex = 0
      const matches = line.match(pattern)
      if (!matches) return
      count += matches.length
      if (samples.length < MAX_SAMPLES) {
        samples.push({
          line: index + 1,
          before: line.slice(0, 300),
          after: line.replace(pattern, opts.replacement).slice(0, 300)
        })
      }
    })

    if (count > 0) {
      files.push({ path, relativePath, count, samples })
      total += count
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  return { files, total }
}

/**
 * For a regex query this takes the longest literal chunk — enough to narrow the
 * set of files before the exact check.
 */
function extractLiteral(source: string): string {
  const parts = source.split(/[\\^$.|?*+()[\]{}]/).filter((p) => p.length >= 2)
  return parts.sort((a, b) => b.length - a.length)[0] ?? ''
}

export interface ReplaceResult {
  ok: boolean
  changedFiles: number
  replacements: number
  failed: Array<{ path: string; error: string }>
}

/** Applies the replacement to the given files. Only call after a preview. */
export async function applyReplace(
  opts: ReplaceOptions & { paths: string[] }
): Promise<ReplaceResult> {
  const pattern = buildPattern(opts)
  if ('error' in pattern) {
    return { ok: false, changedFiles: 0, replacements: 0, failed: [{ path: '', error: pattern.error }] }
  }

  const result: ReplaceResult = { ok: true, changedFiles: 0, replacements: 0, failed: [] }

  for (const path of opts.paths) {
    const content = await readFile(path, 'utf8').catch(() => undefined)
    if (content === undefined) {
      result.failed.push({ path, error: 'could not be read' })
      result.ok = false
      continue
    }

    pattern.lastIndex = 0
    const matches = content.match(pattern)
    if (!matches?.length) continue

    try {
      await writeFile(path, content.replace(pattern, opts.replacement), 'utf8')
      result.changedFiles++
      result.replacements += matches.length
    } catch (err) {
      result.failed.push({ path, error: (err as Error).message })
      result.ok = false
    }
  }

  return result
}
