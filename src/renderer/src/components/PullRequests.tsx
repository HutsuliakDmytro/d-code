import { useEffect, useState } from 'react'
import { GitPullRequest, ExternalLink, Plus, Loader2, Check, CircleDot, X } from 'lucide-react'
import type { GhStatus, PullRequest } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useSettingsStore } from '../store/settings-store'
import { useTranslate } from '../i18n'

function CreateForm({
  root,
  base,
  onDone,
  onCancel
}: {
  root: string
  base?: string
  onDone: (url?: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const model = useSettingsStore((s) => s.model)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  /** The model drafts title and body from what is already staged. */
  async function suggest(): Promise<void> {
    setBusy(true)
    const result = await window.claudeUI.suggestCommitMessage(root, model || undefined)
    setBusy(false)
    if (result.ok && result.text) setTitle(result.text)
    else setError(result.error)
  }

  async function create(): Promise<void> {
    if (!title.trim()) return
    setBusy(true)
    setError(undefined)
    const result = await window.claudeUI.createPullRequest(root, {
      title: title.trim(),
      body: body.trim(),
      draft,
      base
    })
    setBusy(false)
    if (result.ok) onDone(result.url)
    else setError(result.error ?? t('Could not create the PR'))
  }

  return (
    <div className="px-2 py-2 space-y-1.5 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('PR title…')}
          className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)]
                     rounded px-2 py-1 text-[11px] outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => void suggest()}
          disabled={busy}
          title={t('Draft a title from the staged changes')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-40"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
        </button>
      </div>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={t('Description (optional)')}
        className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                   rounded px-2 py-1 text-[11px] outline-none resize-none
                   focus:border-[var(--color-accent)]"
      />

      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={draft}
          onChange={(e) => setDraft(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        <span className="text-[10.5px] text-[var(--color-muted)]">{t('Draft')}</span>
      </label>

      {error && <p className="text-[10px] text-red-400 line-clamp-2">{error}</p>}

      <div className="flex gap-1.5">
        <button
          onClick={onCancel}
          className="flex-1 py-1 rounded text-[11px] border border-[var(--color-border)]
                     hover:bg-[var(--color-surface-2)] transition-colors"
        >
          {t('Cancel')}
        </button>
        <button
          onClick={() => void create()}
          disabled={busy || !title.trim()}
          className="flex-1 py-1 rounded text-[11px] bg-[var(--color-accent)]
                     disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
        >
          {t('Create')}
        </button>
      </div>
    </div>
  )
}

/**
 * Pull requests through `gh`.
 *
 * Presence of the tool and authentication are checked separately: otherwise the
 * panel would look broken where a single `gh auth login` is all that is missing.
 */
export default function PullRequests(): React.JSX.Element {
  const t = useTranslate()
  const { root, git } = useWorkspaceStore()
  const [status, setStatus] = useState<GhStatus>()
  const [items, setItems] = useState<PullRequest[]>([])
  const [current, setCurrent] = useState<PullRequest>()
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<string>()

  async function reload(): Promise<void> {
    if (!root) return
    setLoading(true)
    const state = await window.claudeUI.ghStatus(root)
    setStatus(state)
    if (state.available && state.authenticated) {
      setItems(await window.claudeUI.listPullRequests(root))
      setCurrent(await window.claudeUI.currentPullRequest(root))
    }
    setLoading(false)
  }

  useEffect(() => {
    void reload()
  }, [root, git?.branch])

  if (!root || !git?.isRepo) return <></>

  return (
    <section className="pt-1 border-t border-[var(--color-border)]">
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide
                     text-[var(--color-muted)] mb-1.5">
        <GitPullRequest size={10} />
        {t('Pull requests')}
        {loading && <Loader2 size={9} className="animate-spin" />}
        {status?.available && status.authenticated && !creating && (
          <button
            onClick={() => setCreating(true)}
            title={t('Create a PR from the current branch')}
            className="ml-auto p-0.5 rounded hover:bg-[var(--color-surface-2)]
                       hover:text-[var(--color-text)] transition-colors"
          >
            <Plus size={10} />
          </button>
        )}
      </h3>

      {status && !status.available && (
        <p className="text-[10.5px] text-[var(--color-muted)] leading-relaxed">
          <span className="font-mono">gh</span> {t('not found. Install the GitHub CLI to work with PRs without leaving the app.')}
        </p>
      )}

      {status?.available && !status.authenticated && (
        <p className="text-[10.5px] text-amber-400 leading-relaxed">
          {t('Authentication required')}: <span className="font-mono">gh auth login</span>
        </p>
      )}

      {creating && root && (
        <CreateForm
          root={root}
          base={git.upstream?.split('/').at(-1)}
          onDone={(url) => {
            setCreating(false)
            setCreated(url)
            void reload()
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {created && (
        <p className="flex items-center gap-1 text-[10px] text-emerald-400 mb-1">
          <Check size={10} />
          {t('PR created')}
          <button
            onClick={() => setCreated(undefined)}
            className="ml-auto text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X size={9} />
          </button>
        </p>
      )}

      {current && (
        <div className="mb-1 px-1 py-1 rounded bg-[var(--color-accent-soft)]">
          <p className="text-[10px] text-[var(--color-muted)]">{t('Current branch')}</p>
          <a
            href={current.url}
            className="text-[11px] hover:underline line-clamp-2"
            title={current.title}
          >
            #{current.number} {current.title}
          </a>
        </div>
      )}

      <div className="space-y-0.5 max-h-[160px] overflow-y-auto">
        {status?.authenticated && items.length === 0 && !loading && (
          <p className="text-[10.5px] text-[var(--color-muted)]">{t('No open PRs.')}</p>
        )}

        {items.map((pr) => (
          <a
            key={pr.number}
            href={pr.url}
            title={`${pr.headRefName} → ${pr.baseRefName}`}
            className="flex items-center gap-1.5 px-1 py-0.5 rounded
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {pr.checks === 'failing' ? (
              <CircleDot size={9} className="text-red-400 shrink-0" />
            ) : pr.checks === 'pending' ? (
              <CircleDot size={9} className="text-amber-400 shrink-0" />
            ) : pr.checks === 'passing' ? (
              <Check size={9} className="text-emerald-400 shrink-0" />
            ) : (
              <GitPullRequest size={9} className="text-[var(--color-muted)] shrink-0" />
            )}
            <span className="text-[9.5px] text-[var(--color-muted)] shrink-0">#{pr.number}</span>
            <span className="text-[10.5px] truncate flex-1">{pr.title}</span>
            {pr.isDraft && (
              <span className="text-[9px] text-[var(--color-muted)] shrink-0">{t('draft')}</span>
            )}
            <ExternalLink size={8} className="text-[var(--color-muted)] shrink-0" />
          </a>
        ))}
      </div>
    </section>
  )
}
