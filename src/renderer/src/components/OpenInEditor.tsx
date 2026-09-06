import { useEffect, useRef, useState } from 'react'
import { Code2, ChevronDown } from 'lucide-react'
import type { EditorEntry } from '@shared/ipc'
import { useTranslate } from '../i18n'

const LAST_EDITOR_KEY = 'claude-ui-last-editor'

/**
 * Opens the working directory in an editor.
 *
 * Clicking the button opens the last used editor straight away; the caret beside
 * it offers the others. The list contains only what is actually installed.
 */
export default function OpenInEditor({ path }: { path?: string }): React.JSX.Element | null {
  const t = useTranslate()
  const [editors, setEditors] = useState<EditorEntry[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string>()
  const [last, setLast] = useState<string>(() => localStorage.getItem(LAST_EDITOR_KEY) ?? '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.claudeUI.detectEditors().then(setEditors)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(undefined), 4000)
    return () => clearTimeout(t)
  }, [error])

  if (!path || editors.length === 0) return null

  const preferred = editors.find((e) => e.id === last) ?? editors[0]

  async function openWith(editor: EditorEntry): Promise<void> {
    setOpen(false)
    setLast(editor.id)
    localStorage.setItem(LAST_EDITOR_KEY, editor.id)
    const result = await window.claudeUI.openInEditor(editor.id, path!)
    if (!result.ok) setError(result.error ?? t('Could not open'))
  }

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        onClick={() => void openWith(preferred)}
        title={t('Open in {editor}', { editor: preferred.name })}
        className="flex items-center gap-1 pl-1.5 pr-1 py-1 rounded-l-md text-[10.5px]
                   hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <Code2 size={11} />
        {preferred.name}
      </button>
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('Choose editor')}
        className="px-0.5 py-1 rounded-r-md hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 right-0 min-w-[180px] bg-[var(--color-surface)]
                     border border-[var(--color-border)] rounded-md shadow-2xl overflow-hidden z-20 py-1"
        >
          {editors.map((e) => (
            <button
              key={e.id}
              onClick={() => void openWith(e)}
              className="w-full text-left px-3 py-1.5 text-[11.5px] hover:bg-[var(--color-surface-2)]
                         transition-colors"
            >
              {e.name}
              {e.id === last && <span className="ml-1 text-[var(--color-muted)]">·</span>}
            </button>
          ))}
        </div>
      )}

      {error && (
        <span className="absolute top-full mt-1 right-0 text-[10px] text-red-400 whitespace-nowrap">
          {error}
        </span>
      )}
    </div>
  )
}
