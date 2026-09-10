import { useEffect, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  History,
  Sparkles,
  ScanEye,
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCcw,
  Archive,
  GitCompare,
  FolderTree
} from 'lucide-react'
import type { GitBranch as Branch, GitCommit, GitFile } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { relativeTime } from '../lib/format'
import CommitDialog from '../components/CommitDialog'
import { useSettingsStore } from '../store/settings-store'
import ConflictResolver from '../components/ConflictResolver'
import WorktreeDialog from '../components/WorktreeDialog'
import type { StashEntry } from '@shared/ipc'
import { useTranslate } from '../i18n'

const STATUS_MARK: Record<GitFile['status'], { char: string; tone: string }> = {
  added: { char: 'A', tone: 'text-emerald-400' },
  modified: { char: 'M', tone: 'text-amber-400' },
  deleted: { char: 'D', tone: 'text-red-400' },
  renamed: { char: 'R', tone: 'text-blue-400' },
  untracked: { char: '?', tone: 'text-[var(--color-muted)]' },
  conflicted: { char: '!', tone: 'text-red-500' }
}

function FileRow({
  file,
  root,
  onDone,
  onConflict
}: {
  file: GitFile
  root: string
  onDone: () => void
  onConflict: (path: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const openFile = useWorkspaceStore((s) => s.openFile)
  const mark = STATUS_MARK[file.status]

  return (
    <div className="group flex items-center gap-1 pr-1 hover:bg-[var(--color-surface-2)]">
      <button
        onClick={() =>
          file.status === 'conflicted' ? onConflict(file.path) : void openFile(file.absolutePath)
        }
        title={file.status === 'conflicted' ? t('Resolve conflict') : file.path}
        className="flex items-center gap-1.5 flex-1 min-w-0 py-[3px] pl-2 text-left"
      >
        <span className={`text-[10px] font-mono w-[9px] shrink-0 ${mark.tone}`}>{mark.char}</span>
        <span className="text-[11px] truncate">{file.path.split('/').at(-1)}</span>
        <span className="text-[9.5px] text-[var(--color-muted)] truncate">
          {file.path.split('/').slice(0, -1).join('/')}
        </span>
      </button>

      <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {file.staged ? (
          <button
            onClick={() =>
              void window.claudeUI.gitUnstage(root, [file.path]).then(onDone)
            }
            title={t('Unstage')}
            className="p-0.5 rounded hover:bg-[var(--color-surface)]"
          >
            <Minus size={11} />
          </button>
        ) : (
          <>
            <button
              onClick={() => void window.claudeUI.gitStage(root, [file.path]).then(onDone)}
              title={t('Stage')}
              className="p-0.5 rounded hover:bg-[var(--color-surface)]"
            >
              <Plus size={11} />
            </button>
            {file.status !== 'untracked' && (
              <button
                onClick={() => {
                  // Discarding is irreversible — ask explicitly.
                  if (!confirm(t('Discard changes in {path}? This cannot be undone.', { path: file.path }))) return
                  void window.claudeUI.gitDiscard(root, [file.path]).then(onDone)
                }}
                title={t('Discard changes')}
                className="p-0.5 rounded hover:bg-[var(--color-surface)] text-red-400"
              >
                <RotateCcw size={11} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function GitPanel({
  onCompareBranches
}: {
  onCompareBranches: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { root, git, gitLoading, refreshGit } = useWorkspaceStore()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [branches, setBranches] = useState<Branch[]>([])
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [openCommit, setOpenCommit] = useState<GitCommit>()
  const [suggesting, setSuggesting] = useState(false)
  const [review, setReview] = useState<string>()
  const [reviewing, setReviewing] = useState(false)
  const model = useSettingsStore((s) => s.model)
  const [remoteBusy, setRemoteBusy] = useState<string>()
  const [progress, setProgress] = useState<string>()
  const [stash, setStash] = useState<StashEntry[]>([])
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [showStash, setShowStash] = useState(false)
  const [conflictPath, setConflictPath] = useState<string>()

  useEffect(() => {
    // Git reports progress in chunks; only the last line matters, the rest is noise.
    return window.claudeUI.onRemoteProgress((text) => {
      const line = text.trim().split('\n').filter(Boolean).at(-1)
      if (line) setProgress(line.slice(0, 120))
    })
  }, [])

  useEffect(() => {
    if (!root || !git?.isRepo) return
    void window.claudeUI.listStash(root).then(setStash)
    void window.claudeUI.gitBranches(root).then(setBranches)
    void window.claudeUI.gitLog(root, 30).then(setCommits)
  }, [root, git?.isRepo, git?.files.length])

  if (!root) {
    return (
      <p className="px-3 py-3 text-[11.5px] text-[var(--color-muted)]">
        {t('Select a session to see its repository.')}
      </p>
    )
  }

  if (git && !git.isRepo) {
    return (
      <p className="px-3 py-3 text-[11.5px] text-[var(--color-muted)]">
        {t('This is not a git repository.')}
      </p>
    )
  }

  const staged = git?.files.filter((f) => f.staged) ?? []
  const unstaged = git?.files.filter((f) => !f.staged) ?? []

  /** Asks Claude to draft a message from the staged changes. */
  async function suggestMessage(): Promise<void> {
    if (!root) return
    setSuggesting(true)
    setError(undefined)
    const result = await window.claudeUI.suggestCommitMessage(root, model || undefined)
    setSuggesting(false)
    if (result.ok && result.text) setMessage(result.text)
    else setError(result.error ?? t('Could not draft a message'))
  }

  async function runReview(): Promise<void> {
    if (!root) return
    setReviewing(true)
    setError(undefined)
    const result = await window.claudeUI.reviewStagedDiff(root, model || undefined)
    setReviewing(false)
    if (result.ok && result.text) setReview(result.text)
    else setError(result.error ?? t('Could not review the changes'))
  }

  async function runRemote(operation: 'fetch' | 'pull' | 'push'): Promise<void> {
    if (!root) return
    setRemoteBusy(operation)
    setError(undefined)
    setProgress(undefined)

    // A branch with no upstream would otherwise fail with a --set-upstream hint.
    const needsUpstream = operation === 'push' && !git?.upstream
    const result = await window.claudeUI.gitRemote(root, operation, {
      setUpstream: needsUpstream,
      branch: git?.branch
    })

    setRemoteBusy(undefined)
    setProgress(undefined)
    if (!result.ok) setError(result.error ?? t('{operation} failed', { operation }))
    void refreshGit()
  }

  async function saveStash(): Promise<void> {
    if (!root) return
    setRemoteBusy('stash')
    const result = await window.claudeUI.stashSave(root, message.trim() || undefined)
    setRemoteBusy(undefined)
    if (!result.ok) setError(result.error)
    else setMessage('')
    setStash(await window.claudeUI.listStash(root))
    void refreshGit()
  }

  async function commit(): Promise<void> {
    if (!root || !message.trim()) return
    setBusy(true)
    setError(undefined)
    const result = await window.claudeUI.gitCommit(root, message, false)
    setBusy(false)
    if (result.ok) {
      setMessage('')
      void refreshGit()
    } else {
      setError(result.error)
    }
  }

  async function switchBranch(name: string): Promise<void> {
    if (!root) return
    setBusy(true)
    const result = await window.claudeUI.gitCheckout(root, name, false)
    setBusy(false)
    if (!result.ok) setError(result.error)
    void refreshGit()
  }

  return (
    <div className="relative flex flex-col h-full">
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-border)]">
        <GitBranch size={11} className="text-[var(--color-muted)] shrink-0" />
        <select
          value={git?.branch ?? ''}
          onChange={(e) => void switchBranch(e.target.value)}
          disabled={busy}
          className="flex-1 min-w-0 bg-transparent text-[11px] outline-none cursor-pointer"
        >
          {git?.branch && !branches.some((b) => b.name === git.branch) && (
            <option value={git.branch}>{git.branch}</option>
          )}
          {branches
            .filter((b) => !b.remote)
            .map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>

        {git?.ahead !== undefined && git.ahead > 0 && (
          <span className="flex items-center text-[9.5px] text-emerald-400 shrink-0">
            <ArrowUp size={9} />
            {git.ahead}
          </span>
        )}
        {git?.behind !== undefined && git.behind > 0 && (
          <span className="flex items-center text-[9.5px] text-blue-400 shrink-0">
            <ArrowDown size={9} />
            {git.behind}
          </span>
        )}

        <button
          onClick={() => void runRemote('fetch')}
          disabled={Boolean(remoteBusy)}
          title={t('Fetch from remote')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          <RefreshCcw size={10} className={remoteBusy === 'fetch' ? 'animate-spin' : ''} />
        </button>
        <button
          onClick={() => void runRemote('pull')}
          disabled={Boolean(remoteBusy)}
          title={t('Pull and merge')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          {remoteBusy === 'pull' ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <ArrowDownToLine size={10} />
          )}
        </button>
        <button
          onClick={() => void runRemote('push')}
          disabled={Boolean(remoteBusy)}
          title={git?.upstream ? t('Push') : t('Push and set upstream')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          {remoteBusy === 'push' ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <ArrowUpFromLine size={10} />
          )}
        </button>
        <button
          onClick={() => setShowStash((v) => !v)}
          title={t('Stashes')}
          className={`relative p-0.5 rounded hover:bg-[var(--color-surface-2)] ${
            showStash ? 'text-[var(--color-accent)]' : ''
          }`}
        >
          <Archive size={10} />
          {stash.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 text-[8px] text-[var(--color-accent)]">
              {stash.length}
            </span>
          )}
        </button>
        <button
          onClick={onCompareBranches}
          title={t('Compare branches')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
        >
          <GitCompare size={10} />
        </button>
        <button
          onClick={() => setShowWorktrees(true)}
          title={t('Worktrees — run agents on several branches at once')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
        >
          <FolderTree size={10} />
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          title={t('Commit history')}
          className={`p-0.5 rounded hover:bg-[var(--color-surface-2)] ${
            showHistory ? 'text-[var(--color-accent)]' : ''
          }`}
        >
          <History size={11} />
        </button>
        <button
          onClick={() => void refreshGit()}
          title={t('Refresh')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
        >
          <RefreshCw size={10} className={gitLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {showHistory ? (
        <div className="flex-1 overflow-auto py-1">
          {commits.map((c) => (
            <button
              key={c.hash}
              onClick={() => setOpenCommit(c)}
              title={t('Show commit changes')}
              className="w-full text-left px-2 py-1 hover:bg-[var(--color-surface-2)] transition-colors"
            >
              <div className="flex items-baseline gap-1.5">
                <span className="text-[9.5px] font-mono text-[var(--color-accent)] shrink-0">
                  {c.shortHash}
                </span>
                <span className="text-[11px] truncate">{c.subject}</span>
              </div>
              <div className="text-[9.5px] text-[var(--color-muted)]">
                {c.author} · {relativeTime(c.date)}
              </div>
            </button>
          ))}
          {commits.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">{t('No commits yet')}</p>
          )}
        </div>
      ) : (
        <>
          {progress && (
            <p className="shrink-0 px-2 py-1 text-[9.5px] font-mono text-[var(--color-muted)]
                          border-b border-[var(--color-border)] truncate">
              {progress}
            </p>
          )}

          {showStash && (
            <div className="shrink-0 border-b border-[var(--color-border)] py-1 max-h-[140px] overflow-y-auto">
              <div className="px-2 py-0.5 flex items-center gap-1">
                <span className="text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
                  {t('Stashed')}
                </span>
                <button
                  onClick={() => void saveStash()}
                  disabled={git?.files.length === 0 || Boolean(remoteBusy)}
                  className="ml-auto text-[9.5px] hover:text-[var(--color-text)] disabled:opacity-40"
                >
                  {t('stash current')}
                </button>
              </div>
              {stash.length === 0 && (
                <p className="px-2 py-1 text-[10px] text-[var(--color-muted)]">{t('Empty')}</p>
              )}
              {stash.map((entry) => (
                <div
                  key={entry.index}
                  className="group flex items-center gap-1 px-2 py-0.5 hover:bg-[var(--color-surface-2)]"
                >
                  <span className="text-[10.5px] truncate flex-1">{entry.label}</span>
                  <span className="text-[9px] text-[var(--color-muted)] shrink-0">{entry.date}</span>
                  <button
                    onClick={async () => {
                      if (!root) return
                      await window.claudeUI.stashApply(root, entry.index, true)
                      setStash(await window.claudeUI.listStash(root))
                      void refreshGit()
                    }}
                    className="text-[9.5px] opacity-0 group-hover:opacity-100 hover:text-[var(--color-text)]"
                  >
                    {t('restore')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-auto py-1">
            {git?.files.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">
                {t('Working tree is clean')}
              </p>
            )}

            {staged.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-2 py-1 text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
                  {t('Staged')} · {staged.length}
                </div>
                {staged.map((f) => (
                  <FileRow
                    key={`s-${f.path}`}
                    file={f}
                    root={root}
                    onDone={refreshGit}
                    onConflict={setConflictPath}
                  />
                ))}
              </>
            )}

            {unstaged.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-2 py-1 mt-1 text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
                  {t('Changes')} · {unstaged.length}
                  <button
                    onClick={() =>
                      void window.claudeUI
                        .gitStage(root, unstaged.map((f) => f.path))
                        .then(refreshGit)
                    }
                    className="ml-auto normal-case hover:text-[var(--color-text)]"
                  >
                    {t('stage all')}
                  </button>
                </div>
                {unstaged.map((f) => (
                  <FileRow
                    key={`u-${f.path}`}
                    file={f}
                    root={root}
                    onDone={refreshGit}
                    onConflict={setConflictPath}
                  />
                ))}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-[var(--color-border)] p-2">
            {review && (
              <div className="mb-1.5 p-2 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)]">
                <div className="flex items-start gap-1.5">
                  <ScanEye size={10} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
                  <p className="text-[10.5px] whitespace-pre-wrap leading-snug flex-1">{review}</p>
                  <button
                    onClick={() => setReview(undefined)}
                    className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1 mb-1">
              <button
                onClick={() => void suggestMessage()}
                disabled={suggesting || staged.length === 0}
                title={t('Draft a commit message from the staged changes')}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
                           text-[var(--color-muted)] hover:text-[var(--color-text)]
                           hover:bg-[var(--color-surface-2)] disabled:opacity-40
                           disabled:cursor-not-allowed transition-colors"
              >
                {suggesting ? (
                  <Loader2 size={9} className="animate-spin" />
                ) : (
                  <Sparkles size={9} />
                )}
                {t('Message')}
              </button>
              <button
                onClick={() => void runReview()}
                disabled={reviewing || staged.length === 0}
                title={t('Review the staged changes before committing')}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
                           text-[var(--color-muted)] hover:text-[var(--color-text)]
                           hover:bg-[var(--color-surface-2)] disabled:opacity-40
                           disabled:cursor-not-allowed transition-colors"
              >
                {reviewing ? <Loader2 size={9} className="animate-spin" /> : <ScanEye size={9} />}
                {t('Review')}
              </button>
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void commit()
              }}
              rows={2}
              placeholder={t('Commit message… (⌘↵)')}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                         rounded-md px-2 py-1 text-[11.5px] outline-none resize-none
                         focus:border-[var(--color-accent)] placeholder:text-[var(--color-muted)]"
            />
            {error && <p className="mt-1 text-[10px] text-red-400 line-clamp-3">{error}</p>}
            <button
              onClick={() => void commit()}
              disabled={busy || !message.trim() || staged.length === 0}
              className="w-full mt-1.5 flex items-center justify-center gap-1.5 py-1 rounded-md
                         text-[11.5px] bg-[var(--color-accent-soft)]
                         hover:bg-[var(--color-accent)]/30 disabled:opacity-40
                         disabled:cursor-not-allowed transition-colors"
              title={staged.length === 0 ? t('Stage some files first') : undefined}
            >
              <Check size={11} />
              {t('Commit')} {staged.length > 0 && `(${staged.length})`}
            </button>
          </div>
        </>
      )}

      {conflictPath && (
        <ConflictResolver path={conflictPath} onClose={() => setConflictPath(undefined)} />
      )}

      {openCommit && (
        <CommitDialog root={root} commit={openCommit} onClose={() => setOpenCommit(undefined)} />
      )}

      <WorktreeDialog
        root={root}
        open={showWorktrees}
        onClose={() => setShowWorktrees(false)}
      />
    </div>
  )
}
