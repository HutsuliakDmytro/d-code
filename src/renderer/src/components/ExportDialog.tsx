import { useState } from 'react'
import { Download, Loader2, ShieldCheck, X } from 'lucide-react'
import type { ExportFormat, ExportOptions } from '@shared/ipc'
import { useAppStore } from '../store/app-store'
import { useTranslate } from '../i18n'

function Checkbox({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint: string
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] accent-[var(--color-accent)]"
      />
      <span>
        <span className="text-[11.5px] group-hover:text-[var(--color-text)]">{label}</span>
        <span className="block text-[10px] text-[var(--color-muted)] leading-snug">{hint}</span>
      </span>
    </label>
  )
}

/**
 * Export options for a session.
 *
 * Redaction defaults to on: the common reason to export is to show the session
 * to somebody else, and a transcript carries absolute paths and whatever
 * secrets passed through a tool result.
 */
export default function ExportDialog({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const selected = useAppStore((s) => s.selected)
  const [options, setOptions] = useState<ExportOptions>({
    format: 'md',
    redact: true,
    includeTools: true,
    includeThinking: false
  })
  const [busy, setBusy] = useState(false)

  if (!open || !selected) return null

  async function run(): Promise<void> {
    if (!selected) return
    setBusy(true)
    try {
      const path = await window.claudeUI.exportSession(
        selected.meta.filePath,
        selected.meta.projectPath,
        selected.meta.encodedDir,
        options
      )
      // An undefined path means the save dialog was cancelled — not an error,
      // and a reason to leave this dialog open so the choice is not lost.
      if (path) onClose()
    } finally {
      setBusy(false)
    }
  }

  const formats: Array<{ id: ExportFormat; label: string; hint: string }> = [
    { id: 'md', label: 'Markdown', hint: t('For a pull request, an issue or a gist.') },
    { id: 'html', label: 'HTML', hint: t('Self-contained page, opens anywhere.') }
  ]

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-w-[94%] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <Download size={14} className="text-[var(--color-accent)]" />
          <span className="text-[12.5px]">{t('Export session')}</span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <p className="text-[11px] text-[var(--color-muted)] truncate">{selected.meta.title}</p>

          <div className="flex gap-2">
            {formats.map((f) => (
              <button
                key={f.id}
                onClick={() => setOptions((o) => ({ ...o, format: f.id }))}
                title={f.hint}
                className={`flex-1 px-2 py-1.5 rounded border text-[11.5px] transition-colors ${
                  options.format === f.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-surface-2)]'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Checkbox
              checked={options.redact}
              onChange={(v) => setOptions((o) => ({ ...o, redact: v }))}
              label={t('Redact secrets and paths')}
              hint={t('API keys, tokens, e-mail addresses; your home directory becomes ~.')}
            />
            <Checkbox
              checked={options.includeTools}
              onChange={(v) => setOptions((o) => ({ ...o, includeTools: v }))}
              label={t('Include tool calls')}
              hint={t('Folded away, but they make the document much longer.')}
            />
            <Checkbox
              checked={options.includeThinking}
              onChange={(v) => setOptions((o) => ({ ...o, includeThinking: v }))}
              label={t('Include thinking')}
              hint={t('Reasoning blocks, when the transcript has them.')}
            />
          </div>

          {!options.redact && (
            <p className="text-[10px] text-amber-400 leading-snug">
              {t('Without redaction the file keeps absolute paths and anything secret a tool printed.')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-[var(--color-border)]">
          {options.redact && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <ShieldCheck size={11} />
              {t('Redaction on')}
            </span>
          )}
          <button
            onClick={() => void run()}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded text-[11.5px]
                       bg-[var(--color-accent)] text-white disabled:opacity-50
                       hover:brightness-110 transition-all"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            {t('Export')}
          </button>
        </div>
      </div>
    </div>
  )
}
