import { X, FileText, Image as ImageIcon } from 'lucide-react'
import type { Attachment } from '@shared/types'
import { formatSize } from '../lib/attachments'
import { useTranslate } from '../i18n'

/** Preview of attached files above the composer. */
export default function AttachmentChips({
  items,
  onRemove
}: {
  items: Attachment[]
  onRemove: (id: string) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  if (items.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {items.map((a) => (
        <div
          key={a.id}
          title={a.path ?? a.name}
          className="group relative flex items-center gap-1.5 pl-1.5 pr-6 py-1 rounded-md
                     bg-[var(--color-surface-2)] border border-[var(--color-border)]"
        >
          {a.kind === 'image' && a.base64 ? (
            <img
              src={`data:${a.mediaType};base64,${a.base64}`}
              alt={a.name}
              className="w-6 h-6 object-cover rounded-sm"
            />
          ) : a.kind === 'image' ? (
            <ImageIcon size={12} className="text-[var(--color-muted)]" />
          ) : (
            <FileText size={12} className="text-[var(--color-muted)]" />
          )}

          <div className="min-w-0">
            <div className="text-[10.5px] truncate max-w-[140px]">{a.name}</div>
            <div className="text-[9px] text-[var(--color-muted)]">{formatSize(a.size)}</div>
          </div>

          <button
            onClick={() => onRemove(a.id)}
            title={t('Remove')}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded
                       text-[var(--color-muted)] hover:text-[var(--color-text)]
                       hover:bg-[var(--color-surface)] transition-colors"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  )
}
