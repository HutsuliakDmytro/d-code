import { useState } from 'react'
import { GitPullRequest, ExternalLink } from 'lucide-react'
import type { SessionPullRequest } from '@shared/types'
import { useTranslate } from '../i18n'

/**
 * Pull requests opened during a session.
 *
 * The CLI records the session-to-PR link itself, which is the only way to tell
 * what a long conversation actually produced. One real session accumulated 83
 * distinct PRs, so listing them inline is not an option — the metadata strip has
 * no room. The newest one is shown; the rest open on click.
 */
export default function SessionPullRequests({
  items
}: {
  items: SessionPullRequest[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useTranslate()
  if (items.length === 0) return <></>

  // Highest number wins: transcript order says nothing about which PR is newest.
  const sorted = [...items].sort((a, b) => b.number - a.number)
  const latest = sorted[0]

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => items.length > 1 && setOpen(!open)}
        title={
          items.length > 1
            ? t('{count} pull requests in this session', { count: items.length })
            : `${latest.repository} #${latest.number}`
        }
        className="flex items-center gap-1 hover:text-[var(--color-text)] transition-colors"
      >
        <GitPullRequest size={10} className="text-emerald-400" />
        <span>#{latest.number}</span>
        {items.length > 1 && <span className="opacity-60">+{items.length - 1}</span>}
      </button>

      {open && (
        <>
          {/* Click-away closes the list; a dedicated button would be clutter. */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-40 w-[320px] max-h-[280px] overflow-y-auto
                       bg-[var(--color-surface)] border border-[var(--color-border)]
                       rounded-md shadow-2xl py-1"
          >
            <p className="px-2 py-1 text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
              {t('{count} pull requests', { count: items.length })}
            </p>
            {sorted.map((pr) => (
              <a
                key={pr.number}
                href={pr.url}
                title={pr.url}
                className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-[var(--color-surface-2)]
                           transition-colors"
              >
                <GitPullRequest size={9} className="text-emerald-400 shrink-0" />
                <span className="text-[10.5px] shrink-0">#{pr.number}</span>
                <span className="text-[10px] text-[var(--color-muted)] truncate flex-1">
                  {pr.repository}
                </span>
                <ExternalLink size={8} className="text-[var(--color-muted)] shrink-0" />
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
