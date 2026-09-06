import { useEffect, useMemo, useState } from 'react'
import { Activity, ChevronDown, ChevronRight, Database } from 'lucide-react'
import type { ActivityStats as Stats } from '@shared/ipc'
import { compactNumber, projectName } from '../lib/format'
import { useTranslate } from '../i18n'

const RANGE_DAYS = 30
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** Daily token bars. Hand-rolled SVG — a charting library would be dead weight here. */
function DayChart({ days }: { days: Stats['days'] }): React.JSX.Element | null {
  const t = useTranslate()
  // Fill gaps so idle days show up as gaps rather than disappearing.
  const filled = useMemo(() => {
    if (days.length === 0) return []
    const byDate = new Map(days.map((d) => [d.date, d]))
    const out: Array<{ date: string; outputTokens: number; requests: number }> = []
    const start = new Date()
    start.setDate(start.getDate() - RANGE_DAYS + 1)
    for (let i = 0; i < RANGE_DAYS; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const pad = (n: number): string => String(n).padStart(2, '0')
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const hit = byDate.get(key)
      out.push({ date: key, outputTokens: hit?.outputTokens ?? 0, requests: hit?.requests ?? 0 })
    }
    return out
  }, [days])

  if (filled.length === 0) return null
  const max = Math.max(1, ...filled.map((d) => d.outputTokens))

  return (
    <div>
      <div className="flex items-end gap-[2px] h-[52px]">
        {filled.map((d) => {
          const height = d.outputTokens === 0 ? 0 : Math.max(2, (d.outputTokens / max) * 52)
          const weekday = WEEKDAYS[new Date(d.date).getDay()]
          return (
            <div
              key={d.date}
              title={`${d.date} (${weekday}) · ${compactNumber(d.outputTokens)} out · ${d.requests} ${t('requests')}`}
              className="flex-1 min-w-[3px] bg-[var(--color-accent)] rounded-sm transition-opacity hover:opacity-70"
              style={{ height: `${height}px`, opacity: d.outputTokens === 0 ? 0.12 : 1 }}
            />
          )
        })}
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-[var(--color-muted)]">
        <span>{t('{days} days ago', { days: RANGE_DAYS })}</span>
        <span>{t('today')}</span>
      </div>
    </div>
  )
}

function Bar({
  label,
  value,
  max,
  hint,
  tone
}: {
  label: string
  value: number
  max: number
  hint?: string
  tone?: string
}): React.JSX.Element {
  return (
    <div title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] truncate">{label}</span>
        <span className="text-[10px] tabular-nums text-[var(--color-muted)] shrink-0">
          {compactNumber(value)}
        </span>
      </div>
      <div className="h-[3px] rounded-full bg-[var(--color-surface-2)] overflow-hidden mt-0.5">
        <div
          className={`h-full ${tone ?? 'bg-[var(--color-accent)]'}`}
          style={{ width: `${max === 0 ? 0 : (value / max) * 100}%` }}
        />
      </div>
    </div>
  )
}

/** Last 30 days of activity: trend, tools, projects and cache savings. */
export default function ActivityStats(): React.JSX.Element | null {
  const t = useTranslate()
  const [stats, setStats] = useState<Stats>()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || stats) return
    void window.claudeUI.getActivityStats(RANGE_DAYS).then(setStats)
  }, [open, stats])

  const topTools = stats?.tools.slice(0, 8) ?? []
  const topProjects = stats?.projects.slice(0, 5) ?? []
  const maxTool = Math.max(1, ...topTools.map((t) => t.count))
  const maxProject = Math.max(1, ...topProjects.map((p) => p.outputTokens))

  // How much context came from cache instead of being paid for again.
  const cacheRatio =
    stats && stats.cacheReadTokens + stats.cacheCreationTokens > 0
      ? (stats.cacheReadTokens / (stats.cacheReadTokens + stats.cacheCreationTokens)) * 100
      : 0

  return (
    <section className="pt-1 border-t border-[var(--color-border)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 mb-1.5 text-[10px] uppercase tracking-wide
                   text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Activity size={10} />
        {t('Activity')}
      </button>

      {open && (
        <div className="space-y-3">
          {!stats && <p className="text-[11px] text-[var(--color-muted)]">{t('Counting…')}</p>}

          {stats && (
            <>
              <DayChart days={stats.days} />

              {topTools.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
                    {t('Tools')}
                  </p>
                  {topTools.map((tool) => (
                    <Bar
                      key={tool.name}
                      label={tool.name}
                      value={tool.count}
                      max={maxTool}
                      hint={`${tool.count} ${t('calls')}${tool.errors ? `, ${tool.errors} ${t('failed')}` : ''}`}
                      tone={tool.errors > 0 ? 'bg-amber-500' : undefined}
                    />
                  ))}
                </div>
              )}

              {topProjects.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
                    {t('Projects')}
                  </p>
                  {topProjects.map((p) => (
                    <Bar
                      key={p.projectPath}
                      label={projectName(p.projectPath)}
                      value={p.outputTokens}
                      max={maxProject}
                      hint={`${p.projectPath} · ${p.requests} ${t('requests')}`}
                    />
                  ))}
                </div>
              )}

              <div
                className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]"
                title={t('Share of input context read from cache instead of being written again')}
              >
                <Database size={10} />
                {t('cache covers {percent}% of context', { percent: cacheRatio.toFixed(0) })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
