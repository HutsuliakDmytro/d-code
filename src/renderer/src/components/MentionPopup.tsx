import { useEffect, useMemo, useState } from 'react'
import { File } from 'lucide-react'

/** Fuzzy match: query characters in order, with a bonus for hits in the file name. */
function score(needle: string, path: string): number {
  const lower = path.toLowerCase()
  const nameStart = lower.lastIndexOf('/') + 1
  let total = 0
  let cursor = 0
  let previous = -1

  for (const char of needle) {
    const index = lower.indexOf(char, cursor)
    if (index === -1) return 0
    total += 1
    if (index >= nameStart) total += 2
    if (index === previous + 1) total += 3
    if (index === nameStart) total += 4
    previous = index
    cursor = index + 1
  }
  return total + Math.max(0, 20 - path.length / 8)
}

/**
 * File suggestions for `@` mentions.
 *
 * Inserts a relative path: the model has Read and will open the file itself.
 */
export default function MentionPopup({
  root,
  query,
  onPick,
  onClose
}: {
  root?: string
  query: string
  onPick: (relativePath: string) => void
  onClose: () => void
}): React.JSX.Element | null {
  const [files, setFiles] = useState<string[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (!root) return
    void window.claudeUI.projectFiles(root).then(setFiles)
  }, [root])

  const matches = useMemo(() => {
    const needle = query.toLowerCase().replace(/\s+/g, '')
    if (!needle) return files.slice(0, 12)
    return files
      .map((path) => ({ path, value: score(needle, path) }))
      .filter((m) => m.value > 0)
      .sort((a, b) => b.value - a.value || a.path.length - b.path.length)
      .slice(0, 12)
      .map((m) => m.path)
  }, [files, query])

  useEffect(() => setActive(0), [query])

  // Keyboard navigation has to work while focus stays in the input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (matches.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((i) => (i + 1) % matches.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((i) => (i - 1 + matches.length) % matches.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        onPick(matches[active])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [matches, active, onPick, onClose])

  if (!root || matches.length === 0) return null

  return (
    <div
      className="absolute bottom-full mb-1 left-0 right-0 max-h-[220px] overflow-y-auto
                 bg-[var(--color-surface)] border border-[var(--color-border)]
                 rounded-lg shadow-2xl z-20 py-1"
    >
      {matches.map((path, i) => (
        <button
          key={path}
          onMouseEnter={() => setActive(i)}
          onClick={() => onPick(path)}
          className={`w-full flex items-center gap-1.5 px-3 py-1 text-left transition-colors ${
            i === active ? 'bg-[var(--color-surface-2)]' : ''
          }`}
        >
          <File size={10} className="shrink-0 text-[var(--color-muted)]" />
          <span className="text-[11px] font-mono truncate">{path}</span>
        </button>
      ))}
    </div>
  )
}
