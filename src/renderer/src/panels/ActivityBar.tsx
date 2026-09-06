import { MessagesSquare, Files, GitBranch, Play, TerminalSquare, AlertCircle } from 'lucide-react'
import type { SidebarTab } from '../store/workspace-store'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

const TABS: Array<{ id: SidebarTab; label: string; icon: React.ReactNode }> = [
  { id: 'sessions', label: 'Sessions', icon: <MessagesSquare size={14} /> },
  { id: 'files', label: 'Files', icon: <Files size={14} /> },
  { id: 'git', label: 'Git', icon: <GitBranch size={14} /> },
  { id: 'tasks', label: 'Tasks', icon: <Play size={14} /> },
  { id: 'problems', label: 'Problems', icon: <AlertCircle size={14} /> }
]

/**
 * Narrow mode switcher strip.
 *
 * Deliberately lives outside the collapsible panel: hiding it together with the
 * content would leave nothing to expand the panel with. Clicking the active tab
 * collapses the body, clicking another switches and expands.
 */
export default function ActivityBar({
  collapsed,
  onSelect
}: {
  collapsed: boolean
  onSelect: (tab: SidebarTab) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { tab, git, terminalOpen, toggleTerminal } = useWorkspaceStore()
  const changes = git?.files.length ?? 0

  return (
    <div className="shrink-0 w-[42px] h-full flex flex-col items-center bg-[var(--color-surface)] border-r border-[var(--color-border)]">
      <div className="titlebar-drag h-[38px] w-full" />

      {TABS.map((entry) => {
        const active = tab === entry.id && !collapsed
        return (
          <button
            key={entry.id}
            onClick={() => onSelect(entry.id)}
            title={active ? t('{tab} — hide', { tab: t(entry.label) }) : t(entry.label)}
            className={`relative w-full py-2.5 flex justify-center transition-colors ${
              active
                ? 'text-[var(--color-text)] bg-[var(--color-surface-2)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {active && (
              <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--color-accent)]" />
            )}
            {entry.icon}
            {entry.id === 'git' && changes > 0 && (
              <span
                className="absolute top-1.5 right-2 min-w-[13px] h-[13px] px-[3px] rounded-full
                           bg-[var(--color-accent)] text-[8.5px] leading-[13px] text-center"
              >
                {changes > 99 ? '99' : changes}
              </span>
            )}
          </button>
        )
      })}

      <button
        onClick={toggleTerminal}
        title={t('Terminal (⌃`)')}
        className={`mt-auto w-full py-2.5 mb-2 flex justify-center transition-colors ${
          terminalOpen
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
        }`}
      >
        <TerminalSquare size={14} />
      </button>
    </div>
  )
}
