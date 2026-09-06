import { ShieldQuestion } from 'lucide-react'
import ToolPreview from './ToolPreview'
import { useChatStore } from '../store/chat-store'
import { useTranslate } from '../i18n'

/**
 * Permission request from the CLI control channel. The process blocks until it is
 * answered, which is why this dialog is modal with no way to simply dismiss it.
 */
export default function PermissionDialog(): React.JSX.Element | null {
  const t = useTranslate()
  const reply = useChatStore((s) => s.reply)
  const permission = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId)?.permission)
  if (!permission) return null

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="w-[640px] max-w-[92%] bg-[var(--color-surface)] border border-[var(--color-border)]
                      rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <ShieldQuestion size={15} className="text-amber-400" />
          <span className="text-[13px]">{t('Allow this tool?')}</span>
        </div>

        <div className="px-4 py-3 space-y-2">
          <div className="text-[12px]">
            <span className="text-[var(--color-muted)]">{t('Tool')}: </span>
            <span className="font-medium">{permission.toolName}</span>
          </div>
          <ToolPreview toolName={permission.toolName} input={permission.input} />
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={() => void reply({ behavior: 'deny', message: 'Denied by user' })}
            className="flex-1 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {t('Deny')}
          </button>
          <button
            onClick={() => void reply({ behavior: 'allow' })}
            className="flex-1 py-1.5 rounded-md text-[12px] bg-[var(--color-accent)]
                       hover:opacity-90 transition-opacity"
          >
            {t('Allow')}
          </button>
        </div>
      </div>
    </div>
  )
}
