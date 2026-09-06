import { Plus, X, Circle } from 'lucide-react'
import { useChatStore } from '../store/chat-store'
import { projectName } from '../lib/format'
import { useTranslate } from '../i18n'

/**
 * Conversation tab strip.
 *
 * Each tab is a separate CLI process with its own session, so switching does not
 * interrupt anything: while one is thinking, you can type in another.
 */
export default function ChatTabs(): React.JSX.Element | null {
  const t = useTranslate()
  const { tabs, activeId, setActive, openTab, closeTab } = useChatStore()

  // A single tab needs no strip — it would only eat vertical space.
  if (tabs.length <= 1) {
    return (
      <div className="shrink-0 flex items-center h-[26px] px-2 border-b border-[var(--color-border)]">
        <button
          onClick={() => openTab()}
          title={t('New conversation tab')}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px]
                     text-[var(--color-muted)] hover:text-[var(--color-text)]
                     hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <Plus size={10} />
          {t('New tab')}
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 flex items-stretch h-[26px] border-b border-[var(--color-border)] overflow-x-auto">
      {tabs.map((tab) => {
        const busy = tab.state.status === 'thinking'
        const live = tab.state.status === 'ready' || busy
        const active = tab.id === activeId

        return (
          <div
            key={tab.id}
            onClick={() => setActive(tab.id)}
            title={tab.cwd}
            className={`group flex items-center gap-1.5 pl-2 pr-1 shrink-0 max-w-[180px]
                        border-r border-[var(--color-border)] cursor-pointer transition-colors ${
                          active
                            ? 'bg-[var(--color-bg)]'
                            : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
                        }`}
          >
            {live && (
              <Circle
                size={6}
                className={`shrink-0 ${
                  busy
                    ? 'fill-amber-400 text-amber-400 animate-pulse'
                    : 'fill-emerald-400 text-emerald-400'
                }`}
              />
            )}
            <span className="text-[11px] truncate">
              {tab.cwd ? projectName(tab.cwd) : tab.title}
            </span>
            {tab.queue.length > 0 && (
              <span className="text-[9px] text-[var(--color-muted)] shrink-0">
                +{tab.queue.length}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                void closeTab(tab.id)
              }}
              title={t('Close tab')}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100
                         hover:bg-[var(--color-surface-2)] transition-opacity shrink-0"
            >
              <X size={9} />
            </button>
          </div>
        )
      })}

      <button
        onClick={() => openTab()}
        title={t('New conversation tab')}
        className="px-2 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-text)]
                   hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <Plus size={11} />
      </button>
    </div>
  )
}
