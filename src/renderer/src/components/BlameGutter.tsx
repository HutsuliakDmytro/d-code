import { useEffect, useMemo, useState } from 'react'
import type { BlameLine } from '@shared/ipc'
import { relativeTime } from '../lib/format'
import { useTranslate } from '../i18n'

/**
 * Authorship strip to the left of the code.
 *
 * A run of lines from the same commit gets one caption and the rest stay blank —
 * repeating the same name on every line drowns out the code itself.
 */
export default function BlameGutter({
  root,
  path,
  visible
}: {
  root?: string
  path: string
  visible: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const [lines, setLines] = useState<BlameLine[]>()
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!visible || !root) return
    setLines(undefined)
    setError(false)
    void window.claudeUI
      .gitBlame(root, path)
      .then((result) => {
        if (result.length === 0) setError(true)
        setLines(result)
      })
      .catch(() => setError(true))
  }, [visible, root, path])

  /** Colour per author, so someone else's edits stand out at a glance. */
  const colorOf = useMemo(() => {
    const palette = ['#c96442', '#6b8afd', '#4ade80', '#c084fc', '#fbbf24', '#22d3ee']
    const assigned = new Map<string, string>()
    return (author: string): string => {
      const existing = assigned.get(author)
      if (existing) return existing
      const color = palette[assigned.size % palette.length]
      assigned.set(author, color)
      return color
    }
  }, [])

  if (!visible) return null

  if (error || (lines && lines.length === 0)) {
    return (
      <div className="shrink-0 w-[150px] border-r border-[var(--color-border)] px-2 py-1">
        <p className="text-[9.5px] text-[var(--color-muted)]">
          {t('Blame unavailable — file is outside git or not committed yet.')}
        </p>
      </div>
    )
  }

  return (
    <div className="shrink-0 w-[150px] border-r border-[var(--color-border)] overflow-hidden">
      <div className="text-[10.5px] font-mono leading-relaxed">
        {lines === undefined && (
          <p className="px-2 py-1 text-[9.5px] text-[var(--color-muted)]">{t('Reading blame…')}</p>
        )}
        {lines?.map((line, index) => {
          const previous = lines[index - 1]
          const sameCommit = previous?.hash === line.hash
          return (
            <div
              key={index}
              title={`${line.author} · ${line.hash.slice(0, 8)} · ${relativeTime(line.date)}`}
              className="px-2 truncate"
              style={{ color: sameCommit ? 'transparent' : colorOf(line.author) }}
            >
              {sameCommit ? '·' : `${line.author.split(' ')[0]} ${relativeTime(line.date)}`}
            </div>
          )
        })}
      </div>
    </div>
  )
}
