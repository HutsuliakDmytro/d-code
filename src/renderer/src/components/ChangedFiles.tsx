import { useEffect, useState } from 'react'
import { FileDiff, FilePlus2, RotateCcw, Undo2, X, AlertTriangle } from 'lucide-react'
import type { ChangedFile } from '@shared/ipc'
import { useAppStore } from '../store/app-store'
import DiffView from './DiffView'
import { useTranslate } from '../i18n'

function RestoreDialog({
  file,
  sessionId,
  onClose
}: {
  file: ChangedFile
  sessionId: string
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  // The earliest version is the file as it was before the session touched it.
  const earliest = file.versions.find((v) => v.backupFileName)
  const [diff, setDiff] = useState<{ current?: string; backup?: string }>()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; error: boolean; undo?: string }>()

  useEffect(() => {
    if (!earliest?.backupFileName) return
    void window.claudeUI
      .getFileDiff(sessionId, earliest.backupFileName, file.path)
      .then(setDiff)
  }, [earliest, sessionId, file.path])

  async function restore(): Promise<void> {
    if (!earliest?.backupFileName) return
    setBusy(true)
    const res = await window.claudeUI.restoreFile({
      sessionId,
      backupFileName: earliest.backupFileName,
      targetPath: file.path
    })
    setBusy(false)
    setResult(
      res.ok
        ? { text: t('File restored to its pre-session state'), error: false, undo: res.previousContent }
        : { text: res.error ?? t('Restore failed'), error: true }
    )
  }

  async function undo(): Promise<void> {
    if (result?.undo === undefined) return
    setBusy(true)
    const res = await window.claudeUI.writeFileContent(file.path, result.undo)
    setBusy(false)
    setResult(
      res.ok
        ? { text: t('Restore undone'), error: false }
        : { text: res.error ?? t('Undo failed'), error: true }
    )
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[620px] max-w-[92%] bg-[var(--color-surface)] border border-[var(--color-border)]
                   rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <FileDiff size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px] flex-1 truncate font-mono">{file.displayPath}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="px-4 py-3">
          <p className="text-[10.5px] text-[var(--color-muted)] mb-2">
            <span className="text-red-300">−</span> {t('before the session')} ·{' '}
            <span className="text-emerald-300">+</span> {t('on disk now')}
          </p>
          {earliest ? (
            diff ? (
              <DiffView before={diff.backup ?? ''} after={diff.current ?? ''} />
            ) : (
              <p className="text-[11px] text-[var(--color-muted)]">{t('Reading backup…')}</p>
            )
          ) : (
            <div className="flex items-start gap-1.5 text-[11px] text-amber-400">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {t('This session created the file — there is no earlier state to restore.')}
            </div>
          )}
        </div>

        {result && (
          <p className={`px-4 pb-2 text-[11px] ${result.error ? 'text-red-400' : 'text-emerald-400'}`}>
            {result.text}
          </p>
        )}

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {t('Close')}
          </button>
          {result?.undo !== undefined ? (
            <button
              onClick={() => void undo()}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px]
                         border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]
                         disabled:opacity-40 transition-colors"
            >
              <Undo2 size={12} />
              {t('Undo restore')}
            </button>
          ) : (
            <button
              onClick={() => void restore()}
              disabled={busy || !earliest || !file.exists}
              title={!file.exists ? t('File is not on disk') : undefined}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[12px]
                         bg-red-900/60 hover:bg-red-800/70 disabled:opacity-30
                         disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw size={12} />
              {t('Restore to pre-session state')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Files the selected session touched, taken from the CLI's own change history. */
export default function ChangedFiles(): React.JSX.Element | null {
  const t = useTranslate()
  const selected = useAppStore((s) => s.selected)
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [active, setActive] = useState<ChangedFile>()

  useEffect(() => {
    setFiles([])
    setActive(undefined)
    if (!selected) return
    void window.claudeUI
      .listChangedFiles(selected.meta.filePath, selected.meta.sessionId)
      .then(setFiles)
  }, [selected?.meta.sessionId, selected?.meta.filePath, selected])

  if (!selected || files.length === 0) return null

  return (
    <section className="pt-1 border-t border-[var(--color-border)]">
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
        {t('Changed files')} · {files.length}
      </h3>

      <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() => setActive(f)}
            title={f.path}
            className="w-full flex items-center gap-1.5 px-1 py-1 rounded text-left
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {f.createdBySession ? (
              <FilePlus2 size={10} className="text-emerald-400 shrink-0" />
            ) : (
              <FileDiff size={10} className="text-[var(--color-muted)] shrink-0" />
            )}
            <span className="text-[10.5px] font-mono truncate flex-1">{f.displayPath}</span>
            <span className="text-[9.5px] text-[var(--color-muted)] shrink-0">
              v{f.versions.at(-1)?.version ?? 1}
            </span>
            {!f.exists && <span className="text-[9px] text-amber-400 shrink-0">{t('gone')}</span>}
          </button>
        ))}
      </div>

      {active && (
        <RestoreDialog
          file={active}
          sessionId={selected.meta.sessionId}
          onClose={() => setActive(undefined)}
        />
      )}
    </section>
  )
}
