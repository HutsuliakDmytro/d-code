import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, AlertTriangle, Play, RefreshCw, Square, ShieldCheck } from 'lucide-react'
import type { Diagnostic, DiagnosticsState } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { relativeTime } from '../lib/format'
import { useTranslate } from '../i18n'

/** Type and lint errors, each jumping to its place in the code. */
export default function ProblemsPanel(): React.JSX.Element {
  const t = useTranslate()
  const { root, openFile } = useWorkspaceStore()
  const [state, setState] = useState<DiagnosticsState>({ running: false, diagnostics: [] })
  const [source, setSource] = useState<'typescript' | 'eslint'>('typescript')

  useEffect(() => {
    void window.claudeUI.getDiagnostics().then(setState)
    return window.claudeUI.onDiagnostics(setState)
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<string, Diagnostic[]>()
    for (const item of state.diagnostics) {
      const list = map.get(item.relativePath)
      if (list) list.push(item)
      else map.set(item.relativePath, [item])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [state.diagnostics])

  const errors = state.diagnostics.filter((d) => d.severity === 'error').length
  const warnings = state.diagnostics.length - errors

  if (!root) {
    return (
      <p className="px-3 py-3 text-[11.5px] text-[var(--color-muted)]">
        {t('Select a session to check the project.')}
      </p>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-border)]">
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as typeof source)}
          className="bg-transparent text-[10.5px] outline-none cursor-pointer"
        >
          <option value="typescript">TypeScript</option>
          <option value="eslint">ESLint</option>
        </select>

        {state.running ? (
          <button
            onClick={() => void window.claudeUI.stopDiagnostics()}
            title={t('Stop')}
            className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
          >
            <Square size={10} className="fill-red-300 text-red-300" />
          </button>
        ) : (
          <button
            onClick={() => void window.claudeUI.runDiagnostics(root, source)}
            title={t('Check')}
            className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
          >
            <Play size={10} />
          </button>
        )}

        {state.running && <RefreshCw size={10} className="animate-spin text-[var(--color-muted)]" />}

        <div className="ml-auto flex items-center gap-2 text-[9.5px]">
          {errors > 0 && (
            <span className="flex items-center gap-0.5 text-red-400">
              <AlertCircle size={9} />
              {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="flex items-center gap-0.5 text-amber-400">
              <AlertTriangle size={9} />
              {warnings}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {state.error && (
          <p className="px-3 py-2 text-[11px] text-amber-400">{state.error}</p>
        )}

        {!state.error && state.diagnostics.length === 0 && !state.running && (
          <div className="px-3 py-3 flex items-center gap-1.5 text-[11.5px] text-[var(--color-muted)]">
            {state.finishedAt ? (
              <>
                <ShieldCheck size={12} className="text-emerald-400" />
                {t('Clean')} · {relativeTime(state.finishedAt)}
              </>
            ) : (
              t('Press ▷ to check the project.')
            )}
          </div>
        )}

        {grouped.map(([path, items]) => (
          <div key={path} className="mb-1">
            <div className="px-2 py-0.5 text-[10px] font-mono text-[var(--color-accent)] truncate">
              {path}
            </div>
            {items.map((item, i) => (
              <button
                key={`${item.line}-${i}`}
                onClick={() => void openFile(item.path, item.line)}
                title={item.message}
                className="w-full flex items-baseline gap-1.5 px-3 py-[3px] text-left
                           hover:bg-[var(--color-surface-2)] transition-colors"
              >
                {item.severity === 'error' ? (
                  <AlertCircle size={9} className="text-red-400 shrink-0 translate-y-0.5" />
                ) : (
                  <AlertTriangle size={9} className="text-amber-400 shrink-0 translate-y-0.5" />
                )}
                <span className="text-[9.5px] text-[var(--color-muted)] shrink-0">
                  {item.line}:{item.column}
                </span>
                <span className="text-[10.5px] text-neutral-300 line-clamp-2 leading-snug">
                  {item.message}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
