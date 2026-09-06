import { useEffect, useState } from 'react'
import { History, RotateCcw, Undo2, AlertTriangle, X } from 'lucide-react'
import type { Checkpoint, RestoreResult } from '@shared/ipc'
import { useAppStore } from '../store/app-store'
import { useWorkspaceStore } from '../store/workspace-store'
import { relativeTime } from '../lib/format'
import { useTranslate } from '../i18n'

function ConfirmDialog({
  checkpoint,
  sessionId,
  onClose
}: {
  checkpoint: Checkpoint
  sessionId: string
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RestoreResult>()
  const refreshGit = useWorkspaceStore((s) => s.refreshGit)

  async function restore(): Promise<void> {
    setBusy(true)
    const outcome = await window.claudeUI.restoreCheckpoint(sessionId, checkpoint.files)
    setBusy(false)
    setResult(outcome)
    void refreshGit()
  }

  async function undo(): Promise<void> {
    if (!result) return
    setBusy(true)
    for (const [path, content] of Object.entries(result.previous)) {
      await window.claudeUI.writeFileContent(path, content)
    }
    setBusy(false)
    setResult(undefined)
    void refreshGit()
    onClose()
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[520px] max-w-[92%] bg-[var(--color-surface)] border border-[var(--color-border)]
                   rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <History size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px] flex-1">{t('Restore files to this point')}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-2">
          {checkpoint.label && (
            <p className="text-[11px] text-[var(--color-muted)] line-clamp-2">
              {t('State before message')}: «{checkpoint.label}»
            </p>
          )}

          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {checkpoint.files.map((f) => (
              <div key={f.path} className="flex items-center gap-1.5" title={f.path}>
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    f.backupFileName ? 'bg-[var(--color-accent)]' : 'bg-amber-400'
                  }`}
                />
                <span className="text-[10.5px] font-mono truncate">{f.displayPath}</span>
                {!f.backupFileName && (
                  <span className="text-[9px] text-amber-400 shrink-0">{t('created later')}</span>
                )}
              </div>
            ))}
          </div>

          {!result && (
            <div className="flex items-start gap-1.5 text-[10.5px] text-amber-400">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              {t('Working files will be overwritten. This can be undone right after the restore.')}
            </div>
          )}

          {result && (
            <div className="text-[10.5px] space-y-0.5">
              {result.restored.length > 0 && (
                <p className="text-emerald-400">{t('Restored')}: {result.restored.join(', ')}</p>
              )}
              {result.failed.map((f) => (
                <p key={f.path} className="text-red-400">
                  {f.path}: {f.error}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {result ? t('Close') : t('Cancel')}
          </button>

          {result ? (
            Object.keys(result.previous).length > 0 && (
              <button
                onClick={() => void undo()}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md
                           text-[12px] border border-[var(--color-border)]
                           hover:bg-[var(--color-surface-2)] disabled:opacity-40 transition-colors"
              >
                <Undo2 size={12} />
                {t('Undo restore')}
              </button>
            )
          ) : (
            <button
              onClick={() => void restore()}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md
                         text-[12px] bg-red-900/60 hover:bg-red-800/70 disabled:opacity-40
                         transition-colors"
            >
              <RotateCcw size={12} />
              {t('Restore')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Session restore points.
 *
 * The CLI snapshots files before every message, so you can return to the state
 * from before a request was made — no git, no manual copies.
 */
export default function Checkpoints(): React.JSX.Element | null {
  const t = useTranslate()
  const selected = useAppStore((s) => s.selected)
  const [points, setPoints] = useState<Checkpoint[]>([])
  const [active, setActive] = useState<Checkpoint>()

  useEffect(() => {
    setPoints([])
    setActive(undefined)
    if (!selected) return
    void window.claudeUI.listCheckpoints(selected.meta.filePath).then(setPoints)
  }, [selected?.meta.filePath, selected])

  if (!selected || points.length === 0) return null

  return (
    <section className="pt-1 border-t border-[var(--color-border)]">
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide
                     text-[var(--color-muted)] mb-1.5">
        <History size={10} />
        {t('Restore points')} · {points.length}
      </h3>

      <div className="space-y-0.5 max-h-[160px] overflow-y-auto">
        {points.map((point) => (
          <button
            key={point.messageId}
            onClick={() => setActive(point)}
            title={point.files.map((f) => f.displayPath).join('\n')}
            className="w-full flex items-center gap-1.5 px-1 py-1 rounded text-left
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <RotateCcw size={9} className="shrink-0 text-[var(--color-muted)]" />
            <span className="text-[10.5px] truncate flex-1">
              {point.label ?? t('no label')}
            </span>
            <span className="text-[9px] text-[var(--color-muted)] shrink-0">
              {t('{count} files', { count: point.files.length })} · {relativeTime(point.timestamp)}
            </span>
          </button>
        ))}
      </div>

      {active && (
        <ConfirmDialog
          checkpoint={active}
          sessionId={selected.meta.sessionId}
          onClose={() => setActive(undefined)}
        />
      )}
    </section>
  )
}
