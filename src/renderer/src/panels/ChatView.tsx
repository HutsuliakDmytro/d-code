import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Folder, GitBranch, Hash } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { useChatStore } from '../store/chat-store'
import MessageBubble from '../components/MessageBubble'
import Composer from '../components/Composer'
import PermissionDialog from '../components/PermissionDialog'
import ChatTabs from '../components/ChatTabs'
import OpenInEditor from '../components/OpenInEditor'
import SessionPullRequests from '../components/SessionPullRequests'
import { compactNumber } from '../lib/format'
import type { ChatMessage } from '@shared/types'
import { useTranslate } from '../i18n'

/** How many recent messages to render up front. */
const VISIBLE_TAIL = 60

export default function ChatView({
  /** In the right panel the header and title bar are already drawn outside. */
  compact = false
}: {
  compact?: boolean
} = {}): React.JSX.Element {
  const t = useTranslate()
  const { selected, transcript, loadingTranscript } = useAppStore()
  const tab = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId)!)
  const { live, streamingText } = tab
  const chatState = tab.state

  // Until the CLI writes the new session to disk `selected` is empty — the working
  // directory is still known from the conversation state.
  const chatActive = chatState.status === 'ready' || chatState.status === 'thinking'
  const activeCwd = selected?.meta.projectPath ?? (chatActive ? chatState.cwd : undefined)

  /**
   * Very long sessions (hundreds of messages) render in full only on request:
   * otherwise opening one freezes the interface for seconds.
   */
  const [showAll, setShowAll] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // A new session opens at the top, not where the previous one left the scroll.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    setShowAll(false)
  }, [selected?.meta.sessionId])

  const allMessages = transcript?.messages ?? []
  const hidden = showAll ? 0 : Math.max(0, allMessages.length - VISIBLE_TAIL)
  const visibleMessages = useMemo(
    () => (hidden > 0 ? allMessages.slice(hidden) : allMessages),
    [allMessages, hidden]
  )

  /** A subagent branch is a separate file, loaded only when expanded. */
  const openAgent = useCallback(
    async (agentId: string): Promise<ChatMessage[]> => {
      const ref = transcript?.subagents.find((s) => s.agentId === agentId)
      if (!ref || !selected) return []
      const branch = await window.claudeUI.readSubagent(
        ref.filePath,
        selected.meta.projectPath,
        selected.meta.encodedDir
      )
      return branch.messages
    },
    [transcript, selected]
  )

  // A live conversation stays pinned to the bottom.
  const liveCount = live.length
  useEffect(() => {
    if (liveCount === 0 && !streamingText) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [liveCount, streamingText])

  return (
    <div className="relative h-full flex flex-col bg-[var(--color-bg)] min-w-0">
      <div
        className={`shrink-0 flex items-center gap-2 px-3 border-b border-[var(--color-border)] ${
          compact ? 'h-[28px]' : 'titlebar-drag h-[38px]'
        }`}
      >
        {selected ? (
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[12.5px] truncate">{selected.meta.title}</span>
            <span className="text-[10.5px] text-[var(--color-muted)] shrink-0">
              [{selected.meta.titleSource}]
            </span>
          </div>
        ) : chatActive ? (
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[12.5px]">{t('New session')}</span>
            {chatState.cwd && (
              <span className="text-[10.5px] text-[var(--color-muted)] truncate">
                {chatState.cwd}
              </span>
            )}
          </div>
        ) : (
          <span className="text-[12.5px] text-[var(--color-muted)]">{t('No session selected')}</span>
        )}
      </div>

      <ChatTabs />

      {selected && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-1.5 border-b border-[var(--color-border)]
                        text-[10.5px] text-[var(--color-muted)] overflow-x-auto">
          <span className="flex items-center gap-1 shrink-0" title={selected.meta.projectPath}>
            <Folder size={10} />
            {selected.meta.projectPath}
          </span>
          {selected.meta.gitBranch && (
            <span className="flex items-center gap-1 shrink-0">
              <GitBranch size={10} />
              {selected.meta.gitBranch}
            </span>
          )}
          <span className="flex items-center gap-1 shrink-0" title={t('Session ID — used for --resume')}>
            <Hash size={10} />
            <span className="font-mono">{selected.meta.sessionId.slice(0, 8)}</span>
          </span>
          {selected.meta.pullRequests && (
            <SessionPullRequests items={selected.meta.pullRequests} />
          )}
          {selected.meta.version && <span className="shrink-0">CLI {selected.meta.version}</span>}
          <span className="shrink-0">
            {compactNumber(selected.usage.outputTokens)} out / {selected.usage.requests} {t('requests')}
          </span>
          <div className="ml-auto shrink-0">
            <OpenInEditor path={selected.meta.projectPath} />
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-4">
          {!selected && !chatActive && (
            <div className="text-center text-[var(--color-muted)] text-[12px] mt-24">
              {t('Pick a session on the left to see its history.')}
            </div>
          )}

          {!selected && chatActive && live.length === 0 && !streamingText && (
            <div className="text-center text-[var(--color-muted)] text-[12px] mt-24">
              {t('New session ready — write the first message.')}
            </div>
          )}

          {loadingTranscript && (
            <div className="text-[var(--color-muted)] text-[12px]">{t('Reading transcript…')}</div>
          )}

          {hidden > 0 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full py-2 mb-2 rounded-md text-[11.5px] border border-[var(--color-border)]
                         text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]
                         hover:text-[var(--color-text)] transition-colors"
            >
              {t('Show {count} earlier messages', { count: hidden })}
            </button>
          )}

          {visibleMessages.map((m) => (
            <MessageBubble key={m.uuid} msg={m} onOpenAgent={openAgent} />
          ))}

          {transcript && transcript.messages.length === 0 && live.length === 0 && (
            <div className="text-[var(--color-muted)] text-[12px]">
              {t('This session has no messages to show.')}
            </div>
          )}

          {live.length > 0 && (
            <div className="my-3 flex items-center gap-2 text-[10px] text-[var(--color-muted)]">
              <span className="flex-1 h-px bg-[var(--color-border)]" />
              {t('live conversation')}
              <span className="flex-1 h-px bg-[var(--color-border)]" />
            </div>
          )}

          {live.map((m) => (
            <MessageBubble key={m.uuid} msg={m} onOpenAgent={openAgent} />
          ))}

          {streamingText && (
            <div className="py-2 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">
              {streamingText}
              <span className="inline-block w-[2px] h-[14px] ml-0.5 align-middle
                               bg-[var(--color-accent)] animate-pulse" />
            </div>
          )}

          {chatState.status === 'thinking' && !streamingText && (
            <div className="py-2 text-[11.5px] text-[var(--color-muted)]">{t('Claude is thinking…')}</div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <Composer cwd={activeCwd} resumeSessionId={selected?.meta.sessionId} />

      <PermissionDialog />
    </div>
  )
}
