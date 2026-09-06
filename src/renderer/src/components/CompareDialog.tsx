import { useEffect, useMemo, useState } from 'react'
import { GitFork, X, ArrowRight, Loader2 } from 'lucide-react'
import type { ComparedMessage, SessionComparison, SessionListItem } from '@shared/ipc'
import { useAppStore } from '../store/app-store'
import { relativeTime } from '../lib/format'
import { useTranslate } from '../i18n'

function Branch({
  title,
  messages
}: {
  title: string
  messages: ComparedMessage[]
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="shrink-0 px-3 py-1.5 border-b border-[var(--color-border)]">
        <p className="text-[11px] truncate">{title}</p>
        <p className="text-[9.5px] text-[var(--color-muted)]">{t('{count} messages', { count: messages.length })}</p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <p className="px-3 py-2 text-[10.5px] text-[var(--color-muted)]">
            {t('This branch went no further than the common point.')}
          </p>
        )}
        {messages.map((message, index) => (
          <div key={index} className="px-3 py-1.5 border-b border-[var(--color-border)] last:border-0">
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-[9px] uppercase shrink-0 ${
                  message.role === 'user' ? 'text-blue-400' : 'text-[var(--color-accent)]'
                }`}
              >
                {message.role === 'user' ? t('you') : t('claude')}
              </span>
              <span className="text-[9px] text-[var(--color-muted)]">
                {relativeTime(message.timestamp)}
              </span>
            </div>
            <p className="text-[10.5px] text-neutral-300 line-clamp-3 leading-snug">
              {message.text || t('(no text)')}
            </p>
            {message.toolNames.length > 0 && (
              <p className="text-[9px] font-mono text-[var(--color-muted)] truncate">
                {message.toolNames.join(', ')}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Compares two sessions.
 *
 * The main case is branches created by `--fork-session`: both inherit the same
 * history, and what matters is how they diverge after the fork point.
 */
export default function CompareDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const { groups, selected } = useAppStore()
  const [otherId, setOtherId] = useState<string>()
  const [result, setResult] = useState<SessionComparison>()
  const [loading, setLoading] = useState(false)

  const candidates = useMemo(() => {
    const all = groups.flatMap((g) => g.sessions)
    // Comparing only makes sense within a single project.
    return all.filter(
      (s) =>
        s.meta.sessionId !== selected?.meta.sessionId &&
        s.meta.projectPath === selected?.meta.projectPath
    )
  }, [groups, selected])

  useEffect(() => {
    if (!open) {
      setResult(undefined)
      setOtherId(undefined)
    }
  }, [open])

  useEffect(() => {
    if (!open || !selected || !otherId) return
    const other = candidates.find((c) => c.meta.sessionId === otherId)
    if (!other) return

    setLoading(true)
    void window.claudeUI
      .compareSessions(
        {
          filePath: selected.meta.filePath,
          projectPath: selected.meta.projectPath,
          encodedDir: selected.meta.encodedDir
        },
        {
          filePath: other.meta.filePath,
          projectPath: other.meta.projectPath,
          encodedDir: other.meta.encodedDir
        }
      )
      .then(setResult)
      .finally(() => setLoading(false))
  }, [open, selected, otherId, candidates])

  if (!open) return null

  const other: SessionListItem | undefined = candidates.find((c) => c.meta.sessionId === otherId)

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[860px] max-w-[94%] h-[70vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <GitFork size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px]">{t('Compare branches')}</span>
          {loading && <Loader2 size={12} className="animate-spin text-[var(--color-muted)]" />}
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)]">
          <span className="text-[11px] truncate flex-1">{selected?.meta.title}</span>
          <ArrowRight size={12} className="text-[var(--color-muted)] shrink-0" />
          <select
            value={otherId ?? ''}
            onChange={(e) => setOtherId(e.target.value || undefined)}
            className="flex-1 min-w-0 bg-[var(--color-surface-2)] border border-[var(--color-border)]
                       rounded px-2 py-1 text-[11px] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">{t('Pick a second session…')}</option>
            {candidates.map((c) => (
              <option key={c.meta.sessionId} value={c.meta.sessionId}>
                {c.meta.title}
              </option>
            ))}
          </select>
        </div>

        {result && (
          <div className="shrink-0 px-4 py-1.5 border-b border-[var(--color-border)]">
            {result.commonLength > 0 ? (
              <p className="text-[10.5px] text-[var(--color-muted)]">
                {t('Shared messages')}: {result.commonLength}
                {result.divergedAt && (
                  <>
                    {' '}
                    · {t('diverged after')} «{result.divergedAt.text.slice(0, 60)}»
                  </>
                )}
                {result.isPrefix && ` · ${t('one branch is a full prefix of the other')}`}
              </p>
            ) : (
              <p className="text-[10.5px] text-amber-400">
                {t('No shared prefix — these are independent sessions, not branches.')}
              </p>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 flex divide-x divide-[var(--color-border)]">
          {result ? (
            <>
              <Branch title={selected?.meta.title ?? t('this session')} messages={result.left} />
              <Branch title={other?.meta.title ?? t('second session')} messages={result.right} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[11.5px] text-[var(--color-muted)]">
              {candidates.length === 0
                ? t('No other sessions in this project to compare with.')
                : t('Pick a second session.')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
