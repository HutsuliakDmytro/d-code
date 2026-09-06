import { useEffect, useMemo, useRef, useState } from 'react'
import { Save, FileWarning, X, UserRound, Sparkles, MessageSquarePlus } from 'lucide-react'
import { useWorkspaceStore, type OpenFile } from '../store/workspace-store'
import CodeEditor, { type EditorHandle } from '../components/CodeEditor'
import InlineChat, { type InlineTarget } from '../components/InlineChat'
import RenameDialog, { type RenameTarget } from '../components/RenameDialog'
import { useChatStore } from '../store/chat-store'
import FileTabs from '../components/FileTabs'
import BlameGutter from '../components/BlameGutter'
import Breadcrumbs from '../components/Breadcrumbs'
import type { EditorProblem } from '../lib/codemirror'
import { useDebugStore } from '../store/debug-store'
import { useTranslate } from '../i18n'

/** One editor column: an action header plus CodeMirror itself. */
function EditorPane({
  file,
  root,
  pane,
  onClose,
  onInline,
  onToChat
}: {
  file: OpenFile
  root?: string
  pane: 'main' | 'split'
  onClose: () => void
  onInline: (handle: EditorHandle | null) => void
  onToChat: (handle: EditorHandle | null) => void
}): React.JSX.Element {
  const t = useTranslate()
  const { setDraft, saveFile, setFocusedPane, focusedPane } = useWorkspaceStore()
  const [saveError, setSaveError] = useState<string>()
  const [blame, setBlame] = useState(false)
  const [cursorLine, setCursorLine] = useState<number>()
  const [problems, setProblems] = useState<EditorProblem[]>([])
  const handleRef = useRef<EditorHandle | null>(null)
  const openFile = useWorkspaceStore((s) => s.openFile)

  const toggleBreakpoint = useDebugStore((s) => s.toggleBreakpoint)
  const allBreakpoints = useDebugStore((s) => s.breakpoints)
  // A fresh array from the selector would make Zustand see a change every time.
  const fileBreakpoints = useMemo(
    () => allBreakpoints.filter((bp) => bp.path === file.path).map((bp) => bp.line),
    [allBreakpoints, file.path]
  )
  // The yellow bar belongs only to the file the debugger is actually stopped in.
  const debugLine = useDebugStore((s) => {
    const frame = s.state.frames.find((f) => f.id === (s.selectedFrame ?? s.state.frames[0]?.id))
    return s.state.paused && frame?.path === file.path ? frame.line : undefined
  })

  /**
   * Language-server bridge for this column.
   *
   * Content is read from a ref at request time: the server has to see what is in
   * the editor right now, unsaved edits included.
   */
  const lsp = root
    ? {
        complete: async (line: number, column: number) => {
          const items = await window.claudeUI.lspComplete({
            root,
            path: file.path,
            language: file.content.language,
            content: file.draft ?? file.content.content,
            line,
            column
          })
          return items.map((i) => ({ label: i.label, detail: i.detail, insertText: i.insertText }))
        },
        hover: async (line: number, column: number) => {
          const info = await window.claudeUI.lspHover({
            root,
            path: file.path,
            language: file.content.language,
            content: file.draft ?? file.content.content,
            line,
            column
          })
          return info?.contents
        },
        goToDefinition: (line: number, column: number) => {
          void window.claudeUI
            .lspDefinition({
              root,
              path: file.path,
              language: file.content.language,
              content: file.draft ?? file.content.content,
              line,
              column
            })
            .then((location) => {
              if (location) void openFile(location.path, location.line)
            })
        }
      }
    : undefined

  useEffect(() => {
    const apply = (state: {
      diagnostics: Array<{
        path: string
        line: number
        column: number
        severity: string
        message: string
        code?: string
      }>
    }): void => {
      setProblems(
        state.diagnostics
          .filter((d) => d.path === file.path)
          .map((d) => ({
            line: d.line,
            column: d.column,
            severity: d.severity === 'warning' ? 'warning' : 'error',
            message: d.message,
            code: d.code
          }))
      )
    }
    void window.claudeUI.getDiagnostics().then(apply)
    return window.claudeUI.onDiagnostics(apply)
  }, [file.path])

  async function save(): Promise<void> {
    const result = await saveFile(file.path)
    setSaveError(result.ok ? undefined : result.error)
  }

  const active = focusedPane === pane

  return (
    <div
      className={`h-full flex flex-col min-w-0 ${active ? '' : 'opacity-90'}`}
      onMouseDown={() => setFocusedPane(pane)}
    >
      <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-b border-[var(--color-border)]">
        <Breadcrumbs
          relativePath={file.relativePath}
          language={file.content.language}
          content={file.draft ?? file.content.content}
          line={cursorLine}
          onPickSymbol={() => useWorkspaceStore.getState().setSymbolPaletteOpen(true)}
        />

        <span className="ml-auto text-[10px] text-[var(--color-muted)] shrink-0">
          {file.content.language}
          {file.content.truncated && ` · ${t('truncated')}`}
        </span>

        <button
          onClick={() => onInline(handleRef.current)}
          title={t('Act on selection (⌘I)')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <Sparkles size={12} />
        </button>
        <button
          onClick={() => onToChat(handleRef.current)}
          title={t('Add to chat')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <MessageSquarePlus size={12} />
        </button>
        <button
          onClick={() => setBlame((v) => !v)}
          title={t('Show line authors')}
          className={`p-1 rounded transition-colors ${
            blame
              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'hover:bg-[var(--color-surface-2)]'
          }`}
        >
          <UserRound size={12} />
        </button>
        <button
          onClick={() => void save()}
          disabled={file.draft === undefined}
          title={t('Save (⌘S)')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] disabled:opacity-30
                     disabled:cursor-not-allowed transition-colors"
        >
          <Save size={12} />
        </button>
        <button
          onClick={onClose}
          title={pane === 'split' ? t('Close column') : t('Close file')}
          className="p-1 rounded hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <X size={12} />
        </button>
      </div>

      {saveError && (
        <p className="shrink-0 px-3 py-1 text-[10.5px] text-red-400 border-b border-[var(--color-border)]">
          {saveError}
        </p>
      )}

      {file.content.truncated && (
        <p className="shrink-0 px-3 py-1 text-[10.5px] text-amber-400 border-b border-[var(--color-border)]">
          {t('File is too large — showing the first 2 MB. Editing is disabled so the rest is not lost.')}
        </p>
      )}

      <div className="flex-1 min-h-0 flex">
        <BlameGutter root={root} path={file.path} visible={blame} />
        <div className="flex-1 min-w-0">
          <CodeEditor
            // Keyed by path and column: each instance keeps its own undo history.
            key={`${pane}-${file.path}`}
            value={file.draft ?? file.content.content}
            language={file.content.language}
            readOnly={file.content.truncated}
            gotoLine={file.gotoLine}
            problems={problems}
            handleRef={handleRef}
            onCursorLine={setCursorLine}
            lsp={lsp}
            breakpoints={fileBreakpoints}
            currentLine={debugLine}
            onToggleBreakpoint={(line) => void toggleBreakpoint(file.path, line)}
            onChange={pane === 'main' ? setDraft : undefined}
            onSave={() => void save()}
          />
        </div>
      </div>
    </div>
  )
}

/** Centre of the workspace: tabs for open files and an editor for the active one. */
export default function FileViewer(): React.JSX.Element {
  const t = useTranslate()
  const {
    openFiles,
    openError,
    loadingFile,
    closeFile,
    closeSplit,
    root,
    focusedPane
  } = useWorkspaceStore()
  const active = useWorkspaceStore((s) => s.openFiles.find((f) => f.path === s.activePath))
  const split = useWorkspaceStore((s) => s.openFiles.find((f) => f.path === s.splitPath))
  const [inline, setInline] = useState<InlineTarget>()
  const [rename, setRename] = useState<RenameTarget>()
  const inlineHandle = useRef<EditorHandle | null>(null)
  const editDraft = useChatStore((s) => s.editDraft)

  /** Opens inline actions for the selection in whichever column asked. */
  function openInline(handle: EditorHandle | null, file: OpenFile): void {
    const selection = handle?.getSelection()
    if (!selection) return
    inlineHandle.current = handle
    setInline({
      path: file.path,
      language: file.content.language,
      selection: selection.text,
      context: selection.context,
      from: selection.from,
      to: selection.to
    })
  }

  function sendToChat(handle: EditorHandle | null, file: OpenFile): void {
    const selection = handle?.getSelection()
    if (selection) {
      editDraft(
        `In \`${file.relativePath}\`:\n\n\`\`\`${file.content.language}\n${selection.text}\n\`\`\`\n\n`
      )
    } else {
      // Without a selection the path alone is enough — the model will read the file.
      editDraft(`@${file.relativePath} `)
    }
  }

  // ⌘I and F2 act on whichever column currently has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const file = focusedPane === 'split' ? split : active
      if (!file) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        openInline(inlineHandle.current, file)
        return
      }

      if (e.key === 'F2') {
        e.preventDefault()
        const selection = inlineHandle.current?.getSelection()
        const content = file.draft ?? file.content.content
        // With no selection, take the word under the cursor, as editors do.
        const symbol = selection?.text.trim() ?? ''
        if (!symbol || symbol.includes('\n')) return

        const before = content.slice(0, selection!.from)
        const line = before.split('\n').length
        const column = selection!.from - before.lastIndexOf('\n')

        setRename({
          path: file.path,
          language: file.content.language,
          content,
          line,
          column,
          symbol
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)] min-w-0">
      <div className="titlebar-drag h-[38px] shrink-0 border-b border-[var(--color-border)]" />

      <FileTabs />

      {openError && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)]">
          <FileWarning size={12} className="text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-400 flex-1">{openError}</span>
        </div>
      )}

      {loadingFile && (
        <div className="shrink-0 px-3 py-1.5 text-[11px] text-[var(--color-muted)]">
          {t('Reading file…')}
        </div>
      )}

      {active ? (
        <div className="flex-1 min-h-0 flex divide-x divide-[var(--color-border)]">
          <div className={split ? 'w-1/2 min-w-0' : 'flex-1 min-w-0'}>
            <EditorPane
              file={active}
              root={root}
              pane="main"
              onClose={() => closeFile(active.path)}
              onInline={(handle) => openInline(handle, active)}
              onToChat={(handle) => sendToChat(handle, active)}
            />
          </div>

          {split && (
            <div className="w-1/2 min-w-0">
              <EditorPane
                file={split}
                root={root}
                pane="split"
                onClose={closeSplit}
                onInline={(handle) => openInline(handle, split)}
                onToChat={(handle) => sendToChat(handle, split)}
              />
            </div>
          )}
        </div>
      ) : (
        openFiles.length === 0 &&
        !loadingFile && (
          <div className="flex-1 flex items-center justify-center text-[12px] text-[var(--color-muted)]">
            {t('Pick a file from the tree on the left.')}
          </div>
        )
      )}

      {rename && <RenameDialog target={rename} onClose={() => setRename(undefined)} />}

      {inline && (
        <InlineChat
          target={inline}
          cwd={root}
          onApply={(code) => inlineHandle.current?.replaceRange(inline.from, inline.to, code)}
          onClose={() => setInline(undefined)}
        />
      )}
    </div>
  )
}
