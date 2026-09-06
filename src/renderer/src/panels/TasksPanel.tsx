import { useEffect, useRef, useState } from 'react'
import {
  Play,
  Square,
  FlaskConical,
  Hammer,
  Rocket,
  ShieldCheck,
  Terminal,
  Trash2,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import type { ScriptEntry, TaskState } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

const ICONS: Record<ScriptEntry['kind'], React.ReactNode> = {
  test: <FlaskConical size={11} className="text-emerald-400" />,
  build: <Hammer size={11} className="text-amber-400" />,
  dev: <Rocket size={11} className="text-blue-400" />,
  lint: <ShieldCheck size={11} className="text-violet-400" />,
  other: <Terminal size={11} className="text-[var(--color-muted)]" />
}

function Summary({ state }: { state: TaskState }): React.JSX.Element | null {
  const s = state.summary
  if (!s) return null
  return (
    <span className="flex items-center gap-1.5 text-[9.5px] shrink-0">
      {s.passed !== undefined && <span className="text-emerald-400">{s.passed} ✓</span>}
      {s.failed ? <span className="text-red-400">{s.failed} ✗</span> : null}
      {s.skipped ? <span className="text-[var(--color-muted)]">{s.skipped} –</span> : null}
      {s.problems ? <span className="text-red-400">{s.problems} errors</span> : null}
    </span>
  )
}

/** Runs project scripts with live output. */
export default function TasksPanel(): React.JSX.Element {
  const t = useTranslate()
  const root = useWorkspaceStore((s) => s.root)
  const [scripts, setScripts] = useState<ScriptEntry[]>([])
  const [tasks, setTasks] = useState<TaskState[]>([])
  const [openId, setOpenId] = useState<string>()
  const [output, setOutput] = useState<Record<string, string>>({})
  const outputRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!root) return
    void window.claudeUI.listScripts(root).then(setScripts)
  }, [root])

  useEffect(() => {
    void window.claudeUI.listTasks().then(setTasks)

    const offChunk = window.claudeUI.onTaskChunk((chunk) => {
      setOutput((prev) => {
        // Keep only the tail: a long build would otherwise stall rendering.
        const next = (prev[chunk.id] ?? '') + chunk.text
        return { ...prev, [chunk.id]: next.length > 200_000 ? next.slice(-200_000) : next }
      })
    })
    const offState = window.claudeUI.onTaskState((state) => {
      setTasks((prev) => {
        const rest = prev.filter((t) => t.id !== state.id)
        return [state, ...rest].sort((a, b) => b.startedAt - a.startedAt)
      })
    })
    return () => {
      offChunk()
      offState()
    }
  }, [])

  // Auto-scroll the output while the task is running.
  useEffect(() => {
    const el = outputRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [output, openId])

  async function run(script: string): Promise<void> {
    if (!root) return
    const state = await window.claudeUI.startTask(root, script)
    setOpenId(state.id)
    setOutput((prev) => ({ ...prev, [state.id]: '' }))
  }

  async function toggle(id: string): Promise<void> {
    if (openId === id) {
      setOpenId(undefined)
      return
    }
    setOpenId(id)
    // Output may have accumulated before we subscribed.
    if (!output[id]) {
      const existing = await window.claudeUI.getTaskOutput(id)
      setOutput((prev) => ({ ...prev, [id]: existing }))
    }
  }

  if (!root) {
    return (
      <p className="px-3 py-3 text-[11.5px] text-[var(--color-muted)]">
        {t('Select a session to see the project scripts.')}
      </p>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-2 py-1 border-b border-[var(--color-border)]">
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
          {t('Scripts')}
        </span>
      </div>

      <div className="shrink-0 max-h-[35%] overflow-y-auto py-1 border-b border-[var(--color-border)]">
        {scripts.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">
            {t('No package.json with scripts in this project.')}
          </p>
        )}
        {scripts.map((s) => (
          <button
            key={s.name}
            onClick={() => void run(s.name)}
            title={s.command}
            className="w-full flex items-center gap-1.5 px-2 py-[3px] text-left
                       hover:bg-[var(--color-surface-2)] transition-colors group"
          >
            {ICONS[s.kind]}
            <span className="text-[11.5px] truncate">{s.name}</span>
            <Play
              size={9}
              className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            />
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tasks.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">{t('No runs yet.')}</p>
        )}

        {tasks.map((task) => {
          const open = openId === task.id
          const failed = !task.running && task.exitCode !== 0

          return (
            <div key={task.id} className="border-b border-[var(--color-border)] last:border-0">
              <div className="flex items-center gap-1.5 px-2 py-1 hover:bg-[var(--color-surface-2)]">
                <button onClick={() => void toggle(task.id)} className="shrink-0">
                  {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>

                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    task.running
                      ? 'bg-amber-400 animate-pulse'
                      : failed
                        ? 'bg-red-400'
                        : 'bg-emerald-400'
                  }`}
                />

                <button
                  onClick={() => void toggle(task.id)}
                  className="text-[11px] truncate flex-1 text-left"
                >
                  {task.script}
                </button>

                <Summary state={task} />

                {task.running ? (
                  <button
                    onClick={() => void window.claudeUI.stopTask(task.id)}
                    title={t('Stop')}
                    className="p-0.5 rounded hover:bg-[var(--color-surface)] shrink-0"
                  >
                    <Square size={9} className="fill-red-300 text-red-300" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      void window.claudeUI.forgetTask(task.id)
                      setTasks((prev) => prev.filter((t) => t.id !== task.id))
                    }}
                    title={t('Remove')}
                    className="p-0.5 rounded hover:bg-[var(--color-surface)] shrink-0"
                  >
                    <Trash2 size={9} />
                  </button>
                )}
              </div>

              {open && (
                <pre
                  ref={outputRef}
                  className="max-h-[260px] overflow-auto px-2 py-1 text-[10px] font-mono
                             whitespace-pre-wrap break-all bg-[var(--color-bg)] text-neutral-300"
                >
                  {output[task.id] || t('No output yet…')}
                </pre>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
