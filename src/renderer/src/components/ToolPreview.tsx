import { useEffect, useState } from 'react'
import { FilePlus2, FileText, Terminal } from 'lucide-react'
import DiffView from './DiffView'
import { useTranslate } from '../i18n'

/** File-tool arguments worth rendering as a diff rather than raw JSON. */
interface EditInput {
  file_path?: string
  old_string?: string
  new_string?: string
  content?: string
  edits?: Array<{ old_string?: string; new_string?: string }>
  command?: string
  description?: string
}

/**
 * Human-readable preview of what a tool is about to do.
 *
 * File edits are shown as a real diff against what is on disk — that is the review
 * that matters before applying. Everything else falls back to readable JSON.
 */
export default function ToolPreview({
  toolName,
  input
}: {
  toolName: string
  input: unknown
}): React.JSX.Element {
  const t = useTranslate()
  const args = (typeof input === 'object' && input !== null ? input : {}) as EditInput
  const [current, setCurrent] = useState<string>()
  const [missing, setMissing] = useState(false)

  const isFileTool = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(toolName)
  const path = args.file_path

  useEffect(() => {
    if (!isFileTool || !path) return
    void window.claudeUI.readTextFile(path).then((result) => {
      if ('error' in result) {
        // The file does not exist yet — the tool is creating it.
        setMissing(true)
        setCurrent('')
      } else {
        setMissing(false)
        setCurrent(result.content)
      }
    })
  }, [isFileTool, path])

  if (toolName === 'Bash' && args.command) {
    return (
      <div>
        <div className="flex items-center gap-1.5 mb-1 text-[10px] text-[var(--color-muted)]">
          <Terminal size={10} />
          {t('Command')}{args.description ? ` · ${args.description}` : ''}
        </div>
        <pre
          className="text-[11px] font-mono whitespace-pre-wrap break-all max-h-56 overflow-y-auto
                     rounded bg-[var(--color-bg)] border border-[var(--color-border)] p-2"
        >
          {args.command}
        </pre>
      </div>
    )
  }

  if (isFileTool && path) {
    // Projected content after the edit; that is what we diff against disk.
    const after = predictContent(current ?? '', args)

    return (
      <div>
        <div className="flex items-center gap-1.5 mb-1 text-[10px] text-[var(--color-muted)]">
          {missing ? <FilePlus2 size={10} className="text-emerald-400" /> : <FileText size={10} />}
          <span className="font-mono truncate">{path}</span>
          {missing && <span className="text-emerald-400 shrink-0">{t('new file')}</span>}
        </div>

        {current === undefined ? (
          <p className="text-[11px] text-[var(--color-muted)]">{t('Reading current content…')}</p>
        ) : after === undefined ? (
          // The edit shape could not be predicted — showing raw arguments beats
          // inventing a diff that will not happen.
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words max-h-56 overflow-y-auto text-neutral-300">
            {JSON.stringify(input, null, 2)}
          </pre>
        ) : (
          <DiffView before={current} after={after} maxHeight="300px" />
        )}
      </div>
    )
  }

  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-words max-h-56 overflow-y-auto text-neutral-300">
      {JSON.stringify(input, null, 2)}
    </pre>
  )
}

/**
 * What the file will contain once the edit is applied.
 * Returns undefined when the arguments do not determine this unambiguously.
 */
export function predictContent(current: string, args: EditInput): string | undefined {
  if (typeof args.content === 'string') return args.content

  const edits = args.edits ?? (args.old_string !== undefined ? [args] : [])
  if (edits.length === 0) return undefined

  let result = current
  for (const edit of edits) {
    if (typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') return undefined
    if (edit.old_string === '') {
      // An empty old_string means file creation, not insertion into an existing one.
      result = edit.new_string
      continue
    }
    if (!result.includes(edit.old_string)) return undefined
    result = result.replace(edit.old_string, edit.new_string)
  }
  return result
}
