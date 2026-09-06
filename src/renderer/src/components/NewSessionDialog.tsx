import { useEffect, useMemo, useState } from 'react'
import { FolderSearch, GitBranch, Plus, Search, X, AlertTriangle } from 'lucide-react'
import type { WorkspaceEntry } from '@shared/ipc'
import { useChatStore } from '../store/chat-store'
import { useSettingsStore } from '../store/settings-store'
import { relativeTime } from '../lib/format'
import { useTranslate } from '../i18n'

/**
 * Picks the working directory for a new session.
 *
 * The list holds directories Claude Code has already worked in — the CLI keeps no
 * other registry of "repositories". Any other folder can be picked manually.
 */
export default function NewSessionDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const start = useChatStore((s) => s.start)
  const { model, permissionMode, effort } = useSettingsStore()

  useEffect(() => {
    if (!open) return
    setError(undefined)
    void window.claudeUI.listWorkspaces().then(setWorkspaces)
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter(
      (w) => w.name.toLowerCase().includes(q) || w.path.toLowerCase().includes(q)
    )
  }, [workspaces, query])

  if (!open) return null

  async function launch(cwd: string): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      // Without resumeSessionId the CLI starts a fresh session under our UUID.
      await start(cwd, { model, permissionMode, effort })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function browse(): Promise<void> {
    const picked = await window.claudeUI.pickDirectory()
    if (picked) await launch(picked)
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-[92%] bg-[var(--color-surface)] border border-[var(--color-border)]
                   rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <Plus size={15} className="text-[var(--color-accent)]" />
          <span className="text-[13px] flex-1">{t('New session')}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Filter by name or path…')}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                         rounded-md pl-8 pr-2 py-1.5 text-[12px] outline-none
                         focus:border-[var(--color-accent)] placeholder:text-[var(--color-muted)]"
            />
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-4 py-3 text-[11.5px] text-[var(--color-muted)]">
              {t('Nothing found. Pick a folder manually below.')}
            </p>
          )}
          {filtered.map((w) => (
            <button
              key={w.path}
              disabled={busy || !w.exists}
              onClick={() => void launch(w.path)}
              className="w-full text-left px-4 py-2 hover:bg-[var(--color-surface-2)]
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] truncate">{w.name}</span>
                {w.gitBranch && (
                  <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-muted)] shrink-0">
                    <GitBranch size={9} />
                    {w.gitBranch}
                  </span>
                )}
                {!w.exists && (
                  <span className="flex items-center gap-0.5 text-[10px] text-amber-400 shrink-0">
                    <AlertTriangle size={9} />
                    {t('folder is gone')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-[var(--color-muted)] mt-0.5">
                <span className="truncate">{w.path}</span>
                {w.sessionCount > 0 && <span className="shrink-0">· {t('{count} sessions', { count: w.sessionCount })}</span>}
                {w.lastUsedAt && <span className="shrink-0">· {relativeTime(w.lastUsedAt)}</span>}
              </div>
            </button>
          ))}
        </div>

        {error && <p className="px-4 py-2 text-[11px] text-red-400">{error}</p>}

        <div className="px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={() => void browse()}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md text-[12px]
                       border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]
                       disabled:opacity-40 transition-colors"
          >
            <FolderSearch size={13} />
            {t('Choose another folder…')}
          </button>
          <p className="mt-2 text-[10px] text-[var(--color-muted)]">
            {t('Model')}: {model || t('default')} · {t('permissions')}: {permissionMode}
          </p>
        </div>
      </div>
    </div>
  )
}
