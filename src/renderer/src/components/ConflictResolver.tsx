import { useEffect, useState } from 'react'
import { Check, GitMerge, Loader2, X } from 'lucide-react'
import type { ConflictBlock } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/**
 * Merge conflict resolution.
 *
 * Works on the file text on disk rather than the git index: the user sees exactly
 * what is there and fixes exactly that. Each block is resolved on its own, and the
 * file is only marked resolved once no markers remain.
 */
export default function ConflictResolver({
  path,
  onClose
}: {
  path: string
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { root, refreshGit, forgetFile } = useWorkspaceStore()
  const [content, setContent] = useState<string>()
  const [blocks, setBlocks] = useState<ConflictBlock[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function reload(): Promise<void> {
    if (!root) return
    const text = await window.claudeUI.readConflictFile(root, path)
    setContent(text)
    setBlocks(parseLocal(text))
  }

  useEffect(() => {
    void reload()
  }, [root, path])

  async function choose(index: number, choice: 'ours' | 'theirs' | 'both'): Promise<void> {
    if (!root || content === undefined) return
    const next = applyLocal(content, index, choice)
    setBusy(true)
    const result = await window.claudeUI.writeConflictFile(root, path, next)
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? t('Could not save'))
      return
    }
    // The open file changed on disk — the tab must be reloaded.
    forgetFile(`${root}/${path}`)
    await reload()
  }

  async function finish(): Promise<void> {
    if (!root) return
    setBusy(true)
    const result = await window.claudeUI.markResolved(root, path)
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? t('Could not mark as resolved'))
      return
    }
    void refreshGit()
    onClose()
  }

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
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <GitMerge size={14} className="text-amber-400" />
          <span className="text-[12.5px] font-mono truncate flex-1">{path}</span>
          <span className="text-[10px] text-[var(--color-muted)] shrink-0">
            {t('{count} conflicts', { count: blocks.length })}
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {content === undefined && (
            <p className="px-4 py-3 text-[11.5px] text-[var(--color-muted)]">{t('Reading file…')}</p>
          )}

          {blocks.length === 0 && content !== undefined && (
            <div className="px-4 py-6 text-center">
              <Check size={20} className="mx-auto mb-2 text-emerald-400" />
              <p className="text-[12px]">{t('No conflicts left.')}</p>
              <p className="text-[10.5px] text-[var(--color-muted)] mt-1">
                {t('Mark the file resolved to stage it.')}
              </p>
            </div>
          )}

          {blocks.map((block) => (
            <div key={block.index} className="border-b border-[var(--color-border)] last:border-0">
              <div className="px-4 py-1.5 text-[10px] text-[var(--color-muted)]">
                {t('Lines')} {block.startLine + 1}–{block.endLine + 1}
              </div>

              <div className="grid grid-cols-2 gap-px bg-[var(--color-border)]">
                <div className="bg-[var(--color-bg)] p-2">
                  <p className="text-[9.5px] text-blue-400 mb-1">{block.oursLabel}</p>
                  <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                    {block.ours || t('(empty)')}
                  </pre>
                </div>
                <div className="bg-[var(--color-bg)] p-2">
                  <p className="text-[9.5px] text-emerald-400 mb-1">{block.theirsLabel}</p>
                  <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-all max-h-40 overflow-auto">
                    {block.theirs || t('(empty)')}
                  </pre>
                </div>
              </div>

              <div className="flex gap-1.5 px-4 py-2">
                <button
                  onClick={() => void choose(block.index, 'ours')}
                  disabled={busy}
                  className="flex-1 py-1 rounded text-[11px] border border-[var(--color-border)]
                             hover:bg-[var(--color-surface-2)] disabled:opacity-40 transition-colors"
                >
                  {t('Take ours')}
                </button>
                <button
                  onClick={() => void choose(block.index, 'theirs')}
                  disabled={busy}
                  className="flex-1 py-1 rounded text-[11px] border border-[var(--color-border)]
                             hover:bg-[var(--color-surface-2)] disabled:opacity-40 transition-colors"
                >
                  {t('Take theirs')}
                </button>
                <button
                  onClick={() => void choose(block.index, 'both')}
                  disabled={busy}
                  className="flex-1 py-1 rounded text-[11px] border border-[var(--color-border)]
                             hover:bg-[var(--color-surface-2)] disabled:opacity-40 transition-colors"
                >
                  {t('Both')}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          {error && <p className="text-[10.5px] text-red-400 flex-1">{error}</p>}
          {!error && (
            <p className="text-[10.5px] text-[var(--color-muted)] flex-1">
              {t('Trickier spots can be finished by hand in the editor.')}
            </p>
          )}
          {busy && <Loader2 size={12} className="animate-spin text-[var(--color-muted)]" />}
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {t('Close')}
          </button>
          <button
            onClick={() => void finish()}
            disabled={busy || blocks.length > 0}
            title={blocks.length > 0 ? t('Resolve every conflict first') : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px]
                       bg-[var(--color-accent)] disabled:opacity-30
                       disabled:cursor-not-allowed transition-opacity"
          >
            <Check size={12} />
            {t('Resolved')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Same rules as in main; duplicated to avoid sending the text over IPC on every click. */
function parseLocal(content: string): ConflictBlock[] {
  const lines = content.split('\n')
  const blocks: ConflictBlock[] = []
  let start = -1
  let separator = -1
  let oursLabel = ''

  lines.forEach((line, i) => {
    if (line.startsWith('<<<<<<<')) {
      start = i
      separator = -1
      oursLabel = line.slice(7).trim()
    } else if (line.startsWith('=======') && start !== -1) {
      separator = i
    } else if (line.startsWith('>>>>>>>') && start !== -1 && separator !== -1) {
      blocks.push({
        index: blocks.length,
        startLine: start,
        endLine: i,
        ours: lines.slice(start + 1, separator).join('\n'),
        theirs: lines.slice(separator + 1, i).join('\n'),
        oursLabel: oursLabel || 'ours',
        theirsLabel: line.slice(7).trim() || 'theirs'
      })
      start = -1
      separator = -1
    }
  })
  return blocks
}

function applyLocal(content: string, index: number, choice: 'ours' | 'theirs' | 'both'): string {
  const block = parseLocal(content)[index]
  if (!block) return content

  const lines = content.split('\n')
  const replacement =
    choice === 'ours' ? block.ours : choice === 'theirs' ? block.theirs : `${block.ours}\n${block.theirs}`

  return [
    ...lines.slice(0, block.startLine),
    ...(replacement === '' ? [] : replacement.split('\n')),
    ...lines.slice(block.endLine + 1)
  ].join('\n')
}
