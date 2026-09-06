import { useEffect, useMemo, useState } from 'react'
import { GitCompare, X, Loader2, ArrowRight } from 'lucide-react'
import type { BranchDiffFile, GitBranch } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import DiffView from './DiffView'
import { useTranslate } from '../i18n'

const STATUS_MARK: Record<BranchDiffFile['status'], { char: string; tone: string }> = {
  added: { char: 'A', tone: 'text-emerald-400' },
  modified: { char: 'M', tone: 'text-amber-400' },
  deleted: { char: 'D', tone: 'text-red-400' },
  renamed: { char: 'R', tone: 'text-blue-400' }
}

/**
 * What changed between two branches.
 *
 * Compared from the merge base rather than the tip: otherwise everything that
 * moved in the base branch on its own would show up as our change.
 */
export default function BranchDiffDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const { root, git } = useWorkspaceStore()
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [base, setBase] = useState('')
  const [head, setHead] = useState('')
  const [files, setFiles] = useState<BranchDiffFile[]>([])
  const [selected, setSelected] = useState<string>()
  const [diff, setDiff] = useState<{ before: string; after: string }>()
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !root) return
    void window.claudeUI.gitBranches(root).then((list) => {
      const local = list.filter((b) => !b.remote)
      setBranches(local)
      // By default compare the current branch against the usual base.
      const current = git?.branch ?? local.find((b) => b.current)?.name ?? ''
      const fallback = local.find((b) => b.name === 'main' || b.name === 'master')?.name
      setHead(current)
      setBase(fallback && fallback !== current ? fallback : (local[0]?.name ?? ''))
    })
  }, [open, root, git?.branch])

  useEffect(() => {
    if (!open || !root || !base || !head || base === head) {
      setFiles([])
      return
    }
    setLoading(true)
    setSelected(undefined)
    setDiff(undefined)
    void window.claudeUI.diffBranches(root, base, head).then((result) => {
      setFiles(result)
      setLoading(false)
    })
  }, [open, root, base, head])

  useEffect(() => {
    if (!root || !selected || !base || !head) return
    setDiff(undefined)
    void window.claudeUI.diffBranchFile(root, base, head, selected).then(setDiff)
  }, [root, selected, base, head])

  const totals = useMemo(
    () =>
      files.reduce(
        (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
        { added: 0, removed: 0 }
      ),
    [files]
  )

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[900px] max-w-[95%] h-[76vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <GitCompare size={14} className="text-[var(--color-accent)]" />
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded
                       px-2 py-1 text-[11px] outline-none"
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
          <ArrowRight size={12} className="text-[var(--color-muted)]" />
          <select
            value={head}
            onChange={(e) => setHead(e.target.value)}
            className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded
                       px-2 py-1 text-[11px] outline-none"
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>

          {loading && <Loader2 size={12} className="animate-spin text-[var(--color-muted)]" />}

          {files.length > 0 && (
            <span className="ml-auto text-[10px] text-[var(--color-muted)]">
              {t('{count} files', { count: files.length })} · <span className="text-emerald-400">+{totals.added}</span>{' '}
              <span className="text-red-400">−{totals.removed}</span>
            </span>
          )}

          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex divide-x divide-[var(--color-border)]">
          <div className="w-[280px] shrink-0 overflow-y-auto py-1">
            {base === head && (
              <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">
                {t('Pick two different branches.')}
              </p>
            )}
            {base !== head && files.length === 0 && !loading && (
              <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">
                {t('The branches are identical.')}
              </p>
            )}
            {files.map((file) => {
              const mark = STATUS_MARK[file.status]
              return (
                <button
                  key={file.path}
                  onClick={() => setSelected(file.path)}
                  title={file.path}
                  className={`w-full flex items-center gap-1.5 px-2 py-1 text-left transition-colors ${
                    selected === file.path
                      ? 'bg-[var(--color-accent-soft)]'
                      : 'hover:bg-[var(--color-surface-2)]'
                  }`}
                >
                  <span className={`text-[10px] font-mono w-[9px] shrink-0 ${mark.tone}`}>
                    {mark.char}
                  </span>
                  <span className="text-[10.5px] font-mono truncate flex-1">{file.path}</span>
                  <span className="text-[9px] shrink-0">
                    <span className="text-emerald-400">+{file.added}</span>{' '}
                    <span className="text-red-400">−{file.removed}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className="flex-1 min-w-0 overflow-y-auto p-3">
            {!selected && (
              <p className="text-[11.5px] text-[var(--color-muted)]">
                {t('Select a file to see the changes.')}
              </p>
            )}
            {selected && !diff && (
              <p className="text-[11.5px] text-[var(--color-muted)]">{t('Reading…')}</p>
            )}
            {selected && diff && (
              <DiffView before={diff.before} after={diff.after} maxHeight="none" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
