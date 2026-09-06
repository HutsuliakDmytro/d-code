import { useState } from 'react'
import { Brain, ChevronDown, ChevronRight, AlertCircle, Terminal, Pencil, Bookmark } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import ToolCallCard from './ToolCallCard'
import { useChatStore } from '../store/chat-store'
import { useAppStore } from '../store/app-store'
import { relativeTime } from '../lib/format'
import { useTranslate } from '../i18n'

export default function MessageBubble({
  msg,
  onOpenAgent
}: {
  msg: ChatMessage
  onOpenAgent?: (agentId: string) => Promise<ChatMessage[]>
}): React.JSX.Element {
  const t = useTranslate()
  const [showThinking, setShowThinking] = useState(false)
  const editDraft = useChatStore((s) => s.editDraft)
  const toggleBookmark = useAppStore((s) => s.toggleBookmark)
  const bookmarked = useAppStore((s) => s.bookmarks.has(msg.uuid))

  if (msg.role === 'system') {
    return (
      <div className="flex items-center gap-1.5 py-1 text-[11px] text-[var(--color-muted)]">
        <Terminal size={11} />
        <span className="font-mono">{msg.text}</span>
      </div>
    )
  }

  if (msg.role === 'user') {
    return (
      <div className="py-2 group">
        <div className="ml-auto max-w-[85%] bg-[var(--color-surface-2)] border border-[var(--color-border)]
                        rounded-lg px-3 py-2 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">
          {msg.text}
        </div>
        <div className="flex items-center justify-end gap-2 mt-1">
          <button
            onClick={() => void toggleBookmark(msg.uuid)}
            title={bookmarked ? t('Remove bookmark') : t('Bookmark')}
            className={`transition-opacity ${
              bookmarked
                ? 'text-[var(--color-accent)]'
                : 'text-[var(--color-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-text)]'
            }`}
          >
            <Bookmark size={10} className={bookmarked ? 'fill-current' : ''} />
          </button>
          <button
            onClick={() => editDraft(msg.text)}
            title={t('Copy text back into the composer for editing')}
            className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]
                       opacity-0 group-hover:opacity-100 hover:text-[var(--color-text)]
                       transition-opacity"
          >
            <Pencil size={9} />
            {t('Edit')}
          </button>
          <span className="text-[10px] text-[var(--color-muted)]">
            {relativeTime(msg.timestamp)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="py-2 group relative">
      <button
        onClick={() => void toggleBookmark(msg.uuid)}
        title={bookmarked ? t('Remove bookmark') : t('Bookmark')}
        className={`absolute -left-4 top-2.5 transition-opacity ${
          bookmarked
            ? 'text-[var(--color-accent)]'
            : 'text-[var(--color-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-text)]'
        }`}
      >
        <Bookmark size={10} className={bookmarked ? 'fill-current' : ''} />
      </button>

      {msg.isSynthetic && (
        <div className="flex items-start gap-1.5 text-[11.5px] text-red-300 bg-red-950/30
                        border border-red-900/50 rounded-md px-2 py-1.5 mb-1">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{msg.text || t('API error')}</span>
        </div>
      )}

      {msg.thinking && (
        <div className="mb-1">
          <button
            onClick={() => setShowThinking((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-violet-400/80 hover:text-violet-300 transition-colors"
          >
            {showThinking ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <Brain size={11} />
            {t('Thinking')}
          </button>
          {showThinking && (
            <div className="mt-1 pl-3 border-l-2 border-violet-900/60 text-[11.5px]
                            text-neutral-400 whitespace-pre-wrap break-words leading-relaxed">
              {msg.thinking}
            </div>
          )}
        </div>
      )}

      {!msg.isSynthetic && msg.text.trim() && (
        <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed">
          {msg.text}
        </div>
      )}

      {msg.toolCalls.map((call) => (
        <ToolCallCard key={call.id} call={call} onOpenAgent={onOpenAgent} />
      ))}
    </div>
  )
}
