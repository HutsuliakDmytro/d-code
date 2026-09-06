import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Square, Play, Loader2, GitFork, Paperclip, ListPlus, X } from 'lucide-react'
import { useChatStore } from '../store/chat-store'
import { useSettingsStore } from '../store/settings-store'
import SkillMenu from './SkillMenu'
import AttachmentChips from './AttachmentChips'
import { filesFromClipboard, filesToAttachments } from '../lib/attachments'
import MentionPopup from './MentionPopup'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

export default function Composer({
  cwd,
  resumeSessionId
}: {
  cwd?: string
  resumeSessionId?: string
}): React.JSX.Element {
  const t = useTranslate()
  const { start, send, interrupt } = useChatStore()
  const tab = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId)!)
  const openTab = useChatStore((s) => s.openTab)
  const state = tab.state
  const draft = tab.draft
  const attachments = tab.attachments
  const attachmentError = tab.attachmentError
  const addAttachments = useChatStore((s) => s.addAttachments)
  const removeAttachment = useChatStore((s) => s.removeAttachment)
  const setAttachmentError = useChatStore((s) => s.setAttachmentError)
  const [dragOver, setDragOver] = useState(false)
  const queue = tab.queue
  const enqueue = useChatStore((s) => s.enqueue)
  const dequeue = useChatStore((s) => s.dequeue)
  const root = useWorkspaceStore((s) => s.root)

  /** Offset of the `@` before the cursor; while it exists the file popup shows. */
  const [mention, setMention] = useState<{ start: number; query: string }>()
  /** Index into prompt history; -1 means "editing my own text right now". */
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [history, setHistory] = useState<string[]>([])
  const takeDraft = useChatStore((s) => s.takeDraft)
  const { model, permissionMode, effort } = useSettingsStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const running = state.status === 'ready' || state.status === 'thinking'
  /**
   * A tab can be driving a different session from the one selected on the left.
   * Typing then would send the message into someone else's conversation, so instead
   * of the input we show a button that starts the selected session.
   */
  const matchesSelection = resumeSessionId
    ? state.sessionId === resumeSessionId
    : state.sessionId !== undefined

  const live = running && matchesSelection
  const thinking = live && state.status === 'thinking'
  /** The tab is busy with another conversation — say so rather than stay silent. */
  const busyElsewhere = running && !matchesSelection

  // Text returned after an interrupt, or via "edit", lands back in the field.
  useEffect(() => {
    if (draft === undefined) return
    const restored = takeDraft()
    if (restored === undefined) return
    setText((current) => {
      // Whatever the user has already typed is not overwritten.
      if (!current.trim()) return restored
      return current.includes(restored) ? current : `${restored}\n${current}`
    })
    // Cursor to the end so typing continues immediately.
    requestAnimationFrame(() => {
      const el = areaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    })
  }, [draft, takeDraft])

  // The field grows with the text, but not without limit.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  async function handleStart(fork = false): Promise<void> {
    if (!cwd) return
    setBusy(true)
    try {
      // The active tab is mid-conversation; hijacking it would lose that context.
      if (busyElsewhere) {
        openTab({ cwd, sessionId: resumeSessionId })
      }
      await start(cwd, { model, resumeSessionId, permissionMode, effort, forkSession: fork })
    } finally {
      setBusy(false)
    }
  }

  async function handleSend(): Promise<void> {
    const value = text.trim()
    // Attachments with no text are pointless — the model would not know what to do.
    if (!value || !live) return

    setText('')
    setHistoryIndex(-1)
    // While the model is busy the message waits in a queue and goes out on its own.
    if (thinking) enqueue(value)
    else await send(value)
  }

  /** Updates popup state from the text and cursor position. */
  function syncMention(value: string, caret: number): void {
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    // The popup lives while there is no space after `@` and it sits on a word boundary.
    if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) {
      setMention(undefined)
      return
    }
    const query = before.slice(at + 1)
    if (/\s/.test(query)) {
      setMention(undefined)
      return
    }
    setMention({ start: at, query })
  }

  function insertMention(relativePath: string): void {
    if (!mention) return
    const el = areaRef.current
    const caret = el?.selectionStart ?? text.length
    const next = `${text.slice(0, mention.start)}@${relativePath} ${text.slice(caret)}`
    setText(next)
    setMention(undefined)
    requestAnimationFrame(() => {
      const position = mention.start + relativePath.length + 2
      el?.focus()
      el?.setSelectionRange(position, position)
    })
  }

  /** Arrow-key history browsing, when the field is empty or already browsing. */
  async function stepHistory(direction: 1 | -1): Promise<void> {
    let items = history
    if (items.length === 0) {
      items = (await window.claudeUI.promptHistory(cwd)).map((h) => h.text)
      setHistory(items)
    }
    if (items.length === 0) return

    const next = historyIndex + direction
    if (next < 0) {
      setHistoryIndex(-1)
      setText('')
      return
    }
    if (next >= items.length) return
    setHistoryIndex(next)
    setText(items[next])
  }

  /** Shared path for clipboard, drag-and-drop and the file picker. */
  async function intake(files: File[]): Promise<void> {
    if (files.length === 0) return
    const { attachments: ready, errors } = await filesToAttachments(files)
    addAttachments(ready)
    if (errors.length) setAttachmentError(errors.join('; '))
  }

  async function pickFiles(): Promise<void> {
    const paths = await window.claudeUI.pickFiles()
    if (paths.length === 0) return
    const results = await Promise.all(paths.map((p) => window.claudeUI.readAttachment(p)))
    const ready = results.filter((r): r is Exclude<typeof r, { error: string }> => !('error' in r))
    const errors = results.filter((r): r is { error: string } => 'error' in r).map((r) => r.error)
    addAttachments(ready)
    if (errors.length) setAttachmentError(errors.join('; '))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // While the file popup is open, arrows and Enter belong to it.
    if (mention) return

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
      return
    }

    // Prompt history: only when it does not interfere with multiline editing.
    const atStart = e.currentTarget.selectionStart === 0
    if (e.key === 'ArrowUp' && (atStart || historyIndex >= 0) && !e.shiftKey) {
      e.preventDefault()
      void stepHistory(1)
    } else if (e.key === 'ArrowDown' && historyIndex >= 0 && !e.shiftKey) {
      e.preventDefault()
      void stepHistory(-1)
    }
  }

  if (!live) {
    return (
      <div className="shrink-0 border-t border-[var(--color-border)] px-4 py-3">
        <div className="flex gap-2">
          <button
            onClick={() => void handleStart(false)}
            disabled={!cwd || busy}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[12px]
                       bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/30
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {resumeSessionId ? t('Resume this session') : t('Start a conversation')}
          </button>
          {resumeSessionId && (
            <button
              onClick={() => void handleStart(true)}
              disabled={!cwd || busy}
              title={t('Continue as a separate branch — the original session stays untouched')}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-[12px]
                         border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <GitFork size={13} />
              {t('Fork')}
            </button>
          )}
        </div>
        {busyElsewhere && (
          <p className="mt-2 text-[10.5px] text-amber-400">
            {t('This tab is busy with another conversation — the session will open in a new tab.')}
          </p>
        )}
        {state.status === 'error' && state.error && (
          <p className="mt-2 text-[10.5px] text-red-400">{state.error}</p>
        )}
        {!cwd && (
          <p className="mt-2 text-[10.5px] text-[var(--color-muted)] text-center">
            {t('Select a session to set the working directory.')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className="shrink-0 border-t border-[var(--color-border)] px-4 py-3"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        // Moving between child elements must not clear the highlight.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void intake(Array.from(e.dataTransfer.files))
      }}
    >
      {queue.length > 0 && (
        <div className="mb-2 space-y-1">
          {queue.map((item, i) => (
            <div
              key={`${i}-${item.slice(0, 12)}`}
              className="flex items-start gap-1.5 px-2 py-1 rounded-md bg-[var(--color-surface)]
                         border border-dashed border-[var(--color-border)]"
            >
              <ListPlus size={10} className="mt-0.5 shrink-0 text-[var(--color-muted)]" />
              <span className="flex-1 text-[10.5px] text-[var(--color-muted)] line-clamp-2">
                {item}
              </span>
              <button
                onClick={() => dequeue(i)}
                title={t('Remove from queue')}
                className="p-0.5 rounded hover:bg-[var(--color-surface-2)] shrink-0"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>
      )}

      <AttachmentChips items={attachments} onRemove={removeAttachment} />

      {attachmentError && (
        <p className="mb-1.5 text-[10.5px] text-amber-400">{attachmentError}</p>
      )}

      <div
        className={`relative flex items-end gap-1.5 bg-[var(--color-surface)] border rounded-lg pl-1.5 pr-3 py-2
                    transition-colors ${
                      dragOver
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/40'
                        : 'border-[var(--color-border)] focus-within:border-[var(--color-accent)]'
                    }`}
      >
        <SkillMenu
          disabled={thinking}
          onPick={(skill) => {
            // Insert the command rather than run it: arguments are up to the user.
            setText((t) => (t ? `/${skill} ${t}` : `/${skill} `))
            areaRef.current?.focus()
          }}
        />
        <button
          onClick={() => void pickFiles()}
          disabled={thinking}
          title={t('Attach files')}
          className="p-1.5 rounded-md hover:bg-[var(--color-surface-2)] disabled:opacity-30
                     disabled:cursor-not-allowed transition-colors"
        >
          <Paperclip size={13} />
        </button>

        <textarea
          ref={areaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            syncMention(e.target.value, e.target.selectionStart ?? 0)
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => syncMention(text, e.currentTarget.selectionStart ?? 0)}
          onPaste={(e) => {
            const files = filesFromClipboard(e.clipboardData)
            if (files.length === 0) return // plain text is left to the browser
            e.preventDefault()
            void intake(files)
          }}
          rows={1}
          placeholder={
            dragOver
              ? t('Drop files here')
              : thinking
                ? t('Claude is working — the message will be queued')
                : t('Write a message… @ mentions a file, ↑ browses history')
          }
          className="flex-1 bg-transparent outline-none resize-none text-[12.5px] leading-relaxed
                     placeholder:text-[var(--color-muted)] max-h-[200px]"
        />
        {mention && (
          <MentionPopup
            root={root}
            query={mention.query}
            onPick={insertMention}
            onClose={() => setMention(undefined)}
          />
        )}

        {thinking && (
          <button
            onClick={() => void interrupt()}
            className="shrink-0 p-1.5 rounded-md bg-red-950/50 hover:bg-red-900/60 transition-colors"
            title={t('Stop the turn and return the text to the field')}
          >
            <Square size={12} className="fill-red-300 text-red-300" />
          </button>
        )}

        <button
          onClick={() => void handleSend()}
          disabled={!text.trim()}
          className={`shrink-0 p-1.5 rounded-md disabled:opacity-30 disabled:cursor-not-allowed
                      transition-opacity ${
                        thinking
                          ? 'bg-[var(--color-surface-2)] border border-[var(--color-border)]'
                          : 'bg-[var(--color-accent)]'
                      }`}
          title={thinking ? t('Queue (Enter)') : t('Send (Enter)')}
        >
          {thinking ? <ListPlus size={12} /> : <ArrowUp size={12} />}
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-[var(--color-muted)]">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          {state.model ?? t('default model')}
        </span>
        {state.permissionMode && (
          <span>
            {t('permissions')}: {state.permissionMode}
          </span>
        )}
        {state.sessionId && <span className="font-mono">{state.sessionId.slice(0, 8)}</span>}
      </div>
    </div>
  )
}
