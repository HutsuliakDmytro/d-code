import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Search } from 'lucide-react'
import type { SkillEntry } from '@shared/ipc'
import { useTranslate } from '../i18n'

/**
 * Skill menu. The list comes from the CLI's `skill_listing` attachment in the most
 * recent transcript — it already accounts for plugins and availability, so it matches
 * what the model actually sees. Picking one inserts `/name` into the composer rather
 * than running it: arguments are up to the user.
 */
export default function SkillMenu({
  onPick,
  disabled
}: {
  onPick: (skill: string) => void
  disabled?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [query, setQuery] = useState('')
  const [loaded, setLoaded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || loaded) return
    void window.claudeUI.listSkills().then((s) => {
      setSkills(s)
      setLoaded(true)
    })
  }, [open, loaded])

  // Click outside closes the menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
    )
  }, [skills, query])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t('Skills')}
        className="p-1.5 rounded-md hover:bg-[var(--color-surface-2)] disabled:opacity-30
                   disabled:cursor-not-allowed transition-colors"
      >
        <Sparkles size={13} className={open ? 'text-[var(--color-accent)]' : ''} />
      </button>

      {open && (
        <div
          className="absolute bottom-full mb-2 left-0 w-[340px] bg-[var(--color-surface)]
                     border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden z-20"
        >
          <div className="p-2 border-b border-[var(--color-border)]">
            <div className="relative">
              <Search
                size={12}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search skills…')}
                className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                           rounded pl-7 pr-2 py-1 text-[11.5px] outline-none
                           focus:border-[var(--color-accent)]"
              />
            </div>
          </div>

          <div className="max-h-[300px] overflow-y-auto py-1">
            {!loaded && (
              <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">{t('Loading list…')}</p>
            )}
            {loaded && skills.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-[var(--color-muted)] leading-relaxed">
                {t('The skill list is not known yet — it appears in the transcript after the first exchange.')}
              </p>
            )}
            {filtered.map((s) => (
              <button
                key={s.name}
                onClick={() => {
                  onPick(s.name)
                  setOpen(false)
                  setQuery('')
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-2)] transition-colors"
              >
                <div className="text-[11.5px] font-mono text-[var(--color-accent)]">/{s.name}</div>
                {s.description && (
                  <div className="text-[10px] text-[var(--color-muted)] line-clamp-2 leading-snug mt-0.5">
                    {s.description}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
