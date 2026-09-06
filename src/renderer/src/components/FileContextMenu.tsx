import { useEffect, useRef, useState } from 'react'
import { FilePlus, FolderPlus, Pencil, Trash2, Copy, FolderOpen } from 'lucide-react'
import type { FileNode } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

export interface MenuTarget {
  node?: FileNode
  x: number
  y: number
}

type Prompt =
  | { kind: 'new-file' | 'new-dir'; dir: string; value: string }
  | { kind: 'rename'; path: string; value: string }

/**
 * Context menu for the file tree.
 *
 * Create and rename ask for the name inline, in a field under the menu: a separate
 * modal for a single line of text would only slow things down.
 */
export default function FileContextMenu({
  target,
  onClose
}: {
  target: MenuTarget
  onClose: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const { root, refreshDir, forgetFile, openFile } = useWorkspaceStore()
  const [prompt, setPrompt] = useState<Prompt>()
  const [error, setError] = useState<string>()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  if (!root) return null

  const node = target.node
  // Creation targets a directory; for a file that means its parent folder.
  const parentDir = node
    ? node.isDirectory
      ? node.path
      : node.path.split('/').slice(0, -1).join('/')
    : root

  async function submit(): Promise<void> {
    if (!prompt || !root) return
    const value = prompt.value.trim()
    if (!value) return

    if (prompt.kind === 'rename') {
      const result = await window.claudeUI.renamePath(root, prompt.path, value)
      if (!result.ok) {
        setError(result.error ?? t('Failed'))
        return
      }
      // The old tab points at a path that no longer exists.
      forgetFile(prompt.path)
      await refreshDir(prompt.path.split('/').slice(0, -1).join('/'))
      onClose()
      return
    }

    const result =
      prompt.kind === 'new-file'
        ? await window.claudeUI.createFile(root, prompt.dir, value)
        : await window.claudeUI.createDirectory(root, prompt.dir, value)

    if (!result.ok) {
      setError(result.error ?? t('Failed'))
      return
    }

    await refreshDir(prompt.dir)
    if (prompt.kind === 'new-file' && result.path) await openFile(result.path)
    onClose()
  }

  async function remove(): Promise<void> {
    if (!node || !root) return
    if (!confirm(t('Move “{name}” to Trash?', { name: node.name }))) return

    const result = await window.claudeUI.trashPath(root, node.path)
    if (!result.ok) {
      setError(result.error ?? t('Failed'))
      return
    }
    forgetFile(node.path)
    await refreshDir(node.path.split('/').slice(0, -1).join('/'))
    onClose()
  }

  const items = [
    {
      icon: <FilePlus size={11} />,
      label: t('New file'),
      run: () => setPrompt({ kind: 'new-file', dir: parentDir, value: '' })
    },
    {
      icon: <FolderPlus size={11} />,
      label: t('New folder'),
      run: () => setPrompt({ kind: 'new-dir', dir: parentDir, value: '' })
    },
    ...(node
      ? [
          {
            icon: <Pencil size={11} />,
            label: t('Rename'),
            run: () => setPrompt({ kind: 'rename', path: node.path, value: node.name })
          },
          {
            icon: <Copy size={11} />,
            label: t('Copy path'),
            run: () => {
              void navigator.clipboard.writeText(node.path)
              onClose()
            }
          },
          {
            icon: <FolderOpen size={11} />,
            label: t('Reveal in file manager'),
            run: () => {
              void window.claudeUI.revealInFinder(node.path)
              onClose()
            }
          },
          {
            icon: <Trash2 size={11} className="text-red-400" />,
            label: t('Move to Trash'),
            run: () => void remove()
          }
        ]
      : [])
  ]

  return (
    <div
      ref={ref}
      style={{ left: target.x, top: target.y }}
      className="fixed z-50 min-w-[190px] bg-[var(--color-surface)] border border-[var(--color-border)]
                 rounded-md shadow-2xl overflow-hidden py-1"
    >
      {prompt ? (
        <div className="px-2 py-1.5">
          <p className="text-[10px] text-[var(--color-muted)] mb-1">
            {prompt.kind === 'rename' ? t('New name') : t('Name')}
          </p>
          <input
            autoFocus
            value={prompt.value}
            onChange={(e) => {
              setPrompt({ ...prompt, value: e.target.value })
              setError(undefined)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') onClose()
            }}
            className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)]
                       rounded px-2 py-1 text-[11.5px] outline-none focus:border-[var(--color-accent)]"
          />
          {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
        </div>
      ) : (
        items.map((item) => (
          <button
            key={item.label}
            onClick={item.run}
            className="w-full flex items-center gap-2 px-3 py-1 text-left text-[11.5px]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {item.icon}
            {item.label}
          </button>
        ))
      )}
    </div>
  )
}
