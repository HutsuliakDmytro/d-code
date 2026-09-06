import { TerminalSquare, Globe, Bug, X } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/** Switches the bottom panel between terminals, localhost preview and the debugger. */
export default function BottomTabs(): React.JSX.Element {
  const { bottomTab, setBottomTab, toggleTerminal } = useWorkspaceStore()
  const t = useTranslate()

  const tabs = [
    { id: 'terminal' as const, label: t('Terminal'), icon: <TerminalSquare size={11} /> },
    { id: 'preview' as const, label: t('Preview'), icon: <Globe size={11} /> },
    { id: 'debug' as const, label: t('Debug'), icon: <Bug size={11} /> }
  ]

  return (
    <div className="shrink-0 flex items-stretch h-[24px] border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setBottomTab(tab.id)}
          className={`flex items-center gap-1.5 px-3 text-[10.5px] transition-colors ${
            bottomTab === tab.id
              ? 'text-[var(--color-text)] border-b-2 border-[var(--color-accent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}

      <button
        onClick={toggleTerminal}
        title={t('Hide panel (⌃`)')}
        className="ml-auto px-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        <X size={11} />
      </button>
    </div>
  )
}
