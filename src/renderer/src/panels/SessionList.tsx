import { useMemo } from 'react'
import { ChevronDown, ChevronRight, Search, Circle, GitBranch, Bot, Plus, Radio } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { compactNumber, projectName, relativeTime } from '../lib/format'
import type { SessionListItem } from '@shared/ipc'
import { useTranslate } from '../i18n'

function SessionRow({
  item,
  active,
  onSelect
}: {
  item: SessionListItem
  active: boolean
  onSelect: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { meta, usage, subagentCount } = item
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-md transition-colors group ${
        active ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface-2)]'
      }`}
    >
      <div className="flex items-center gap-1.5">
        {meta.live && (
          // Green dot means a CLI process is running right now.
          <Circle
            size={7}
            className="shrink-0 fill-emerald-400 text-emerald-400"
            aria-label={t('Active: {status}', { status: meta.live.status })}
          />
        )}
        <span
          className={`truncate text-[12.5px] ${active ? 'text-[var(--color-text)]' : 'text-neutral-300'}`}
        >
          {meta.title}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1 text-[10.5px] text-[var(--color-muted)]">
        <span>{relativeTime(meta.updatedAt)}</span>
        <span>·</span>
        <span>{t('{count} msg', { count: meta.messageCount })}</span>
        {usage.outputTokens > 0 && (
          <>
            <span>·</span>
            <span>{compactNumber(usage.outputTokens)} out</span>
          </>
        )}
        {meta.bridgeSessionId && (
          <span
            className="flex items-center gap-0.5 text-violet-400"
            title={t('Remote Control was enabled for this session')}
          >
            <Radio size={10} />
          </span>
        )}
        {subagentCount > 0 && (
          <span className="flex items-center gap-0.5" title={t('{count} subagents', { count: subagentCount })}>
            <Bot size={10} />
            {subagentCount}
          </span>
        )}
        {meta.gitBranch && meta.gitBranch !== 'HEAD' && (
          <span className="flex items-center gap-0.5 truncate" title={meta.gitBranch}>
            <GitBranch size={10} />
            {meta.gitBranch}
          </span>
        )}
      </div>
    </button>
  )
}

export default function SessionList({
  onNewSession,
  onSearch
}: {
  onNewSession: () => void
  onSearch: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { groups, loadingSessions, selected, query, collapsedProjects } = useAppStore()
  const { selectSession, setQuery, toggleProject } = useAppStore()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((g) => ({
        ...g,
        sessions: g.sessions.filter(
          (s) =>
            s.meta.title.toLowerCase().includes(q) ||
            s.meta.projectPath.toLowerCase().includes(q) ||
            s.meta.lastPrompt?.toLowerCase().includes(q)
        )
      }))
      .filter((g) => g.sessions.length > 0)
  }, [groups, query])

  const totalSessions = groups.reduce((n, g) => n + g.sessions.length, 0)

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)]">
      <div className="px-3 pb-2">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 mb-2 rounded-md text-[11.5px]
                     bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/30 transition-colors"
        >
          <Plus size={12} />
          {t('New session')}
        </button>
        <div className="relative">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Filter by title…')}
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md
                       pl-8 pr-14 py-1.5 text-[12px] outline-none focus:border-[var(--color-accent)]
                       placeholder:text-[var(--color-muted)]"
          />
          <button
            onClick={onSearch}
            title={t('Search across all session content (⌘F)')}
            className="absolute right-1 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded text-[9.5px]
                       text-[var(--color-muted)] hover:text-[var(--color-text)]
                       hover:bg-[var(--color-surface)] transition-colors"
          >
            ⌘F
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {loadingSessions && (
          <div className="px-3 py-2 text-[11.5px] text-[var(--color-muted)]">{t('Reading history…')}</div>
        )}

        {!loadingSessions && filtered.length === 0 && (
          <div className="px-3 py-2 text-[11.5px] text-[var(--color-muted)]">
            {totalSessions === 0 ? t('No sessions found') : t('Nothing found')}
          </div>
        )}

        {filtered.map((group) => {
          const collapsed = collapsedProjects.has(group.projectPath)
          return (
            <div key={group.projectPath} className="mb-1">
              <button
                onClick={() => toggleProject(group.projectPath)}
                className="w-full flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium
                           text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                title={group.projectPath}
              >
                {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="truncate">{projectName(group.projectPath)}</span>
                <span className="ml-auto tabular-nums">{group.sessions.length}</span>
              </button>

              {!collapsed && (
                <div className="space-y-0.5">
                  {group.sessions.map((s) => (
                    <SessionRow
                      key={s.meta.sessionId}
                      item={s}
                      active={selected?.meta.sessionId === s.meta.sessionId}
                      onSelect={() => void selectSession(s)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
