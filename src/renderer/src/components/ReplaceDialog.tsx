import { useEffect, useRef, useState } from 'react'
import { Replace, X, Loader2, CaseSensitive, Regex, AlertTriangle, Check } from 'lucide-react'
import type { ReplacePreview, ReplaceResult } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/**
 * Project-wide replace.
 *
 * The preview always comes first, with per-file checkboxes: a bulk replace cannot
 * be undone in one move, so running it blind is a bad idea.
 */
export default function ReplaceDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const { root, refreshDir, forgetFile, openFiles } = useWorkspaceStore()
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [preview, setPreview] = useState<ReplacePreview>()
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ReplaceResult>()
  const requestId = useRef(0)

  useEffect(() => {
    if (!open) {
      setPreview(undefined)
      setResult(undefined)
      setExcluded(new Set())
    }
  }, [open])

  useEffect(() => {
    if (!open || !root) return
    const q = query.trim()
    if (q.length < 2) {
      setPreview(undefined)
      return
    }

    const id = ++requestId.current
    setBusy(true)
    const timer = setTimeout(() => {
      void window.claudeUI
        .previewReplace({ root, query: q, replacement, caseSensitive, useRegex })
        .then((next) => {
          if (id !== requestId.current) return
          setPreview(next)
          setExcluded(new Set())
          setBusy(false)
        })
    }, 300)
    return () => clearTimeout(timer)
  }, [open, root, query, replacement, caseSensitive, useRegex])

  if (!open) return null

  const selected = preview?.files.filter((f) => !excluded.has(f.path)) ?? []
  const selectedCount = selected.reduce((n, f) => n + f.count, 0)

  async function apply(): Promise<void> {
    if (!root || selected.length === 0) return
    setBusy(true)
    const outcome = await window.claudeUI.applyReplace({
      root,
      query: query.trim(),
      replacement,
      caseSensitive,
      useRegex,
      paths: selected.map((f) => f.path)
    })
    setBusy(false)
    setResult(outcome)

    // Open files may have changed on disk — reload them.
    for (const file of openFiles) {
      if (selected.some((s) => s.path === file.path)) forgetFile(file.path)
    }
    await refreshDir(root)
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-14 bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[720px] max-w-[94%] max-h-[76vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <Replace size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px] flex-1">{t('Replace in project')}</span>
          {busy && <Loader2 size={12} className="animate-spin text-[var(--color-muted)]" />}
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="shrink-0 px-4 py-2 space-y-1.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Find…')}
              className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)]
                         rounded px-2 py-1 text-[11.5px] outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={() => setCaseSensitive((v) => !v)}
              title={t('Match case')}
              className={`p-1 rounded transition-colors ${
                caseSensitive
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-surface-2)]'
              }`}
            >
              <CaseSensitive size={13} />
            </button>
            <button
              onClick={() => setUseRegex((v) => !v)}
              title={t('Regular expression')}
              className={`p-1 rounded transition-colors ${
                useRegex
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'hover:bg-[var(--color-surface-2)]'
              }`}
            >
              <Regex size={13} />
            </button>
          </div>

          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={useRegex ? t('Replace with… ($1 for groups)') : t('Replace with…')}
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                       rounded px-2 py-1 text-[11.5px] outline-none focus:border-[var(--color-accent)]"
          />

          {preview?.error && (
            <p className="flex items-center gap-1 text-[10.5px] text-red-400">
              <AlertTriangle size={10} />
              {preview.error}
            </p>
          )}
          {preview && !preview.error && (
            <p className="text-[10.5px] text-[var(--color-muted)]">
              {t('{total} occurrences in {files} files', { total: preview.total, files: preview.files.length })}
              {excluded.size > 0 && ` · ${t('{count} selected', { count: selectedCount })}`}
            </p>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {preview?.files.map((file) => {
            const off = excluded.has(file.path)
            return (
              <div key={file.path} className="border-b border-[var(--color-border)] last:border-0">
                <label className="flex items-center gap-2 px-3 py-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={() =>
                      setExcluded((prev) => {
                        const next = new Set(prev)
                        if (off) next.delete(file.path)
                        else next.add(file.path)
                        return next
                      })
                    }
                    className="accent-[var(--color-accent)]"
                  />
                  <span
                    className={`text-[11px] font-mono truncate ${off ? 'text-[var(--color-muted)] line-through' : ''}`}
                  >
                    {file.relativePath}
                  </span>
                  <span className="ml-auto text-[9.5px] text-[var(--color-muted)] shrink-0">
                    {file.count}
                  </span>
                </label>

                {!off &&
                  file.samples.map((sample, i) => (
                    <div key={i} className="px-3 pb-1 text-[10px] font-mono">
                      <div className="flex gap-1.5">
                        <span className="text-[var(--color-muted)] w-8 text-right shrink-0">
                          {sample.line}
                        </span>
                        <span className="text-red-300 truncate">− {sample.before}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <span className="w-8 shrink-0" />
                        <span className="text-emerald-300 truncate">+ {sample.after}</span>
                      </div>
                    </div>
                  ))}
              </div>
            )
          })}

          {query.trim().length >= 2 && !busy && preview?.files.length === 0 && (
            <p className="px-4 py-3 text-[11.5px] text-[var(--color-muted)]">{t('Nothing found.')}</p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          {result ? (
            <p className="flex items-center gap-1.5 text-[11px] text-emerald-400 flex-1">
              <Check size={12} />
              {t('Replaced {count} in {files} files', { count: result.replacements, files: result.changedFiles })}
              {result.failed.length > 0 && (
                <span className="text-red-400">· {t('{count} failed', { count: result.failed.length })}</span>
              )}
            </p>
          ) : (
            <p className="text-[10.5px] text-[var(--color-muted)] flex-1">
              {t('A replace cannot be undone in one move — check the list above.')}
            </p>
          )}

          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {result ? t('Close') : t('Cancel')}
          </button>
          {!result && (
            <button
              onClick={() => void apply()}
              disabled={busy || selected.length === 0}
              className="px-3 py-1.5 rounded-md text-[12px] bg-[var(--color-accent)]
                         disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
            >
              {t('Replace')} {selectedCount > 0 && `(${selectedCount})`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
