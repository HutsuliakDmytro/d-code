import { useState } from 'react'
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw, FilePlus } from 'lucide-react'
import type { FileNode } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { formatSize } from '../lib/attachments'
import FileContextMenu, { type MenuTarget } from '../components/FileContextMenu'
import { useTranslate } from '../i18n'

function Row({
  node,
  depth,
  onMenu
}: {
  node: FileNode
  depth: number
  onMenu: (target: MenuTarget) => void
}): React.JSX.Element {
  const { expanded, tree, activePath, root, toggleDir, openFile, openInSplit, refreshDir } =
    useWorkspaceStore()
  const [dragOver, setDragOver] = useState(false)
  const isOpen = expanded.has(node.path)
  const isActive = activePath === node.path
  const children = tree[node.path]

  return (
    <>
      <button
        onClick={(e) => {
          if (node.isDirectory) {
            void toggleDir(node.path)
            return
          }
          // Alt opens in the second column; a plain click uses the main one.
          if (e.altKey) void openInSplit(node.path)
          else void openFile(node.path)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu({ node, x: e.clientX, y: e.clientY })
        }}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/ccui-path', node.path)}
        onDragOver={(e) => {
          if (!node.isDirectory) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          setDragOver(false)
          if (!node.isDirectory || !root) return
          const source = e.dataTransfer.getData('text/ccui-path')
          if (!source || source === node.path) return
          e.preventDefault()
          void window.claudeUI.movePath(root, source, node.path).then(async (result) => {
            if (!result.ok) return
            // Refresh both sides of the move.
            await refreshDir(source.split('/').slice(0, -1).join('/'))
            await refreshDir(node.path)
          })
        }}
        title={node.relativePath}
        className={`w-full flex items-center gap-1 py-[3px] pr-2 text-left transition-colors ${
          isActive
            ? 'bg-[var(--color-accent-soft)]'
            : dragOver
              ? 'bg-[var(--color-accent)]/20'
              : 'hover:bg-[var(--color-surface-2)]'
        }`}
        style={{ paddingLeft: `${depth * 11 + 6}px` }}
      >
        {node.isDirectory ? (
          <>
            {node.hasChildren ? (
              isOpen ? (
                <ChevronDown size={11} className="shrink-0 text-[var(--color-muted)]" />
              ) : (
                <ChevronRight size={11} className="shrink-0 text-[var(--color-muted)]" />
              )
            ) : (
              <span className="w-[11px] shrink-0" />
            )}
            {isOpen ? (
              <FolderOpen size={11} className="shrink-0 text-[var(--color-accent)]" />
            ) : (
              <Folder size={11} className="shrink-0 text-[var(--color-muted)]" />
            )}
          </>
        ) : (
          <>
            <span className="w-[11px] shrink-0" />
            <File size={11} className="shrink-0 text-[var(--color-muted)]" />
          </>
        )}
        <span className="text-[11.5px] truncate">{node.name}</span>
        {!node.isDirectory && node.size > 0 && (
          <span className="ml-auto text-[9px] text-[var(--color-muted)] shrink-0">
            {formatSize(node.size)}
          </span>
        )}
      </button>

      {node.isDirectory &&
        isOpen &&
        children?.map((child) => (
          <Row key={child.path} node={child} depth={depth + 1} onMenu={onMenu} />
        ))}
    </>
  )
}

/** Project tree. Branches load lazily — a repository can be huge. */
export default function FileTree(): React.JSX.Element {
  const t = useTranslate()
  const { root, tree, loadingDir, loadDir } = useWorkspaceStore()
  const [menu, setMenu] = useState<MenuTarget>()
  const nodes = root ? tree[root] : undefined

  if (!root) {
    return (
      <p className="px-3 py-3 text-[11.5px] text-[var(--color-muted)]">
        {t('Select a session — its working directory becomes the project root.')}
      </p>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
        <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] truncate flex-1">
          {root.split('/').at(-1)}
        </span>
        <button
          onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}
          title={t('New file or folder')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <FilePlus size={10} />
        </button>
        <button
          onClick={() => void loadDir()}
          title={t('Reload')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <RefreshCw size={10} className={loadingDir.has(root) ? 'animate-spin' : ''} />
        </button>
      </div>

      <div
        className="flex-1 overflow-auto py-1"
        onContextMenu={(e) => {
          // Right click on empty space acts on the project root.
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {!nodes && <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">{t('Reading…')}</p>}
        {nodes?.length === 0 && (
          <p className="px-3 py-2 text-[11px] text-[var(--color-muted)]">{t('Empty')}</p>
        )}
        {nodes?.map((n) => <Row key={n.path} node={n} depth={0} onMenu={setMenu} />)}
      </div>

      {menu && <FileContextMenu target={menu} onClose={() => setMenu(undefined)} />}
    </div>
  )
}
