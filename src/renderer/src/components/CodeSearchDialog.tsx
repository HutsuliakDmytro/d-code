import { useEffect, useMemo, useRef, useState } from 'react'
import { Code2, Loader2, X, CaseSensitive } from 'lucide-react'
import type { CodeSearchHit } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/** Search across project code — separate from searching chat history. */
export default function CodeSearchDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const { root, openFile } = useWorkspaceStore()
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [hits, setHits] = useState<CodeSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    if (!open || !root) return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const id = ++requestId.current
    setSearching(true)
    const timer = setTimeout(() => {
      void window.claudeUI.searchCode(root, q, caseSensitive).then((result) => {
        if (id !== requestId.current) return
        setHits(result)
        setSearching(false)
      })
    }, 220)
    return () => clearTimeout(timer)
  }, [query, caseSensitive, open, root])

  const grouped = useMemo(() => {
    const map = new Map<string, CodeSearchHit[]>()
    for (const h of hits) {
      const list = map.get(h.relativePath)
      if (list) list.push(h)
      else map.set(h.relativePath, [h])
    }
    return [...map.entries()]
  }, [hits])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[680px] max-w-[92%] bg-[var(--color-surface)] border border-[var(--color-border)]
                   rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[72vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
          <Code2 size={14} className="text-[var(--color-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder={root ? t('Search project code…') : t('Select a session first')}
            disabled={!root}
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-muted)]"
          />
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            title={t('Match case')}
            className={`p-1 rounded transition-colors ${
              caseSensitive
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'hover:bg-[var(--color-surface-2)]'
            }`}
          >
            <CaseSensitive size={13} />
          </button>
          {searching && <Loader2 size={13} className="animate-spin text-[var(--color-muted)]" />}
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        {hits.length > 0 && (
          <div className="px-3 py-1 border-b border-[var(--color-border)] text-[10.5px] text-[var(--color-muted)]">
            {t('{hits} matches in {files} files', { hits: hits.length, files: grouped.length })}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {query.trim().length >= 2 && !searching && hits.length === 0 && (
            <p className="px-3 py-4 text-[11.5px] text-[var(--color-muted)]">{t('Nothing found.')}</p>
          )}

          {grouped.map(([path, fileHits]) => (
            <div key={path} className="border-b border-[var(--color-border)] last:border-0">
              <div className="px-3 pt-2 pb-1 text-[11px] font-mono truncate text-[var(--color-accent)]">
                {path}
              </div>
              {fileHits.slice(0, 12).map((hit, i) => (
                <button
                  key={`${hit.line}-${i}`}
                  onClick={() => {
                    void openFile(hit.path, hit.line)
                    onClose()
                  }}
                  className="w-full flex items-baseline gap-2 px-3 py-[3px] text-left
                             hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <span className="text-[9.5px] text-[var(--color-muted)] shrink-0 w-8 text-right">
                    {hit.line}
                  </span>
                  <span className="text-[11px] font-mono truncate text-neutral-300">
                    {hit.matchStart >= 0 ? (
                      <>
                        {hit.text.slice(0, hit.matchStart)}
                        <mark className="bg-[var(--color-accent)]/40 text-[var(--color-text)] rounded-sm">
                          {hit.text.slice(hit.matchStart, hit.matchStart + hit.matchLength)}
                        </mark>
                        {hit.text.slice(hit.matchStart + hit.matchLength)}
                      </>
                    ) : (
                      hit.text
                    )}
                  </span>
                </button>
              ))}
              {fileHits.length > 12 && (
                <p className="px-3 pb-1 text-[10px] text-[var(--color-muted)]">
                  {t('…{count} more', { count: fileHits.length - 12 })}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
