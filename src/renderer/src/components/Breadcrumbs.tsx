import { useEffect, useState } from 'react'
import { ChevronRight, ArrowLeft, ArrowRight, Box, FunctionSquare } from 'lucide-react'
import type { CodeSymbol } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/**
 * File path plus the symbol the cursor currently sits in.
 *
 * The symbol is derived with the same rules as the go-to-symbol palette. Without
 * a language server this is an approximation, but it is enough to stay oriented
 * inside a large file.
 */
export default function Breadcrumbs({
  relativePath,
  language,
  content,
  line,
  onPickSymbol
}: {
  relativePath: string
  language: string
  content: string
  /** Line the cursor is on. */
  line?: number
  onPickSymbol: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { canGoBack, canGoForward, goBack, goForward } = useWorkspaceStore()
  const [symbols, setSymbols] = useState<CodeSymbol[]>([])

  useEffect(() => {
    let cancelled = false
    // Debounced: recomputing symbols on every keystroke is wasted work.
    const timer = setTimeout(() => {
      void window.claudeUI.fileSymbols(language, content).then((next) => {
        if (!cancelled) setSymbols(next)
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [language, content])

  const current = line
    ? symbols.reduce<CodeSymbol | undefined>(
        (best, symbol) => (symbol.line <= line ? symbol : best),
        undefined
      )
    : undefined

  const segments = relativePath.split('/')

  return (
    <div className="flex items-center gap-1 min-w-0 text-[10px] text-[var(--color-muted)]">
      <button
        onClick={goBack}
        disabled={!canGoBack()}
        title={t('Back (⌃-)')}
        className="p-0.5 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-25
                   disabled:cursor-not-allowed transition-colors"
      >
        <ArrowLeft size={11} />
      </button>
      <button
        onClick={goForward}
        disabled={!canGoForward()}
        title={t('Forward (⌃⇧-)')}
        className="p-0.5 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-25
                   disabled:cursor-not-allowed transition-colors"
      >
        <ArrowRight size={11} />
      </button>

      <div className="flex items-center gap-0.5 min-w-0 overflow-hidden">
        {segments.map((segment, i) => (
          <span key={i} className="flex items-center gap-0.5 shrink-0 last:min-w-0">
            {i > 0 && <ChevronRight size={9} className="opacity-60" />}
            <span className={i === segments.length - 1 ? 'text-[var(--color-text)] truncate' : ''}>
              {segment}
            </span>
          </span>
        ))}

        {current && (
          <>
            <ChevronRight size={9} className="opacity-60 shrink-0" />
            <button
              onClick={onPickSymbol}
              title={t('Go to symbol (⌘⇧O)')}
              className="flex items-center gap-1 shrink-0 hover:text-[var(--color-text)] transition-colors"
            >
              {current.kind === 'class' || current.kind === 'widget' ? (
                <Box size={9} className="text-amber-400" />
              ) : (
                <FunctionSquare size={9} className="text-violet-400" />
              )}
              <span className="font-mono">{current.name}</span>
            </button>
          </>
        )}
      </div>
    </div>
  )
}
