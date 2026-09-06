import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, File, Clock, ChevronRight, CornerDownLeft } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

export interface Command {
  id: string
  label: string
  category: string
  /** Shortcut hint as plain text — the binding itself is registered in App. */
  hint?: string
  run: () => void
  /** A command can be unavailable depending on state. */
  enabled?: boolean
}

type Mode = 'commands' | 'files' | 'recent'

/** Fuzzy match: query characters in order, with a bonus for prefix hits. */
function score(needle: string, haystack: string): number {
  const lower = haystack.toLowerCase()
  const tail = lower.lastIndexOf('/') + 1
  let total = 0
  let cursor = 0
  let previous = -1

  for (const char of needle) {
    const index = lower.indexOf(char, cursor)
    if (index === -1) return 0
    total += 1
    if (index >= tail) total += 2
    if (index === previous + 1) total += 3
    if (index === tail || index === 0) total += 4
    previous = index
    cursor = index + 1
  }
  return total + Math.max(0, 20 - haystack.length / 8)
}

/**
 * One window for commands, files and recents.
 *
 * The first character picks the mode, the way editors do it: an empty query lists
 * commands, `>` also means commands, and plain text searches files. That keeps
 * three separate dialogs with three separate shortcuts off the screen.
 */
export default function CommandPalette({
  open,
  initialMode,
  commands,
  onClose
}: {
  open: boolean
  initialMode: Mode
  commands: Command[]
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const { root, recent, openFile } = useWorkspaceStore()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery(initialMode === 'files' ? '' : initialMode === 'recent' ? '' : '')
    setIndex(0)
  }, [open, initialMode])

  useEffect(() => {
    if (!open || !root || initialMode === 'commands') return
    void window.claudeUI.projectFiles(root).then(setFiles)
  }, [open, root, initialMode])

  // Mode is set on open, but `>` switches to commands on the fly.
  const mode: Mode = query.startsWith('>') ? 'commands' : initialMode

  const items = useMemo(() => {
    const needle = query.replace(/^>/, '').trim().toLowerCase()

    if (mode === 'commands') {
      const available = commands.filter((c) => c.enabled !== false)
      if (!needle) return available.map((c) => ({ kind: 'command' as const, command: c }))
      return available
        .map((c) => ({ command: c, value: score(needle, `${c.category} ${c.label}`) }))
        .filter((m) => m.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((m) => ({ kind: 'command' as const, command: m.command }))
    }

    const pool = mode === 'recent' ? recent.map((p) => relativeTo(root, p)) : files
    if (!needle) return pool.slice(0, 40).map((path) => ({ kind: 'file' as const, path }))
    return pool
      .map((path) => ({ path, value: score(needle, path) }))
      .filter((m) => m.value > 0)
      .sort((a, b) => b.value - a.value || a.path.length - b.path.length)
      .slice(0, 40)
      .map((m) => ({ kind: 'file' as const, path: m.path }))
  }, [mode, query, commands, files, recent, root])

  useEffect(() => setIndex(0), [query, mode])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  function choose(item: (typeof items)[number]): void {
    if (item.kind === 'command') item.command.run()
    else if (root) void openFile(`${root}/${item.path}`)
    onClose()
  }

  const placeholder =
    mode === 'commands'
      ? t('Command…')
      : initialMode === 'recent'
        ? t('Recent files…')
        : t('Project file… (> for commands)')

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[92%] max-h-[62vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
          {mode === 'commands' ? (
            <ChevronRight size={14} className="text-[var(--color-accent)]" />
          ) : initialMode === 'recent' ? (
            <Clock size={14} className="text-[var(--color-muted)]" />
          ) : (
            <Search size={14} className="text-[var(--color-muted)]" />
          )}
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (items.length === 0) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => (i + 1) % items.length)
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => (i - 1 + items.length) % items.length)
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                choose(items[index])
              }
            }}
            placeholder={placeholder}
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-muted)]"
          />
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {items.length === 0 && (
            <p className="px-3 py-3 text-[11.5px] text-[var(--color-muted)]">{t('Nothing found.')}</p>
          )}

          {items.map((item, i) => (
            <button
              key={item.kind === 'command' ? item.command.id : item.path}
              data-active={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(item)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                i === index ? 'bg-[var(--color-surface-2)]' : ''
              }`}
            >
              {item.kind === 'command' ? (
                <>
                  <span className="text-[9.5px] uppercase text-[var(--color-muted)] w-[52px] shrink-0">
                    {item.command.category}
                  </span>
                  <span className="text-[12px] truncate flex-1">{item.command.label}</span>
                  {item.command.hint && (
                    <span className="text-[9.5px] font-mono text-[var(--color-muted)] shrink-0">
                      {item.command.hint}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <File size={11} className="text-[var(--color-muted)] shrink-0" />
                  <span className="text-[11.5px] font-mono truncate">{item.path}</span>
                </>
              )}
              {i === index && (
                <CornerDownLeft size={10} className="text-[var(--color-muted)] shrink-0" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function relativeTo(root: string | undefined, path: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}
