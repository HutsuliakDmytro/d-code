import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { forceLinting } from '@codemirror/lint'
import { buildExtensions, revealLine, setDebugMarks, type EditorProblem } from '../lib/codemirror'

/**
 * CodeMirror wrapper.
 *
 * The editor lives outside React: recreating it on every render would lose the
 * cursor position and the undo history. React only signals document or language
 * changes.
 */
export interface EditorHandle {
  /** Current selection with its offsets and surrounding lines. */
  getSelection: () => {
    text: string
    from: number
    to: number
    context: string
  } | null
  /** Replaces a range with new text. */
  replaceRange: (from: number, to: number, text: string) => void
}

export default function CodeEditor({
  value,
  language,
  readOnly,
  gotoLine,
  problems,
  handleRef,
  lsp,
  breakpoints,
  currentLine,
  onToggleBreakpoint,
  onChange,
  onSave,
  onCursorLine
}: {
  value: string
  language: string
  readOnly: boolean
  /** Line to scroll to once the file opens. */
  gotoLine?: number
  /** Compiler errors for this file. */
  problems?: EditorProblem[]
  /** External access to the selection, for inline actions on a fragment. */
  handleRef?: React.MutableRefObject<EditorHandle | null>
  onChange?: (value: string) => void
  onSave?: () => void
  /** Line the cursor is on. */
  onCursorLine?: (line: number) => void
  /** Bridge to the language server. */
  lsp?: {
    complete: (line: number, column: number) => Promise<
      Array<{ label: string; detail?: string; insertText?: string }>
    >
    hover: (line: number, column: number) => Promise<string | undefined>
    goToDefinition: (line: number, column: number) => void
  }
  /** Lines carrying breakpoints in this file. */
  breakpoints?: number[]
  /** Line the debugger is currently stopped on. */
  currentLine?: number
  onToggleBreakpoint?: (line: number) => void
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  // Callbacks live in a ref: otherwise every prop change would rebuild the editor.
  const handlers = useRef({ onChange, onSave, onCursorLine })
  handlers.current = { onChange, onSave, onCursorLine }
  // The server bridge too, for the same reason.
  const lspRef = useRef(lsp)
  lspRef.current = lsp
  // Same for breakpoints: the callback must not force a rebuild.
  const breakpointRef = useRef(onToggleBreakpoint)
  breakpointRef.current = onToggleBreakpoint
  // The linter reads problems on demand, so they stay in a ref.
  const problemsRef = useRef<EditorProblem[]>([])
  problemsRef.current = problems ?? []

  useEffect(() => {
    if (!hostRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: buildExtensions({
          language,
          readOnly,
          onChange: (v) => handlers.current.onChange?.(v),
          onSave: () => handlers.current.onSave?.(),
          problems: () => problemsRef.current,
          onCursorLine: (line) => handlers.current.onCursorLine?.(line),
          lsp: lsp
            ? {
                complete: (line, column) =>
                  lspRef.current?.complete(line, column) ?? Promise.resolve([]),
                hover: (line, column) =>
                  lspRef.current?.hover(line, column) ?? Promise.resolve(undefined),
                goToDefinition: (line, column) => lspRef.current?.goToDefinition(line, column)
              }
            : undefined,
          onToggleBreakpoint: onToggleBreakpoint
            ? (line) => breakpointRef.current?.(line)
            : undefined
        })
      }),
      parent: hostRef.current
    })
    viewRef.current = view

    if (handleRef) {
      handleRef.current = {
        getSelection: () => {
          const { from, to } = view.state.selection.main
          if (from === to) return null
          const doc = view.state.doc
          // A few lines of context: without them the model cannot see where the code sits.
          const startLine = Math.max(1, doc.lineAt(from).number - 6)
          const endLine = Math.min(doc.lines, doc.lineAt(to).number + 6)
          return {
            text: doc.sliceString(from, to),
            from,
            to,
            context: doc.sliceString(doc.line(startLine).from, doc.line(endLine).to)
          }
        },
        replaceRange: (from, to, text) => {
          view.dispatch({ changes: { from, to, insert: text } })
          view.focus()
        }
      }
    }

    return () => {
      if (handleRef) handleRef.current = null
      view.destroy()
      viewRef.current = null
    }
    // Language, read-only mode and LSP presence are baked into the extensions,
    // so changing any of them recreates the editor.
  }, [language, readOnly, Boolean(lsp), Boolean(onToggleBreakpoint)])

  // Debugger marks go through an effect — rebuilding the state would be wasteful.
  useEffect(() => {
    if (!onToggleBreakpoint) return
    viewRef.current?.dispatch({
      effects: setDebugMarks.of({ breakpoints: breakpoints ?? [], current: currentLine })
    })
  }, [breakpoints, currentLine, onToggleBreakpoint])

  // Text changed from outside: a different file, or a reload from disk.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    if (!gotoLine || !viewRef.current) return
    revealLine(viewRef.current, gotoLine)
  }, [gotoLine, value])

  // Fresh type-check results must show up as underlines immediately.
  useEffect(() => {
    if (viewRef.current) forceLinting(viewRef.current)
  }, [problems])

  return <div ref={hostRef} className="h-full overflow-auto" />
}
