import { useState } from 'react'
import type { ChatMessage } from '@shared/types'
import { ChevronRight, ChevronDown, Wrench, AlertTriangle, Bot } from 'lucide-react'
import type { ToolCall } from '@shared/types'
import { useTranslate } from '../i18n'

/** One-line call caption: the most telling argument rather than the whole JSON. */
function summarize(name: string, input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const i = input as Record<string, unknown>
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = i[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    return ''
  }
  switch (name) {
    case 'Bash':
      return pick('command')
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return pick('file_path', 'notebook_path')
    case 'Grep':
      return pick('pattern')
    case 'Glob':
      return pick('pattern')
    case 'WebFetch':
    case 'WebSearch':
      return pick('url', 'query')
    case 'Agent':
      return pick('description')
    case 'Skill':
      return pick('skill')
    default:
      return pick('description', 'command', 'file_path', 'pattern', 'query', 'prompt')
  }
}

export default function ToolCallCard({
  call,
  onOpenAgent
}: {
  call: ToolCall
  /** Set only for Agent calls — loads the subagent branch on demand. */
  onOpenAgent?: (agentId: string) => Promise<ChatMessage[]>
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [branch, setBranch] = useState<ChatMessage[]>()
  const [loadingBranch, setLoadingBranch] = useState(false)
  const summary = summarize(call.name, call.input)
  const failed = call.result?.isError === true
  const pending = !call.result

  return (
    <div className="my-1 border border-[var(--color-border)] rounded-md overflow-hidden bg-[var(--color-surface)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-[var(--color-surface-2)] transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {call.agentId ? (
          <Bot size={12} className="text-violet-400 shrink-0" />
        ) : failed ? (
          <AlertTriangle size={12} className="text-red-400 shrink-0" />
        ) : (
          <Wrench size={12} className="text-[var(--color-muted)] shrink-0" />
        )}
        <span className="text-[11.5px] font-medium shrink-0">{call.name}</span>
        {summary && (
          <span className="text-[11px] text-[var(--color-muted)] truncate font-mono">{summary}</span>
        )}
        {pending && (
          <span className="ml-auto text-[10px] text-amber-400 shrink-0">{t('running…')}</span>
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-2 py-1.5 space-y-2">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1">
              {t('Arguments')}
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto text-neutral-300">
              {JSON.stringify(call.input, null, 2)}
            </pre>
          </div>
          {call.agentId && onOpenAgent && (
            <div>
              <button
                onClick={() => {
                  if (branch || loadingBranch) {
                    setBranch(branch ? undefined : branch)
                    return
                  }
                  setLoadingBranch(true)
                  void onOpenAgent(call.agentId!)
                    .then(setBranch)
                    .finally(() => setLoadingBranch(false))
                }}
                className="text-[10.5px] text-violet-400 hover:text-violet-300 transition-colors"
              >
                {loadingBranch
                  ? t('Loading branch…')
                  : branch
                    ? t('Hide subagent branch')
                    : t('Show subagent branch')}
              </button>

              {branch && (
                <div className="mt-1.5 pl-2 border-l-2 border-violet-900/60 space-y-1.5">
                  {branch.length === 0 && (
                    <p className="text-[10.5px] text-[var(--color-muted)]">{t('Branch is empty.')}</p>
                  )}
                  {branch.map((m) => (
                    <div key={m.uuid}>
                      <div className="text-[9px] uppercase text-[var(--color-muted)]">
                        {m.role === 'user' ? t('task') : t('subagent')}
                      </div>
                      {m.text.trim() && (
                        <div className="text-[10.5px] whitespace-pre-wrap break-words text-neutral-300">
                          {m.text.length > 1200 ? `${m.text.slice(0, 1200)}…` : m.text}
                        </div>
                      )}
                      {m.toolCalls.length > 0 && (
                        <div className="text-[9.5px] text-[var(--color-muted)] font-mono">
                          {m.toolCalls.map((c) => c.name).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {call.result && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1">
                {t('Result')} {failed && <span className="text-red-400">({t('error')})</span>}
              </div>
              <pre
                className={`text-[11px] font-mono whitespace-pre-wrap break-words max-h-80 overflow-y-auto ${
                  failed ? 'text-red-300' : 'text-neutral-300'
                }`}
              >
                {call.result.content.slice(0, 20_000) ||
                  t('(empty)')}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
