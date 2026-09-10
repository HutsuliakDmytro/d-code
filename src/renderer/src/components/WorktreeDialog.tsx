import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  FolderTree,
  Loader2,
  Lock,
  MessageSquarePlus,
  Plus,
  Trash2,
  X
} from 'lucide-react'
import type { GitBranch, Worktree } from '@shared/ipc'
import { useChatStore } from '../store/chat-store'
import { useSettingsStore } from '../store/settings-store'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/**
 * Mirrors `defaultWorktreePath` in the main process.
 *
 * Duplicated rather than round-tripped over IPC so the field can fill in as the
 * user types; the main process still decides where the worktree really lands.
 */
function suggestPath(root: string, branch: string): string {
  if (!root || !branch) return ''
  const sep = root.includes('\\') ? '\\' : '/'
  const parts = root.split(/[/\\]/)
  const name = parts.pop() ?? ''
  return [...parts, `${name}-${branch.replace(/[/\\]/g, '-')}`].join(sep)
}

function Row({
  tree,
  root,
  busy,
  onOpen,
  onSession,
  onRemove
}: {
  tree: Worktree
  root: string
  busy: boolean
  onOpen: (path: string) => void
  onSession: (path: string) => void
  onRemove: (tree: Worktree) => void
}): React.JSX.Element {
  const t = useTranslate()
  const isCurrent = tree.path === root

  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)]
                    last:border-0 hover:bg-[var(--color-surface-2)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] truncate">
            {tree.branch ?? `${t('detached')} ${tree.head?.slice(0, 7) ?? ''}`}
          </span>
          {tree.isMain && (
            <span className="text-[9px] text-[var(--color-muted)] shrink-0">{t('main tree')}</span>
          )}
          {isCurrent && <Check size={10} className="text-emerald-400 shrink-0" />}
          {tree.locked && (
            <span title={tree.lockReason} className="shrink-0">
              <Lock size={9} className="text-amber-400" />
            </span>
          )}
          {tree.prunable && (
            <span className="text-[9px] text-red-400 shrink-0">{t('directory missing')}</span>
          )}
        </div>
        <p className="text-[9.5px] font-mono text-[var(--color-muted)] truncate">{tree.path}</p>
      </div>

      {(tree.sessionCount ?? 0) > 0 && (
        <span className="text-[9.5px] text-[var(--color-muted)] tabular-nums shrink-0">
          {tree.sessionCount}
        </span>
      )}

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100
                      focus-within:opacity-100 transition-opacity">
        <button
          onClick={() => onSession(tree.path)}
          disabled={busy || tree.prunable}
          title={t('Start a session here')}
          className="p-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
        >
          <MessageSquarePlus size={11} />
        </button>
        <button
          onClick={() => onOpen(tree.path)}
          disabled={busy || tree.prunable}
          title={t('Open in the file tree')}
          className="p-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30"
        >
          <FolderTree size={11} />
        </button>
        <button
          onClick={() => onRemove(tree)}
          disabled={busy || tree.isMain}
          title={tree.isMain ? t('The main worktree cannot be removed') : t('Remove worktree')}
          className="p-1 rounded hover:bg-[var(--color-surface)] disabled:opacity-30
                     hover:text-red-400"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

/**
 * Worktrees of the current repository.
 *
 * The point is running several agents at once: each worktree is its own
 * checkout of the same repository, so two conversations can edit two branches
 * without touching each other's files.
 */
export default function WorktreeDialog({
  root,
  open,
  onClose
}: {
  root: string
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const setRoot = useWorkspaceStore((s) => s.setRoot)
  const start = useChatStore((s) => s.start)
  const { model, permissionMode, effort } = useSettingsStore()

  const [trees, setTrees] = useState<Worktree[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [branch, setBranch] = useState('')
  const [path, setPath] = useState('')
  const [pathTouched, setPathTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [confirming, setConfirming] = useState<Worktree>()

  const refresh = useCallback(async () => {
    const [treeList, branchList] = await Promise.all([
      window.claudeUI.listWorktrees(root),
      window.claudeUI.gitBranches(root)
    ])
    setTrees(treeList)
    setBranches(branchList)
  }, [root])

  useEffect(() => {
    if (!open) return
    setError(undefined)
    setBranch('')
    setPath('')
    setPathTouched(false)
    setConfirming(undefined)
    void refresh()
  }, [open, refresh])

  // The path field follows the branch name until the user edits it by hand.
  useEffect(() => {
    if (!pathTouched) setPath(suggestPath(root, branch.trim()))
  }, [branch, root, pathTouched])

  if (!open) return null

  // Whether the branch already exists decides between `worktree add -b` and a
  // plain checkout. Local branches, not just the ones a worktree holds: git
  // refuses to create a branch that exists but sits in no worktree.
  const localBranches = new Set(branches.filter((b) => !b.remote).map((b) => b.name))
  const branchExists = localBranches.has(branch.trim())
  // A branch already checked out somewhere cannot be taken by a second tree.
  const checkedOut = trees.some((tr) => tr.branch === branch.trim())

  async function create(): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      const result = await window.claudeUI.addWorktree(root, {
        path: path.trim(),
        branch: branch.trim(),
        // An existing branch is checked out; anything else is created.
        createBranch: !branchExists
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setBranch('')
      setPathTouched(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function remove(tree: Worktree, force: boolean): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      const result = await window.claudeUI.removeWorktree(root, tree.path, force)
      if (!result.ok) {
        setError(result.error)
        // git refuses while the tree is dirty; that is worth asking about rather
        // than forcing, so the confirmation stays open with the reason shown.
        return
      }
      setConfirming(undefined)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  async function startSession(cwd: string): Promise<void> {
    setBusy(true)
    setError(undefined)
    try {
      await start(cwd, { model, permissionMode, effort })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function openTree(treePath: string): void {
    setRoot(treePath)
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[560px] max-w-[94%] max-h-[80vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <FolderTree size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px]">{t('Worktrees')}</span>
          {busy && <Loader2 size={12} className="animate-spin text-[var(--color-muted)]" />}
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {trees.length === 0 && (
            <p className="px-4 py-3 text-[11px] text-[var(--color-muted)]">
              {t('No worktrees — this directory is not a git repository.')}
            </p>
          )}
          {trees.map((tree) => (
            <Row
              key={tree.path}
              tree={tree}
              root={root}
              busy={busy}
              onOpen={openTree}
              onSession={(p) => void startSession(p)}
              onRemove={setConfirming}
            />
          ))}
        </div>

        {confirming && (
          <div className="shrink-0 px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface-2)]">
            <p className="text-[11px] flex items-center gap-1.5">
              <AlertTriangle size={11} className="text-amber-400 shrink-0" />
              {t('Remove {path}?', { path: confirming.path })}
            </p>
            <div className="mt-1.5 flex gap-2">
              <button
                onClick={() => void remove(confirming, false)}
                disabled={busy}
                className="px-2 py-0.5 rounded text-[11px] bg-[var(--color-accent-soft)]
                           hover:bg-[var(--color-accent)]/30 disabled:opacity-40"
              >
                {t('Remove')}
              </button>
              <button
                onClick={() => void remove(confirming, true)}
                disabled={busy}
                title={t('Discards uncommitted changes in that directory')}
                className="px-2 py-0.5 rounded text-[11px] text-red-400
                           hover:bg-[var(--color-surface)] disabled:opacity-40"
              >
                {t('Remove and discard changes')}
              </button>
              <button
                onClick={() => setConfirming(undefined)}
                className="ml-auto px-2 py-0.5 rounded text-[11px] hover:bg-[var(--color-surface)]"
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        )}

        <div className="shrink-0 px-4 py-2.5 border-t border-[var(--color-border)] space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder={t('Branch name')}
              className="flex-1 min-w-0 bg-[var(--color-surface-2)] border border-[var(--color-border)]
                         rounded px-2 py-1 text-[11px] outline-none focus:border-[var(--color-accent)]
                         placeholder:text-[var(--color-muted)]"
            />
            <button
              onClick={() => void create()}
              disabled={busy || !branch.trim() || !path.trim() || checkedOut}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px]
                         bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/30
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={11} />
              {branchExists ? t('Check out') : t('Create')}
            </button>
          </div>

          <input
            value={path}
            onChange={(e) => {
              setPathTouched(true)
              setPath(e.target.value)
            }}
            placeholder={t('Directory for the worktree')}
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                       rounded px-2 py-1 text-[10.5px] font-mono outline-none
                       focus:border-[var(--color-accent)] placeholder:text-[var(--color-muted)]"
          />

          <p className="text-[9.5px] text-[var(--color-muted)] leading-snug">
            {checkedOut
              ? t('This branch is already checked out in another worktree.')
              : branchExists
                ? t('This branch exists — it will be checked out into the new directory.')
                : t('A sibling directory, so the worktree stays out of the repository’s own listings.')}
          </p>

          {error && <p className="text-[10px] text-red-400 line-clamp-3">{error}</p>}
        </div>
      </div>
    </div>
  )
}
