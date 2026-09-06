import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Braces, FunctionSquare, Hash, Search, Type, X } from 'lucide-react'
import type { CodeSymbol } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

const ICONS: Record<CodeSymbol['kind'], React.ReactNode> = {
  function: <FunctionSquare size={11} className="text-violet-400" />,
  method: <FunctionSquare size={11} className="text-violet-400" />,
  class: <Box size={11} className="text-amber-400" />,
  widget: <Box size={11} className="text-blue-400" />,
  interface: <Braces size={11} className="text-emerald-400" />,
  type: <Type size={11} className="text-emerald-400" />,
  enum: <Hash size={11} className="text-blue-400" />,
  const: <Hash size={11} className="text-[var(--color-muted)]" />
}

/** Go to a symbol in the current file (⌘⇧O). */
export default function SymbolPalette({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const active = useWorkspaceStore((s) => s.openFiles.find((f) => f.path === s.activePath))
  const openFile = useWorkspaceStore((s) => s.openFile)
  const [symbols, setSymbols] = useState<CodeSymbol[]>([])
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !active) return
    setQuery('')
    setIndex(0)
    void window.claudeUI
      .fileSymbols(active.content.language, active.draft ?? active.content.content)
      .then(setSymbols)
  }, [open, active])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return symbols
    return symbols.filter((s) => s.name.toLowerCase().includes(needle))
  }, [symbols, query])

  useEffect(() => setIndex(0), [query])

  // The active row must stay visible while scrolling with the keyboard.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  if (!open) return null

  function pick(symbol: CodeSymbol): void {
    if (active) void openFile(active.path, symbol.line)
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-[92%] max-h-[60vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
          <Search size={13} className="text-[var(--color-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (matches.length === 0) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => (i + 1) % matches.length)
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => (i - 1 + matches.length) % matches.length)
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                pick(matches[index])
              }
            }}
            placeholder={active ? t('Go to symbol…') : t('Open a file first')}
            disabled={!active}
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-muted)]"
          />
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {active && symbols.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">
              {t('No symbols found in this file.')}
            </p>
          )}
          {matches.map((symbol, i) => (
            <button
              key={`${symbol.name}-${symbol.line}`}
              data-active={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => pick(symbol)}
              className={`w-full flex items-center gap-2 px-3 py-1 text-left transition-colors ${
                i === index ? 'bg-[var(--color-surface-2)]' : ''
              }`}
              style={{ paddingLeft: `${12 + Math.min(symbol.depth, 4) * 10}px` }}
            >
              {ICONS[symbol.kind]}
              <span className="text-[11.5px] font-mono truncate">{symbol.name}</span>
              <span className="ml-auto text-[9.5px] text-[var(--color-muted)] shrink-0">
                {symbol.line}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
