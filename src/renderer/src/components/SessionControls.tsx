import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  FolderOpen,
  Radio,
  Square,
  Terminal,
  X
} from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { useChatStore } from '../store/chat-store'
import { relativeTime } from '../lib/format'
import type { LiveSession } from '@shared/types'
import { useTranslate } from '../i18n'

/** How long an action result message stays on screen. */
const FLASH_MS = 4000

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tone = 'normal',
  title
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'normal' | 'danger' | 'accent'
  title?: string
}): React.JSX.Element {
  const toneClass =
    tone === 'danger'
      ? 'hover:bg-red-950/50 hover:border-red-900/60'
      : tone === 'accent'
        ? 'hover:bg-[var(--color-accent-soft)] hover:border-[var(--color-accent)]/50'
        : 'hover:bg-[var(--color-surface-2)]'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] text-left
                  border border-[var(--color-border)] transition-colors
                  disabled:opacity-35 disabled:cursor-not-allowed ${toneClass}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * Confirmation before starting Remote Control.
 *
 * This grants outside access to the machine, so the button does not fire straight
 * away — the user has to see what will run and in which directory.
 */
function RemoteControlDialog({
  cwd,
  onClose,
  onConfirm
}: {
  cwd: string
  onClose: () => void
  onConfirm: (name: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const [name, setName] = useState('')

  return (
    // fixed rather than absolute: the metrics panel is too narrow for the dialog.
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="w-[420px] max-w-[90%] bg-[var(--color-surface)] border border-[var(--color-border)]
                      rounded-lg shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          <Radio size={15} className="text-[var(--color-accent)]" />
          <span className="text-[13px]">{t('Start a session with Remote Control')}</span>
          <button
            onClick={onClose}
            className="ml-auto p-0.5 rounded hover:bg-[var(--color-surface-2)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="flex items-start gap-1.5 text-[11px] text-amber-400 bg-amber-950/20
                          border border-amber-900/40 rounded-md px-2 py-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              {t('The session becomes controllable from your other devices. Claude will run commands in this directory on instructions from there.')}
            </span>
          </div>

          <label className="block">
            <span className="text-[10.5px] text-[var(--color-muted)]">{t('Session name (optional)')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('defaults to the host name')}
              className="w-full mt-0.5 bg-[var(--color-surface-2)] border border-[var(--color-border)]
                         rounded-md px-2 py-1 text-[11.5px] outline-none
                         focus:border-[var(--color-accent)] placeholder:text-[var(--color-muted)]"
            />
          </label>

          <div>
            <span className="text-[10.5px] text-[var(--color-muted)]">{t('Will run')}</span>
            <pre className="mt-0.5 text-[10.5px] font-mono bg-[var(--color-bg)] rounded p-2
                            whitespace-pre-wrap break-all text-neutral-300">
              {`cd ${cwd}\nclaude --remote-control${name ? ` ${name}` : ''}`}
            </pre>
          </div>

          <p className="text-[10px] text-[var(--color-muted)]">
            {t('Remote Control only works in an interactive session, so it opens in a terminal rather than this window.')}
          </p>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            className="flex-1 py-1.5 rounded-md text-[12px] border border-[var(--color-border)]
                       hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={() => onConfirm(name.trim())}
            className="flex-1 py-1.5 rounded-md text-[12px] bg-[var(--color-accent)]
                       hover:opacity-90 transition-opacity"
          >
            {t('Start')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LiveSessionRow({
  session,
  onStop,
  onOpen
}: {
  session: LiveSession
  onStop: () => void
  onOpen: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const waiting = session.status === 'waiting'
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${waiting ? 'bg-amber-400' : 'bg-emerald-400'}`}
        title={session.waitingFor ?? session.status}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] truncate">{session.name ?? session.cwd.split('/').at(-1)}</div>
        <div className="text-[9.5px] text-[var(--color-muted)] truncate">
          pid {session.pid} · {session.kind} · {session.waitingFor ?? session.status} ·{' '}
          {relativeTime(session.startedAt)}
        </div>
      </div>
      <button
        onClick={onOpen}
        title={t('Open in terminal')}
        className="shrink-0 p-1 rounded hover:bg-[var(--color-surface-2)] transition-colors"
      >
        <ExternalLink size={11} />
      </button>
      <button
        onClick={onStop}
        title={t('Stop the process (SIGTERM)')}
        className="shrink-0 p-1 rounded hover:bg-red-950/50 transition-colors"
      >
        <Square size={11} className="text-red-300" />
      </button>
    </div>
  )
}

export default function SessionControls(): React.JSX.Element {
  const t = useTranslate()
  const selected = useAppStore((s) => s.selected)
  const chatState = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId)!.state)
  const activeId = useChatStore((s) => s.activeId)
  const closeTab = useChatStore((s) => s.closeTab)
  const [live, setLive] = useState<LiveSession[]>([])
  const [flash, setFlash] = useState<{ text: string; error: boolean }>()
  const [rcOpen, setRcOpen] = useState(false)

  const cwd = selected?.meta.projectPath
  const chatActive = chatState.status === 'ready' || chatState.status === 'thinking'

  // The live-process registry changes outside the app, so it is polled.
  useEffect(() => {
    let cancelled = false
    const poll = async (): Promise<void> => {
      const sessions = await window.claudeUI.listLiveSessions()
      if (!cancelled) setLive(sessions)
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(undefined), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  function report(result: { ok: boolean; error?: string }, success: string): void {
    setFlash({ text: result.ok ? success : (result.error ?? t('failed')), error: !result.ok })
  }

  return (
    <section className="pt-1 border-t border-[var(--color-border)] space-y-2">
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        {t('Controls')}
      </h3>

      <div className="grid grid-cols-2 gap-1.5">
        <ActionButton
          icon={<Terminal size={11} />}
          label={t('In terminal')}
          disabled={!cwd}
          title={t('Open this session in a terminal via claude --resume')}
          onClick={() => {
            if (!cwd) return
            void window.claudeUI
              .openInTerminal(cwd, selected?.meta.sessionId)
              .then((r) => report(r, t('Terminal opened')))
          }}
        />
        <ActionButton
          icon={<Radio size={11} />}
          label="Remote Control"
          tone="accent"
          disabled={!cwd}
          title={t('Start a new interactive session with remote access')}
          onClick={() => setRcOpen(true)}
        />
        <ActionButton
          icon={<FolderOpen size={11} />}
          label={t('Folder')}
          disabled={!cwd}
          onClick={() => {
            if (!cwd) return
            void window.claudeUI.openFolder(cwd).then((r) => report(r, t('Opened')))
          }}
        />
        <ActionButton
          icon={<Copy size={11} />}
          label={t('Resume command')}
          disabled={!selected}
          title={t('Copy claude --resume <id>')}
          onClick={() => {
            if (!selected) return
            void navigator.clipboard
              .writeText(`claude --resume ${selected.meta.sessionId}`)
              .then(() => report({ ok: true }, t('Copied')))
          }}
        />
        <ActionButton
          icon={<FolderOpen size={11} />}
          label={t('Transcript')}
          disabled={!selected}
          title={t('Reveal the .jsonl file')}
          onClick={() => {
            if (!selected) return
            void window.claudeUI.revealInFinder(selected.meta.filePath)
          }}
        />
        <ActionButton
          icon={<Square size={11} />}
          label={t('Stop chat')}
          tone="danger"
          disabled={!chatActive}
          title={t('Terminate our CLI process')}
          onClick={() => void closeTab(activeId).then(() => report({ ok: true }, t('Conversation stopped')))}
        />
      </div>

      {flash && (
        <p className={`text-[10px] ${flash.error ? 'text-red-400' : 'text-emerald-400'}`}>
          {flash.text}
        </p>
      )}

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            {t('Running processes')}
          </span>
          <span className="text-[10px] text-[var(--color-muted)] tabular-nums">{live.length}</span>
        </div>
        {live.length === 0 ? (
          <p className="text-[10px] text-[var(--color-muted)] mt-0.5">{t('No sessions running.')}</p>
        ) : (
          <div className="mt-0.5 divide-y divide-[var(--color-border)]">
            {live.map((s) => (
              <LiveSessionRow
                key={s.pid}
                session={s}
                onOpen={() => {
                  void window.claudeUI
                    .openInTerminal(s.cwd, s.sessionId)
                    .then((r) => report(r, t('Terminal opened')))
                }}
                onStop={() => {
                  void window.claudeUI.stopProcess(s.pid).then((r) => {
                    report(r, t('Process {pid} stopped', { pid: s.pid }))
                    void window.claudeUI.listLiveSessions().then(setLive)
                  })
                }}
              />
            ))}
          </div>
        )}
      </div>

      {rcOpen && cwd && (
        <RemoteControlDialog
          cwd={cwd}
          onClose={() => setRcOpen(false)}
          onConfirm={(name) => {
            setRcOpen(false)
            void window.claudeUI
              .startRemoteControl(cwd, name || undefined)
              .then((r) => report(r, t('Remote Control session started in a terminal')))
          }}
        />
      )}
    </section>
  )
}
