import { useEffect, useRef, useState } from 'react'
import {
  Bug,
  Play,
  Square,
  CornerDownRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  ChevronDown,
  CircleDot,
  Loader2
} from 'lucide-react'
import type { DebugVariable } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useDebugStore } from '../store/debug-store'
import { useTranslate } from '../i18n'

function VariableRow({
  variable,
  depth
}: {
  variable: DebugVariable
  depth: number
}): React.JSX.Element {
  const { variables, expand } = useDebugStore()
  const [open, setOpen] = useState(false)
  const children = variable.objectId ? variables[variable.objectId] : undefined

  async function toggle(): Promise<void> {
    if (!variable.objectId) return
    if (!open) await expand(variable.objectId)
    setOpen(!open)
  }

  return (
    <>
      <div
        onClick={() => void toggle()}
        style={{ paddingLeft: 4 + depth * 12 }}
        className={`flex items-center gap-1 py-[1px] pr-2 rounded text-[11px] ${
          variable.objectId ? 'cursor-pointer hover:bg-[var(--color-surface-2)]' : ''
        }`}
      >
        {variable.objectId ? (
          open ? (
            <ChevronDown size={9} className="shrink-0 text-[var(--color-muted)]" />
          ) : (
            <ChevronRight size={9} className="shrink-0 text-[var(--color-muted)]" />
          )
        ) : (
          <span className="w-[9px] shrink-0" />
        )}
        <span className="font-mono text-[var(--color-accent)] shrink-0">{variable.name}</span>
        <span className="text-[var(--color-muted)] truncate" title={variable.value}>
          {variable.value}
        </span>
      </div>

      {open &&
        children?.map((child) => (
          <VariableRow key={`${variable.objectId}:${child.name}`} variable={child} depth={depth + 1} />
        ))}
    </>
  )
}

/**
 * Node debugging panel.
 *
 * Runs whatever file is open in the editor. A separate launch-configuration screen
 * would be overkill here: in a personal tool you almost always debug the thing you
 * are looking at.
 */
export default function DebugPanel(): React.JSX.Element {
  const t = useTranslate()
  const { root, activePath } = useWorkspaceStore()
  const { state, breakpoints, scopes, variables, selectedFrame, setState, loadBreakpoints, selectFrame, start, stop } =
    useDebugStore()
  const [expression, setExpression] = useState('')
  const [answer, setAnswer] = useState<string>()
  const [busy, setBusy] = useState(false)
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    void loadBreakpoints()
    return window.claudeUI.onDebugState(setState)
  }, [])

  useEffect(() => {
    const node = outputRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [state.output])

  const runnable = activePath && /\.(js|mjs|cjs)$/.test(activePath)

  async function run(): Promise<void> {
    if (!root || !activePath) return
    setBusy(true)
    setAnswer(undefined)
    await start(root, activePath)
    setBusy(false)
  }

  async function evaluate(): Promise<void> {
    if (!selectedFrame || !expression.trim()) return
    setAnswer(await window.claudeUI.debugEvaluate(selectedFrame, expression.trim()))
  }

  return (
    <div className="h-full flex flex-col text-[11px]">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
        {state.running ? (
          <button
            onClick={() => void stop()}
            title={t('Stop')}
            className="p-1 rounded hover:bg-[var(--color-surface-2)] text-red-400"
          >
            <Square size={11} />
          </button>
        ) : (
          <button
            onClick={() => void run()}
            disabled={!runnable || busy}
            title={
              runnable
                ? t('Run {file}', { file: activePath?.split('/').pop() ?? '' })
                : t('Open a .js file')
            }
            className="p-1 rounded hover:bg-[var(--color-surface-2)] text-emerald-400
                       disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          </button>
        )}

        <span className="w-px h-3 bg-[var(--color-border)] mx-0.5" />

        <button
          onClick={() => void window.claudeUI.debugResume()}
          disabled={!state.paused}
          title={t('Continue')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-25"
        >
          <Play size={11} />
        </button>
        <button
          onClick={() => void window.claudeUI.debugStep('over')}
          disabled={!state.paused}
          title={t('Step over')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-25"
        >
          <CornerDownRight size={11} />
        </button>
        <button
          onClick={() => void window.claudeUI.debugStep('into')}
          disabled={!state.paused}
          title={t('Step into')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-25"
        >
          <ArrowDownToLine size={11} />
        </button>
        <button
          onClick={() => void window.claudeUI.debugStep('out')}
          disabled={!state.paused}
          title={t('Step out')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-25"
        >
          <ArrowUpFromLine size={11} />
        </button>

        <span className="ml-auto text-[10px] text-[var(--color-muted)]">
          {state.paused
            ? `${t('paused')} · ${state.reason}`
            : state.running
              ? t('running')
              : t('{count} breakpoints', { count: breakpoints.length })}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className="w-[220px] shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
          <p className="px-2 py-1 text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
            {t('Call stack')}
          </p>
          {state.frames.length === 0 && (
            <p className="px-2 text-[10.5px] text-[var(--color-muted)]">
              {state.running ? t('running…') : t('not started')}
            </p>
          )}
          {state.frames.map((frame) => (
            <button
              key={frame.id}
              onClick={() => void selectFrame(frame.id)}
              className={`w-full text-left px-2 py-0.5 hover:bg-[var(--color-surface-2)] ${
                selectedFrame === frame.id ? 'bg-[var(--color-accent-soft)]' : ''
              }`}
            >
              <span className="text-[11px]">{frame.name}</span>
              <span className="block text-[9.5px] text-[var(--color-muted)] truncate">
                {frame.path?.split('/').pop()}:{frame.line}
              </span>
            </button>
          ))}

          {breakpoints.length > 0 && (
            <>
              <p className="px-2 py-1 mt-1 text-[9.5px] uppercase tracking-wide
                            text-[var(--color-muted)] border-t border-[var(--color-border)]">
                {t('Breakpoints')}
              </p>
              {breakpoints.map((bp) => (
                <div key={`${bp.path}:${bp.line}`} className="flex items-center gap-1 px-2 py-0.5">
                  <CircleDot size={8} className="text-red-400 shrink-0" />
                  <span className="text-[10px] truncate">
                    {bp.path.split('/').pop()}:{bp.line}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="w-[260px] shrink-0 border-r border-[var(--color-border)] overflow-y-auto">
          <p className="px-2 py-1 text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
            {t('Variables')}
          </p>
          {scopes.map((scope) => (
            <div key={scope.name}>
              <p className="px-2 text-[10px] text-[var(--color-muted)]">{scope.name}</p>
              {(scope.objectId ? (variables[scope.objectId] ?? []) : []).map((variable) => (
                <VariableRow key={variable.name} variable={variable} depth={1} />
              ))}
            </div>
          ))}

          {state.paused && (
            <div className="px-2 py-1.5 border-t border-[var(--color-border)] mt-1">
              <input
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void evaluate()}
                placeholder={t('Evaluate expression…')}
                className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                           rounded px-1.5 py-0.5 text-[10.5px] font-mono outline-none
                           focus:border-[var(--color-accent)]"
              />
              {answer !== undefined && (
                <p className="mt-1 text-[10.5px] font-mono break-all">{answer}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <p className="shrink-0 flex items-center gap-1 px-2 py-1 text-[9.5px] uppercase
                        tracking-wide text-[var(--color-muted)]">
            <Bug size={9} />
            {t('Output')}
          </p>
          <pre
            ref={outputRef}
            className="flex-1 min-h-0 overflow-auto px-2 pb-2 font-mono text-[10.5px]
                       whitespace-pre-wrap text-[var(--color-muted)]"
          >
            {state.output || (state.running ? '' : t('Run a file to see its output.'))}
          </pre>
        </div>
      </div>
    </div>
  )
}
