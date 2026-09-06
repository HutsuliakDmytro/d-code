import { useMemo } from 'react'
import { collapseUnchanged, diffLines, diffStats } from '../lib/diff'
import { useTranslate } from '../i18n'

/** Line-by-line diff with unchanged stretches collapsed. */
export default function DiffView({
  before,
  after,
  context = 3,
  maxHeight = '340px'
}: {
  before: string
  after: string
  context?: number
  maxHeight?: string
}): React.JSX.Element {
  const t = useTranslate()
  const { chunks, stats } = useMemo(() => {
    const rows = diffLines(before, after)
    return { chunks: collapseUnchanged(rows, context), stats: diffStats(rows) }
  }, [before, after, context])

  if (chunks.length === 0) {
    return <p className="text-[11px] text-[var(--color-muted)]">{t('Contents are identical.')}</p>
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1 text-[10px]">
        <span className="text-emerald-400">+{stats.added}</span>
        <span className="text-red-400">−{stats.removed}</span>
      </div>

      <pre
        className="text-[10.5px] font-mono leading-relaxed overflow-auto rounded
                   bg-[var(--color-bg)] border border-[var(--color-border)]"
        style={{ maxHeight }}
      >
        {chunks.map((chunk, chunkIndex) => (
          <div key={chunkIndex}>
            {chunk.skipped > 0 && (
              <div className="px-2 py-0.5 text-[9.5px] text-[var(--color-muted)] bg-[var(--color-surface)]">
                ⋯ {t('{count} identical lines', { count: chunk.skipped })}
              </div>
            )}
            {chunk.rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className={`flex ${
                  row.kind === 'added'
                    ? 'bg-emerald-950/40 text-emerald-300'
                    : row.kind === 'removed'
                      ? 'bg-red-950/40 text-red-300'
                      : 'text-neutral-400'
                }`}
              >
                <span className="shrink-0 w-9 px-1 text-right text-[9px] text-[var(--color-muted)] select-none">
                  {row.oldLine ?? ''}
                </span>
                <span className="shrink-0 w-9 px-1 text-right text-[9px] text-[var(--color-muted)] select-none">
                  {row.newLine ?? ''}
                </span>
                <span className="shrink-0 w-3 select-none">
                  {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
                </span>
                <span className="whitespace-pre-wrap break-all pr-2">{row.text}</span>
              </div>
            ))}
          </div>
        ))}
      </pre>
    </div>
  )
}
