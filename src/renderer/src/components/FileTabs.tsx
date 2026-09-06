import { X, FileCode, Columns2 } from 'lucide-react'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/** Tab strip for open files. */
export default function FileTabs(): React.JSX.Element | null {
  const t = useTranslate()
  const { openFiles, activePath, splitPath, setActiveFile, closeFile, closeAllFiles, openInSplit } =
    useWorkspaceStore()
  if (openFiles.length === 0) return null

  return (
    <div className="shrink-0 flex items-stretch h-[30px] border-b border-[var(--color-border)] overflow-x-auto">
      {openFiles.map((file) => {
        const active = file.path === activePath
        const dirty = file.draft !== undefined
        const name = file.relativePath.split('/').at(-1) ?? file.relativePath

        return (
          <div
            key={file.path}
            onClick={(e) => {
              // Alt-click opens the file in the second column, as editors do.
              if (e.altKey) void openInSplit(file.path)
              else setActiveFile(file.path)
            }}
            onAuxClick={(e) => {
              // Middle click closes the tab — standard editor behaviour.
              if (e.button === 1) closeFile(file.path)
            }}
            title={file.relativePath}
            className={`group flex items-center gap-1.5 pl-2 pr-1 shrink-0 max-w-[200px]
                        border-r border-[var(--color-border)] cursor-pointer transition-colors ${
                          active
                            ? 'bg-[var(--color-bg)] border-t-2 border-t-[var(--color-accent)]'
                            : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)] border-t-2 border-t-transparent'
                        }`}
          >
            <FileCode size={10} className="shrink-0 text-[var(--color-muted)]" />
            <span className="text-[11px] truncate">{name}</span>
            {file.path === splitPath && (
              <Columns2 size={9} className="shrink-0 text-[var(--color-accent)]" />
            )}

            <button
              onClick={(e) => {
                e.stopPropagation()
                void openInSplit(file.path)
              }}
              title={t('Open to the side')}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100
                         hover:bg-[var(--color-surface-2)] shrink-0"
            >
              <Columns2 size={9} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeFile(file.path)
              }}
              title={dirty ? t('Unsaved changes') : t('Close')}
              className="p-0.5 rounded hover:bg-[var(--color-surface-2)] shrink-0"
            >
              {dirty ? (
                // A dot instead of a cross: signals unsaved state, still clickable.
                <span className="block w-[7px] h-[7px] rounded-full bg-[var(--color-accent)] group-hover:hidden" />
              ) : null}
              <X size={9} className={dirty ? 'hidden group-hover:block' : ''} />
            </button>
          </div>
        )
      })}

      {openFiles.length > 1 && (
        <button
          onClick={closeAllFiles}
          title={t('Close all')}
          className="px-2 shrink-0 text-[10px] text-[var(--color-muted)]
                     hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors"
        >
          ✕ {t('all')}
        </button>
      )}
    </div>
  )
}
