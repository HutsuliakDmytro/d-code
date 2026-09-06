import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  keymap,
  gutter,
  GutterMarker,
  Decoration
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { hoverTooltip } from '@codemirror/view'
import { bracketMatching, foldGutter, indentOnInput, StreamLanguage } from '@codemirror/language'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { yaml } from '@codemirror/lang-yaml'
// These languages have no dedicated packages — modes come from CodeMirror's legacy bundle.
import {
  c,
  cpp,
  csharp,
  dart,
  java,
  kotlin,
  objectiveC
} from '@codemirror/legacy-modes/mode/clike'
import { swift } from '@codemirror/legacy-modes/mode/swift'

/** Highlighting language, based on what the backend derived from the extension. */
export function languageExtension(language: string): Extension[] {
  switch (language) {
    case 'typescript':
      return [javascript({ typescript: true })]
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })]
    case 'jsx':
      return [javascript({ jsx: true })]
    case 'javascript':
      return [javascript()]
    case 'json':
      return [json()]
    case 'markdown':
      return [markdown()]
    case 'css':
    case 'scss':
      return [css()]
    case 'html':
    case 'xml':
      return [html()]
    case 'python':
      return [python()]
    case 'rust':
      return [rust()]
    case 'yaml':
    case 'toml':
      return [yaml()]
    case 'dart':
      return [StreamLanguage.define(dart)]
    case 'java':
      return [StreamLanguage.define(java)]
    case 'kotlin':
      return [StreamLanguage.define(kotlin)]
    case 'swift':
      return [StreamLanguage.define(swift)]
    case 'c':
      return [StreamLanguage.define(c)]
    case 'cpp':
      return [StreamLanguage.define(cpp)]
    case 'csharp':
      return [StreamLanguage.define(csharp)]
    case 'objectivec':
      return [StreamLanguage.define(objectiveC)]
    default:
      return []
  }
}

/** Theme matching the app palette: oneDark alone is too high-contrast. */
const appTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', fontSize: '11.5px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--color-border)',
    color: '#5a5a66'
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
  '.cm-breakpoint-gutter': { width: '14px', cursor: 'pointer' },
  '.cm-breakpoint': { color: '#f87171', fontSize: '10px', lineHeight: '1.5' },
  // The debugger's current line must read instantly — hence a bar, not a dot.
  '.cm-debug-current': {
    backgroundColor: 'rgba(250, 204, 21, 0.14)',
    boxShadow: 'inset 2px 0 0 #facc15'
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8b8b96' },
  '.cm-content': { caretColor: 'var(--color-accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-lsp-hover': {
    padding: '6px 8px',
    maxWidth: '480px',
    maxHeight: '240px',
    overflow: 'auto',
    fontSize: '11px',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px'
  },
  '.cm-tooltip': { border: 'none', backgroundColor: 'transparent' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 6px' }
})

export interface EditorProblem {
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
  code?: string
}

/** Debugger marks: breakpoints and the line currently stopped on. */
interface DebugMarks {
  breakpoints: number[]
  current?: number
}

/** Marks are updated from outside via an effect; the editor is never rebuilt. */
export const setDebugMarks = StateEffect.define<DebugMarks>()

const debugMarksField = StateField.define<DebugMarks>({
  create: () => ({ breakpoints: [] }),
  update: (value, tr) => {
    for (const effect of tr.effects) if (effect.is(setDebugMarks)) return effect.value
    return value
  }
})

const breakpointMarker = new (class extends GutterMarker {
  toDOM(): Node {
    const dot = document.createElement('span')
    dot.className = 'cm-breakpoint'
    dot.textContent = '\u25cf'
    return dot
  }
})()

/**
 * Breakpoint gutter.
 *
 * A separate gutter rather than clicks on line numbers: the numbers already have
 * their own behaviour (selecting a line), and taking that away for breakpoints is
 * a bad trade.
 */
function breakpointGutter(onToggle: (line: number) => void): Extension {
  return [
    debugMarksField,
    gutter({
      class: 'cm-breakpoint-gutter',
      lineMarker: (view, block) => {
        const line = view.state.doc.lineAt(block.from).number
        return view.state.field(debugMarksField).breakpoints.includes(line)
          ? breakpointMarker
          : null
      },
      // Without a spacer the gutter would jump in width whenever the last mark goes.
      initialSpacer: () => breakpointMarker,
      lineMarkerChange: (update) =>
        update.transactions.some((tr) => tr.effects.some((e) => e.is(setDebugMarks))),
      domEventHandlers: {
        mousedown: (view, block) => {
          onToggle(view.state.doc.lineAt(block.from).number)
          return true
        }
      }
    }),
    EditorView.decorations.compute([debugMarksField], (state) => {
      const { current } = state.field(debugMarksField)
      if (!current || current < 1 || current > state.doc.lines) return Decoration.none
      return Decoration.set([
        Decoration.line({ class: 'cm-debug-current' }).range(state.doc.line(current).from)
      ])
    })
  ]
}

export interface EditorOptions {
  language: string
  readOnly: boolean
  onChange?: (value: string) => void
  onSave?: () => void
  /** Supplies the current problems for this file. */
  problems?: () => EditorProblem[]
  /** Fires when the cursor moves to a different line. */
  onCursorLine?: (line: number) => void
  /** Language-server access; without it the editor is a plain one. */
  lsp?: {
    complete: (line: number, column: number) => Promise<
      Array<{ label: string; detail?: string; insertText?: string }>
    >
    hover: (line: number, column: number) => Promise<string | undefined>
    goToDefinition: (line: number, column: number) => void
  }
  /** Click handler for the breakpoint gutter; without it the gutter is hidden. */
  onToggleBreakpoint?: (line: number) => void
}

/** Cursor position in the shape LSP expects (1-based lines and columns). */
function positionAt(view: EditorView, pos: number): { line: number; column: number } {
  const line = view.state.doc.lineAt(pos)
  return { line: line.number, column: pos - line.from + 1 }
}

/**
 * Turns compiler diagnostics into editor underlines.
 *
 * tsc line numbers are 1-based and can point past the end of the current text if
 * the file changed after the check — those positions are clamped, otherwise
 * CodeMirror throws.
 */
function problemsToDiagnostics(view: EditorView, problems: EditorProblem[]): CmDiagnostic[] {
  const doc = view.state.doc
  const result: CmDiagnostic[] = []

  for (const problem of problems) {
    const lineNumber = Math.min(Math.max(1, problem.line), doc.lines)
    const line = doc.line(lineNumber)
    const from = Math.min(line.from + Math.max(0, problem.column - 1), line.to)
    // Underline to end of line: tsc does not give an exact token length.
    result.push({
      from,
      to: line.to,
      severity: problem.severity === 'info' ? 'info' : problem.severity,
      message: problem.code ? `${problem.code}: ${problem.message}` : problem.message
    })
  }
  return result
}

export function buildExtensions(opts: EditorOptions): Extension[] {
  const extensions: Extension[] = [
    lineNumbers(),
    foldGutter(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    bracketMatching(),
    indentOnInput(),
    history(),
    keymap.of([
      // Save is bound before the defaults so the browser's own save stays out.
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          opts.onSave?.()
          return true
        }
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab
    ]),
    oneDark,
    appTheme,
    lintGutter(),
    EditorView.updateListener.of((update) => {
      if (!opts.onCursorLine || !update.selectionSet) return
      const line = update.state.doc.lineAt(update.state.selection.main.head).number
      opts.onCursorLine(line)
    }),
    linter((view) => (opts.problems ? problemsToDiagnostics(view, opts.problems()) : [])),
    ...(opts.onToggleBreakpoint ? [breakpointGutter(opts.onToggleBreakpoint)] : []),
    EditorView.lineWrapping,
    ...languageExtension(opts.language)
  ]

  if (opts.lsp) {
    const lsp = opts.lsp

    extensions.push(
      autocompletion({
        override: [
          async (context: CompletionContext): Promise<CompletionResult | null> => {
            // A dot or a word are the usual triggers; on empty space it is noise.
            const word = context.matchBefore(/[\w$.]+/)
            if (!word && !context.explicit) return null

            // context.view is always present when the editor requests completion.
            if (!context.view) return null
            const { line, column } = positionAt(context.view, context.pos)
            const items = await lsp.complete(line, column)
            if (items.length === 0) return null

            return {
              // Start of the word, not the cursor: otherwise the option is appended
              // to what was typed instead of replacing it.
              from: word && !word.text.endsWith('.') ? word.from : context.pos,
              options: items.map((item) => ({
                label: item.label,
                detail: item.detail,
                apply: item.insertText ?? item.label
              }))
            }
          }
        ]
      }),

      hoverTooltip(async (view, pos) => {
        const { line, column } = positionAt(view, pos)
        const text = await lsp.hover(line, column)
        if (!text) return null
        return {
          pos,
          create: () => {
            const dom = document.createElement('div')
            dom.className = 'cm-lsp-hover'
            dom.textContent = text
            return { dom }
          }
        }
      }),

      keymap.of([
        {
          // F12 and ⌘-click are the familiar ways to jump to a definition.
          key: 'F12',
          run: (view) => {
            const { line, column } = positionAt(view, view.state.selection.main.head)
            lsp.goToDefinition(line, column)
            return true
          }
        }
      ]),

      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (!event.metaKey && !event.ctrlKey) return false
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos === null) return false
          const { line, column } = positionAt(view, pos)
          lsp.goToDefinition(line, column)
          return true
        }
      })
    )
  }

  if (opts.readOnly) {
    extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false))
  } else if (opts.onChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) opts.onChange!(update.state.doc.toString())
      })
    )
  }

  return extensions
}

/** Scrolls to a line and places the cursor — used when jumping from search results. */
export function revealLine(view: EditorView, line: number): void {
  const total = view.state.doc.lines
  const target = Math.min(Math.max(1, line), total)
  const pos = view.state.doc.line(target).from
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' })
  })
  view.focus()
}
