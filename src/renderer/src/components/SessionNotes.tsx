import { useEffect, useRef, useState } from 'react'
import { Download, NotebookPen, Check } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { useTranslate } from '../i18n'
import ExportDialog from './ExportDialog'

/** Session notes, and the entry point to exporting the conversation. */
export default function SessionNotes(): React.JSX.Element | null {
  const t = useTranslate()
  const selected = useAppStore((s) => s.selected)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const [exporting, setExporting] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const sessionId = selected?.meta.sessionId

  useEffect(() => {
    if (!sessionId) return
    setSaved(false)
    void window.claudeUI.getNote(sessionId).then((note) => setText(note.text))
  }, [sessionId])

  // Debounced save: there is no need to touch the file on every keystroke.
  useEffect(() => {
    if (!sessionId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void window.claudeUI.saveNote(sessionId, text).then(() => {
        setSaved(true)
        setTimeout(() => setSaved(false), 1500)
      })
    }, 700)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
    // The initial load should not trigger a write — though rewriting identical
    // text is harmless, so no extra flag is warranted here.
  }, [text, sessionId])

  if (!selected) return null

  return (
    <section className="pt-1 border-t border-[var(--color-border)]">
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide
                     text-[var(--color-muted)] mb-1.5">
        <NotebookPen size={10} />
        {t('Notes')}
        {saved && <Check size={10} className="text-emerald-400" />}
        <button
          onClick={() => setExporting(true)}
          title={t('Export session…')}
          className="ml-auto p-0.5 rounded hover:bg-[var(--color-surface-2)]
                     hover:text-[var(--color-text)] transition-colors"
        >
          <Download size={10} />
        </button>
      </h3>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder={t('What this session is about, what is left to do…')}
        className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                   rounded-md px-2 py-1 text-[11px] outline-none resize-y
                   focus:border-[var(--color-accent)] placeholder:text-[var(--color-muted)]"
      />

      <ExportDialog open={exporting} onClose={() => setExporting(false)} />
    </section>
  )
}
