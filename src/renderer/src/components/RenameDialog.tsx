import { useEffect, useMemo, useState } from 'react'
import { Pencil, X, Loader2, AlertTriangle, Check } from 'lucide-react'
import type { RenameEdit } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

export interface RenameTarget {
  path: string
  language: string
  content: string
  line: number
  column: number
  /** Current name under the cursor — the field's initial value. */
  symbol: string
}

/**
 * Renames a symbol across the whole project.
 *
 * The language server produces the edits, but they are only applied after review:
 * the change reaches files the user never opened, and writing to those silently
 * would be an unpleasant surprise.
 */
export default function RenameDialog({
  target,
  onClose
}: {
  target: RenameTarget
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const { root, refreshDir, forgetFile } = useWorkspaceStore()
  const [newName, setNewName] = useState(target.symbol)
  const [edits, setEdits] = useState<RenameEdit[]>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [done, setDone] = useState(false)

  const byFile = useMemo(() => {
    const map = new Map<string, RenameEdit[]>()
    for (const edit of edits ?? []) {
      const list = map.get(edit.path)
      if (list) list.push(edit)
      else map.set(edit.path, [edit])
    }
    return [...map.entries()]
  }, [edits])

  useEffect(() => {
    setEdits(undefined)
    setError(undefined)
  }, [newName])

  async function preview(): Promise<void> {
    if (!root || !newName.trim() || newName === target.symbol) return
    setBusy(true)
    setError(undefined)

    const result = await window.claudeUI.lspRename({
      root,
      path: target.path,
      language: target.language,
      content: target.content,
      line: target.line,
      column: target.column,
      newName: newName.trim()
    })

    setBusy(false)
    if (result.length === 0) {
      setError(t('The language server proposed no changes — the symbol may not be renameable'))
      return
    }
    setEdits(result)
  }

  async function apply(): Promise<void> {
    if (!root || !edits?.length) return
    setBusy(true)

    // Group by file and apply edits from the end: otherwise each replacement
    // would shift the positions of the ones that follow it in the same file.
    for (const [path, list] of byFile) {
      const original = await window.claudeUI.readTextFile(path)
      if ('error' in original) {
        setError(`${path}: ${original.error}`)
        setBusy(false)
        return
      }

      const lines = original.content.split('\n')
      const sorted = [...list].sort((a, b) => b.line - a.line || b.column - a.column)

      for (const edit of sorted) {
        const index = edit.line - 1
        const line = lines[index]
        if (line === undefined) continue
        lines[index] =
          line.slice(0, edit.column - 1) + edit.newText + line.slice(edit.endColumn - 1)
      }

      const written = await window.claudeUI.writeFileContent(path, lines.join('\n'))
      if (!written.ok) {
        setError(`${path}: ${written.error}`)
        setBusy(false)
        return
      }
      // Open tabs now point at stale content.
      forgetFile(path)
    }

    setBusy(false)
    setDone(true)
    if (root) await refreshDir(root)
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center pt-20 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[620px] max-w-[94%] max-h-[70vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <Pencil size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px] flex-1">
            {t('Rename')} <span className="font-mono">{target.symbol}</span>
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="shrink-0 px-4 py-3">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void (edits ? apply() : preview())
              if (e.key === 'Escape') onClose()
            }}
            disabled={done}
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                       rounded-md px-2 py-1.5 text-[12px] font-mono outline-none
                       focus:border-[var(--color-accent)] disabled:opacity-50"
          />

          {error && (
            <p className="mt-2 flex items-start gap-1.5 text-[10.5px] text-amber-400">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        {edits && (
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-[var(--color-border)]">
            <p className="px-4 py-1.5 text-[10.5px] text-[var(--color-muted)]">
              {t('{edits} replacements in {files} files', { edits: edits.length, files: byFile.length })}
            </p>
            {byFile.map(([path, list]) => (
              <div key={path} className="px-4 py-1 border-t border-[var(--color-border)]">
                <p className="text-[10.5px] font-mono text-[var(--color-accent)] truncate">
                  {root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path}
                </p>
                <p className="text-[9.5px] text-[var(--color-muted)]">
                  {t('lines')} {[...new Set(list.map((e) => e.line))].join(', ')}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          {done ? (
            <p className="flex items-center gap-1.5 text-[11px] text-emerald-400 flex-1">
              <Check size={12} />
              {t('Renamed')}
            </p>
          ) : (
            <p className="text-[10.5px] text-[var(--color-muted)] flex-1">
              {edits ? t('Review the list before applying') : t('Edits come from the language server')}
            </p>
          )}

          {busy && <Loader2 size={12} className="animate-spin text-[var(--color-muted)]" />}

          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {done ? t('Close') : t('Cancel')}
          </button>

          {!done &&
            (edits ? (
              <button
                onClick={() => void apply()}
                disabled={busy}
                className="px-3 py-1.5 rounded-md text-[12px] bg-[var(--color-accent)]
                           disabled:opacity-40 transition-opacity"
              >
                {t('Apply')}
              </button>
            ) : (
              <button
                onClick={() => void preview()}
                disabled={busy || !newName.trim() || newName === target.symbol}
                className="px-3 py-1.5 rounded-md text-[12px] bg-[var(--color-accent)]
                           disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
              >
                {t('Preview changes')}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}
