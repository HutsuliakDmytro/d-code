import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Check, Loader2, RotateCcw, MessageSquareText } from 'lucide-react'
import DiffView from './DiffView'
import { useSettingsStore } from '../store/settings-store'
import { useTranslate } from '../i18n'

export interface InlineTarget {
  path: string
  language: string
  selection: string
  /** Lines around the selection — the model needs to see where the code sits. */
  context?: string
  /** Document offsets where the result should be inserted. */
  from: number
  to: number
}

type Stage =
  | { kind: 'ask' }
  | { kind: 'working' }
  | { kind: 'result'; code: string; cost?: number }
  | { kind: 'explain'; text: string; cost?: number }
  | { kind: 'error'; message: string }

/**
 * Inline work on a selected fragment.
 *
 * The result is never applied silently: a diff against the selection comes first,
 * and the editor is only touched after an explicit confirmation.
 */
export default function InlineChat({
  target,
  cwd,
  onApply,
  onClose
}: {
  target: InlineTarget
  cwd?: string
  onApply: (code: string) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const model = useSettingsStore((s) => s.model)
  const [instruction, setInstruction] = useState('')
  const [stage, setStage] = useState<Stage>({ kind: 'ask' })
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(): Promise<void> {
    if (!cwd || !instruction.trim()) return
    setStage({ kind: 'working' })

    const result = await window.claudeUI.editSelection({
      cwd,
      path: target.path,
      language: target.language,
      selection: target.selection,
      instruction: instruction.trim(),
      context: target.context,
      model: model || undefined
    })

    if (!result.ok || !result.code) {
      setStage({ kind: 'error', message: result.error ?? t('Could not get a response') })
      return
    }
    setStage({ kind: 'result', code: result.code, cost: result.costUsd })
  }

  async function explain(): Promise<void> {
    if (!cwd) return
    setStage({ kind: 'working' })

    const result = await window.claudeUI.explainSelection({
      cwd,
      path: target.path,
      language: target.language,
      selection: target.selection,
      model: model || undefined
    })

    if (!result.ok || !result.text) {
      setStage({ kind: 'error', message: result.error ?? t('Could not get a response') })
      return
    }
    setStage({ kind: 'explain', text: result.text, cost: result.costUsd })
  }

  const lines = target.selection.split('\n').length

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center pt-20 bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[680px] max-w-[94%] max-h-[72vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]">
          <Sparkles size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px] flex-1 truncate">
            {target.path.split('/').at(-1)} · {t('{count} lines', { count: lines })}
          </span>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        {(stage.kind === 'ask' || stage.kind === 'error') && (
          <div className="shrink-0 px-4 py-3 space-y-2">
            <textarea
              ref={inputRef}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void run()
                }
              }}
              rows={2}
              placeholder={t('What should happen to this fragment? For example: add error handling')}
              className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                         rounded-md px-2 py-1.5 text-[12px] outline-none resize-none
                         focus:border-[var(--color-accent)] placeholder:text-[var(--color-muted)]"
            />

            {stage.kind === 'error' && (
              <p className="text-[10.5px] text-red-400">{stage.message}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => void explain()}
                disabled={!cwd}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px]
                           border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]
                           disabled:opacity-40 transition-colors"
              >
                <MessageSquareText size={12} />
                {t('Explain')}
              </button>
              <button
                onClick={() => void run()}
                disabled={!cwd || !instruction.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md
                           text-[12px] bg-[var(--color-accent)] disabled:opacity-30
                           disabled:cursor-not-allowed transition-opacity"
              >
                <Sparkles size={12} />
                {t('Rewrite (↵)')}
              </button>
            </div>
          </div>
        )}

        {stage.kind === 'working' && (
          <div className="flex-1 flex items-center justify-center gap-2 py-8 text-[12px] text-[var(--color-muted)]">
            <Loader2 size={14} className="animate-spin" />
            {t('Thinking…')}
          </div>
        )}

        {stage.kind === 'explain' && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              <p className="text-[12px] whitespace-pre-wrap leading-relaxed">{stage.text}</p>
            </div>
            <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)]">
              {stage.cost !== undefined && (
                <span className="text-[10px] text-[var(--color-muted)] flex-1">
                  ${stage.cost.toFixed(4)}
                </span>
              )}
              <button
                onClick={() => setStage({ kind: 'ask' })}
                className="px-3 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                           hover:bg-[var(--color-surface-2)] transition-colors"
              >
                {t('Back')}
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-[12px] bg-[var(--color-accent)]"
              >
                {t('Close')}
              </button>
            </div>
          </>
        )}

        {stage.kind === 'result' && (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              <DiffView before={target.selection} after={stage.code} maxHeight="none" />
            </div>
            <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-[var(--color-border)]">
              <span className="text-[10px] text-[var(--color-muted)] flex-1">
                {t('Changes not applied yet')}
                {stage.cost !== undefined && ` · $${stage.cost.toFixed(4)}`}
              </span>
              <button
                onClick={() => setStage({ kind: 'ask' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px]
                           border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]
                           transition-colors"
              >
                <RotateCcw size={12} />
                {t('Again')}
              </button>
              <button
                onClick={() => {
                  onApply(stage.code)
                  onClose()
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px]
                           bg-[var(--color-accent)] hover:opacity-90 transition-opacity"
              >
                <Check size={12} />
                {t('Apply')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
