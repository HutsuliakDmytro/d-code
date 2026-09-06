export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffRow {
  kind: DiffKind
  text: string
  /** Line number in the old version (for removed and same). */
  oldLine?: number
  /** Line number in the new version (for added and same). */
  newLine?: number
}

/**
 * Line-by-line comparison via the longest common subsequence.
 *
 * A naive "line i against line i" comparison turns a single insertion into a solid
 * mismatch stretching to the end of the file. LCS finds the genuinely shared runs,
 * so an insertion stays an insertion.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.length ? before.split('\n') : []
  const b = after.length ? after.split('\n') : []

  // Trim the shared head and tail first: an LCS table over the whole file costs
  // O(n·m) memory, while usually only a handful of lines differ.
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++

  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }

  const rows: DiffRow[] = []
  for (let i = 0; i < start; i++) {
    rows.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: i + 1 })
  }

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  for (const row of lcsDiff(midA, midB, start)) rows.push(row)

  for (let i = endA; i < a.length; i++) {
    rows.push({ kind: 'same', text: a[i], oldLine: i + 1, newLine: i + (b.length - a.length) + 1 })
  }
  return rows
}

/** Table size cap: beyond this, showing blocks beats eating memory. */
const MAX_CELLS = 4_000_000

function lcsDiff(a: string[], b: string[], offset: number): DiffRow[] {
  if (a.length === 0 && b.length === 0) return []

  // For huge changes LCS does not pay off — present it as a full replacement.
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text, i) => ({ kind: 'removed' as const, text, oldLine: offset + i + 1 })),
      ...b.map((text, i) => ({ kind: 'added' as const, text, newLine: offset + i + 1 }))
    ]
  }

  const rows = a.length
  const cols = b.length
  // table[i][j] is the LCS length for the tails a[i..] and b[j..].
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const result: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      result.push({ kind: 'same', text: a[i], oldLine: offset + i + 1, newLine: offset + j + 1 })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: 'removed', text: a[i], oldLine: offset + i + 1 })
      i++
    } else {
      result.push({ kind: 'added', text: b[j], newLine: offset + j + 1 })
      j++
    }
  }
  while (i < rows) result.push({ kind: 'removed', text: a[i], oldLine: offset + i++ + 1 })
  while (j < cols) result.push({ kind: 'added', text: b[j], newLine: offset + j++ + 1 })

  return result
}

export interface DiffChunk {
  rows: DiffRow[]
  /** How many unchanged lines were skipped before this block. */
  skipped: number
}

/**
 * Collapses long identical stretches, keeping context around the changes.
 * Without this, a diff of a large file with one edit is unreadable.
 */
export function collapseUnchanged(rows: DiffRow[], context = 3): DiffChunk[] {
  const keep = new Set<number>()
  rows.forEach((row, index) => {
    if (row.kind === 'same') return
    for (let i = Math.max(0, index - context); i <= Math.min(rows.length - 1, index + context); i++) {
      keep.add(i)
    }
  })

  const chunks: DiffChunk[] = []
  let current: DiffRow[] = []
  let skippedBefore = 0
  let pendingSkip = 0

  for (let index = 0; index < rows.length; index++) {
    if (keep.has(index)) {
      // The first line of a block records how many identical lines it hides.
      if (current.length === 0) skippedBefore = pendingSkip
      current.push(rows[index])
      pendingSkip = 0
      continue
    }
    if (current.length > 0) {
      chunks.push({ rows: current, skipped: skippedBefore })
      current = []
    }
    pendingSkip++
  }

  if (current.length > 0) chunks.push({ rows: current, skipped: skippedBefore })
  return chunks
}

export interface DiffStats {
  added: number
  removed: number
}

export function diffStats(rows: DiffRow[]): DiffStats {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.kind === 'added') added++
    else if (row.kind === 'removed') removed++
  }
  return { added, removed }
}
