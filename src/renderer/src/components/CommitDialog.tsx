import { useEffect, useState } from 'react'
import { GitCommitVertical, X } from 'lucide-react'
import type { GitCommit } from '@shared/ipc'
import { relativeTime } from '../lib/format'
import { useTranslate } from '../i18n'

/** A single line of git's unified diff. */
function patchLineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-[var(--color-muted)]'
  if (line.startsWith('@@')) return 'text-blue-400 bg-blue-950/20'
  if (line.startsWith('+')) return 'text-emerald-300 bg-emerald-950/30'
  if (line.startsWith('-')) return 'text-red-300 bg-red-950/30'
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'text-[var(--color-muted)]'
  return 'text-neutral-400'
}

/** Full commit contents: stats and patch, as `git show` reports them. */
export default function CommitDialog({
  root,
  commit,
  onClose
}: {
  root: string
  commit: GitCommit
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [patch, setPatch] = useState<string>()

  useEffect(() => {
    void window.claudeUI.gitShow(root, commit.hash).then(setPatch)
  }, [root, commit.hash])

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[760px] max-w-[94%] max-h-[80vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <GitCommitVertical size={14} className="mt-0.5 text-[var(--color-accent)] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] break-words">{commit.subject}</p>
            <p className="text-[10px] text-[var(--color-muted)]">
              <span className="font-mono">{commit.shortHash}</span> · {commit.author} ·{' '}
              {relativeTime(commit.date)}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-bg)]">
          {patch === undefined ? (
            <p className="px-4 py-3 text-[11px] text-[var(--color-muted)]">{t('Reading commit…')}</p>
          ) : (
            <pre className="text-[10.5px] font-mono leading-relaxed">
              {patch.split('\n').map((line, i) => (
                <div key={i} className={`px-3 ${patchLineClass(line)}`}>
                  {line || ' '}
                </div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
