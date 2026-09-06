import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, Wrench, Loader2 } from 'lucide-react'
import type { SearchHit } from '@shared/ipc'
import { useAppStore } from '../store/app-store'
import { relativeTime, projectName } from '../lib/format'
import { useTranslate } from '../i18n'

/** Highlights the match inside a snippet without dangerouslySetInnerHTML. */
function Snippet({ hit }: { hit: SearchHit }): React.JSX.Element {
  if (hit.matchStart < 0) return <>{hit.snippet}</>
  const before = hit.snippet.slice(0, hit.matchStart)
  const match = hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)
  const after = hit.snippet.slice(hit.matchStart + hit.matchLength)
  return (
    <>
      {before}
      <mark className="bg-[var(--color-accent)]/40 text-[var(--color-text)] rounded-sm px-0.5">
        {match}
      </mark>
      {after}
    </>
  )
}

/**
 * Full-text search across every transcript — unlike the sidebar filter, which only
 * looks at titles.
 */
export default function SearchDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [includeTools, setIncludeTools] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const { groups, selectSession } = useAppStore()
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    // The search hits the filesystem, so it is not run on every keystroke.
    const id = ++requestId.current
    setSearching(true)
    const timer = setTimeout(() => {
      void window.claudeUI.searchTranscripts(q, includeTools).then((result) => {
        if (id !== requestId.current) return // a stale response arrived
        setHits(result)
        setSearching(false)
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [query, includeTools, open])

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const h of hits) {
      const list = map.get(h.sessionId)
      if (list) list.push(h)
      else map.set(h.sessionId, [h])
    }
    return [...map.entries()]
  }, [hits])

  if (!open) return null

  function openSession(hit: SearchHit): void {
    const item = groups.flatMap((g) => g.sessions).find((s) => s.meta.sessionId === hit.sessionId)
    if (item) void selectSession(item)
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-16 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[92%] bg-[var(--color-surface)] border border-[var(--color-border)]
                   rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
          <Search size={14} className="text-[var(--color-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder={t('Search all history…')}
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-muted)]"
          />
          {searching && <Loader2 size={13} className="animate-spin text-[var(--color-muted)]" />}
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[var(--color-border)]">
          <label className="flex items-center gap-1.5 text-[10.5px] text-[var(--color-muted)] cursor-pointer">
            <input
              type="checkbox"
              checked={includeTools}
              onChange={(e) => setIncludeTools(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            <Wrench size={10} />
            {t('Search inside tool arguments and results')}
          </label>
          {hits.length > 0 && (
            <span className="ml-auto text-[10.5px] text-[var(--color-muted)]">
              {t('{hits} matches in {sessions} sessions', { hits: hits.length, sessions: grouped.length })}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {query.trim().length >= 2 && !searching && hits.length === 0 && (
            <p className="px-3 py-4 text-[11.5px] text-[var(--color-muted)]">{t('Nothing found.')}</p>
          )}

          {grouped.map(([sessionId, sessionHits]) => (
            <div key={sessionId} className="border-b border-[var(--color-border)] last:border-0">
              <div className="px-3 pt-2 pb-1 flex items-baseline gap-2">
                <span className="text-[11.5px] truncate">{sessionHits[0].title}</span>
                <span className="text-[10px] text-[var(--color-muted)] shrink-0">
                  {projectName(sessionHits[0].projectPath)} · {sessionHits.length}
                </span>
              </div>
              {sessionHits.slice(0, 6).map((hit, i) => (
                <button
                  key={`${hit.timestamp}-${i}`}
                  onClick={() => openSession(hit)}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`text-[9.5px] shrink-0 uppercase ${
                        hit.role === 'user' ? 'text-blue-400' : 'text-[var(--color-accent)]'
                      }`}
                    >
                      {hit.role === 'user' ? t('you') : t('claude')}
                    </span>
                    <span className="text-[11px] text-neutral-300 leading-snug">
                      <Snippet hit={hit} />
                    </span>
                  </div>
                  {hit.timestamp && (
                    <span className="text-[9.5px] text-[var(--color-muted)]">
                      {relativeTime(hit.timestamp)}
                    </span>
                  )}
                </button>
              ))}
              {sessionHits.length > 6 && (
                <p className="px-3 pb-2 text-[10px] text-[var(--color-muted)]">
                  {t('…{count} more in this session', { count: sessionHits.length - 6 })}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
