import { useWorkspaceStore } from '../store/workspace-store'
import SessionList from './SessionList'
import FileTree from './FileTree'
import GitPanel from './GitPanel'
import TasksPanel from './TasksPanel'
import ProblemsPanel from './ProblemsPanel'

/** Left panel body for the active mode. The mode strip itself lives in ActivityBar. */
export default function Sidebar({
  onNewSession,
  onSearch,
  onCompareBranches
}: {
  onNewSession: () => void
  onSearch: () => void
  onCompareBranches: () => void
}): React.JSX.Element {
  const tab = useWorkspaceStore((s) => s.tab)

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] border-r border-[var(--color-border)] min-w-0">
      {/*
        Clearance for the macOS window controls. Done once for every mode: when
        each panel handled it individually, the ones that forgot slid under the
        traffic lights.
      */}
      <div className="titlebar-drag h-[38px] shrink-0" />

      <div className="flex-1 min-h-0">
        {tab === 'sessions' && <SessionList onNewSession={onNewSession} onSearch={onSearch} />}
        {tab === 'files' && <FileTree />}
        {tab === 'git' && <GitPanel onCompareBranches={onCompareBranches} />}
        {tab === 'tasks' && <TasksPanel />}
        {tab === 'problems' && <ProblemsPanel />}
      </div>
    </div>
  )
}
