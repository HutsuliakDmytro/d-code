import { MessagesSquare, BarChart3 } from 'lucide-react'
import { useState } from 'react'
import ChatView from './ChatView'
import MetricsPanel from './MetricsPanel'
import { useTranslate } from '../i18n'

type RightTab = 'chat' | 'metrics'

/**
 * Right panel while the editor is open.
 *
 * With code in the centre, chat and metrics share the right side through tabs —
 * there is no room for three full columns beside an editor.
 */
export default function RightPanel(): React.JSX.Element {
  const t = useTranslate()
  const [tab, setTab] = useState<RightTab>('chat')

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] border-l border-[var(--color-border)] min-w-0">
      <div className="titlebar-drag shrink-0 flex items-stretch h-[38px] border-b border-[var(--color-border)]">
        <button
          onClick={() => setTab('chat')}
          className={`flex items-center gap-1.5 px-3 text-[11px] transition-colors ${
            tab === 'chat'
              ? 'text-[var(--color-text)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <MessagesSquare size={12} />
          {t('Chat')}
        </button>
        <button
          onClick={() => setTab('metrics')}
          className={`flex items-center gap-1.5 px-3 text-[11px] transition-colors ${
            tab === 'metrics'
              ? 'text-[var(--color-text)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          <BarChart3 size={12} />
          {t('Metrics')}
        </button>
      </div>

      {/* Both panels stay mounted: switching tabs must not interrupt a streaming
          reply or reset scroll position. */}
      <div className={`flex-1 min-h-0 ${tab === 'chat' ? '' : 'hidden'}`}>
        <ChatView compact />
      </div>
      <div className={`flex-1 min-h-0 overflow-hidden ${tab === 'metrics' ? '' : 'hidden'}`}>
        <MetricsPanel embedded />
      </div>
    </div>
  )
}
