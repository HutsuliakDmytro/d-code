import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Plus, X, TerminalSquare, AlertTriangle } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import type { TerminalInfo } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/** Palette matching the application theme. */
const THEME = {
  background: '#0a0a0b',
  foreground: '#e7e7ea',
  cursor: '#c96442',
  selectionBackground: '#3a241d',
  black: '#1a1a1f',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e7e7ea'
}

/**
 * A single terminal.
 *
 * xterm lives outside React: remounting would wipe the screen and scrollback, so
 * tabs are hidden rather than unmounted.
 */
function TerminalInstance({
  id,
  visible
}: {
  id: string
  visible: boolean
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm>(null)
  const fitRef = useRef<FitAddon>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const term = new XTerm({
      fontSize: 11.5,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(hostRef.current)

    termRef.current = term
    fitRef.current = fit

    // Output buffered before mount — the shell greeting, for instance.
    void window.claudeUI.terminalBuffer(id).then((buffer) => {
      if (buffer) term.write(buffer)
    })

    const offData = window.claudeUI.onTerminalData((chunk) => {
      if (chunk.id === id) term.write(chunk.data)
    })
    const disposeInput = term.onData((data) => void window.claudeUI.terminalWrite(id, data))

    const syncSize = (): void => {
      try {
        fit.fit()
        void window.claudeUI.terminalResize(id, term.cols, term.rows)
      } catch {
        // A hidden container has no measurable size.
      }
    }
    const observer = new ResizeObserver(syncSize)
    observer.observe(hostRef.current)
    syncSize()

    return () => {
      offData()
      disposeInput.dispose()
      observer.disconnect()
      term.dispose()
    }
  }, [id])

  // A hidden tab has no valid size; refit as soon as it becomes visible.
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit()
        const term = termRef.current
        if (term) void window.claudeUI.terminalResize(id, term.cols, term.rows)
      } catch {
        // same reason
      }
    }, 30)
    return () => clearTimeout(timer)
  }, [visible, id])

  return <div ref={hostRef} className={`h-full w-full ${visible ? '' : 'hidden'}`} />
}

/** Tabbed terminals. The working directory comes from the current project. */
export default function TerminalPanel(): React.JSX.Element {
  const t = useTranslate()
  const root = useWorkspaceStore((s) => s.root)
  const [terminals, setTerminals] = useState<TerminalInfo[]>([])
  const [activeId, setActiveId] = useState<string>()
  const [support, setSupport] = useState<{ available: boolean; error?: string }>()

  useEffect(() => {
    void window.claudeUI.terminalAvailable().then(setSupport)
    void window.claudeUI.terminalList().then((list) => {
      setTerminals(list)
      if (list.length > 0) setActiveId((current) => current ?? list[0].id)
    })

    const offExit = window.claudeUI.onTerminalExit((info) => {
      setTerminals((prev) => prev.map((t) => (t.id === info.id ? info : t)))
    })
    return offExit
  }, [])

  async function create(): Promise<void> {
    const info = await window.claudeUI.terminalCreate(root ?? '', 80, 24)
    setTerminals((prev) => [...prev, info])
    setActiveId(info.id)
  }

  async function close(id: string): Promise<void> {
    await window.claudeUI.terminalClose(id)
    setTerminals((prev) => {
      const remaining = prev.filter((t) => t.id !== id)
      if (activeId === id) setActiveId(remaining.at(-1)?.id)
      return remaining
    })
  }

  if (support && !support.available) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center">
        <AlertTriangle size={18} className="text-amber-400" />
        <p className="text-[11.5px] text-[var(--color-muted)]">
          {t('Terminals unavailable: the native module failed to load.')}
        </p>
        {support.error && (
          <p className="text-[10px] font-mono text-[var(--color-muted)] line-clamp-3">
            {support.error}
          </p>
        )}
        <p className="text-[10px] text-[var(--color-muted)]">
          {t('Try')} <span className="font-mono">npx electron-rebuild -f -w node-pty</span>
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)]">
      <div className="shrink-0 flex items-stretch h-[26px] border-b border-[var(--color-border)] overflow-x-auto">
        {terminals.map((t) => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            title={t.cwd}
            className={`group flex items-center gap-1.5 pl-2 pr-1 shrink-0 max-w-[160px]
                        border-r border-[var(--color-border)] cursor-pointer transition-colors ${
                          t.id === activeId
                            ? 'bg-[var(--color-bg)]'
                            : 'bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]'
                        }`}
          >
            <TerminalSquare
              size={10}
              className={t.running ? 'text-emerald-400' : 'text-[var(--color-muted)]'}
            />
            <span className="text-[11px] truncate">{t.title}</span>
            {!t.running && <span className="text-[9px] text-[var(--color-muted)]">✕</span>}
            <button
              onClick={(e) => {
                e.stopPropagation()
                void close(t.id)
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100
                         hover:bg-[var(--color-surface-2)] transition-opacity shrink-0"
            >
              <X size={9} />
            </button>
          </div>
        ))}

        <button
          onClick={() => void create()}
          title={t('New terminal')}
          className="px-2 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-text)]
                     hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <Plus size={11} />
        </button>
      </div>

      <div className="flex-1 min-h-0 p-1">
        {terminals.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <button
              onClick={() => void create()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px]
                         bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/30
                         transition-colors"
            >
              <Plus size={12} />
              {t('Open terminal')}{root ? ` · ${root.split('/').at(-1)}` : ''}
            </button>
          </div>
        ) : (
          terminals.map((t) => (
            <TerminalInstance key={t.id} id={t.id} visible={t.id === activeId} />
          ))
        )}
      </div>
    </div>
  )
}
