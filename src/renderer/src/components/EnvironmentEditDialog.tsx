import { useCallback, useEffect, useState } from 'react'
import {
  ExternalLink,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  Webhook,
  X
} from 'lucide-react'
import type {
  HookEntry,
  McpServer,
  McpServerInput,
  ScopeInfo,
  SettingsScope
} from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

/** Events the CLI recognises. An unknown event is accepted and never fires. */
const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionStart',
  'SessionEnd',
  'PreCompact'
]

const INPUT_CLASS = `bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded
                     px-2 py-1 text-[11px] outline-none focus:border-[var(--color-accent)]
                     placeholder:text-[var(--color-muted)]`

function ScopeSelect({
  value,
  onChange,
  scopes
}: {
  value: SettingsScope
  onChange: (scope: SettingsScope) => void
  scopes: ScopeInfo[]
}): React.JSX.Element {
  const t = useTranslate()
  const labels: Record<SettingsScope, string> = {
    user: t('everywhere'),
    project: t('this project'),
    local: t('this project, only me')
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SettingsScope)}
      className={`${INPUT_CLASS} cursor-pointer`}
    >
      {scopes.map((s) => (
        <option key={s.scope} value={s.scope}>
          {labels[s.scope]}
        </option>
      ))}
    </select>
  )
}

/**
 * Editing the model's environment: MCP servers and hooks.
 *
 * Both live in files the CLI reads on every run, so every change here names the
 * file it will land in — an "add" that quietly picks a scope for you is how
 * people end up with a hook that fires in one project and not another.
 */
export default function EnvironmentEditDialog({
  open,
  onClose,
  onChanged
}: {
  open: boolean
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const root = useWorkspaceStore((s) => s.root)
  const [tab, setTab] = useState<'mcp' | 'hooks'>('mcp')
  const [scopes, setScopes] = useState<ScopeInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const [servers, setServers] = useState<McpServer[]>([])
  const [checking, setChecking] = useState(false)
  const [mcp, setMcp] = useState<McpServerInput>({
    name: '',
    transport: 'stdio',
    target: '',
    scope: 'user'
  })

  const [hooks, setHooks] = useState<HookEntry[]>([])
  const [hook, setHook] = useState({
    event: 'PostToolUse',
    matcher: '',
    command: '',
    scope: 'user' as SettingsScope
  })

  const reload = useCallback(async () => {
    const [scopeInfo, hookList] = await Promise.all([
      window.claudeUI.settingsScopes(root),
      window.claudeUI.listHooks(root)
    ])
    setScopes(scopeInfo)
    setHooks(hookList)
  }, [root])

  useEffect(() => {
    if (!open) return
    setError(undefined)
    void reload()
  }, [open, reload])

  if (!open) return null

  const broken = scopes.find((s) => s.error)

  async function checkServers(): Promise<void> {
    setChecking(true)
    try {
      setServers(await window.claudeUI.listMcpServers())
    } finally {
      setChecking(false)
    }
  }

  /** Runs an edit, surfaces its error and refreshes everything that changed. */
  async function run(action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
    setBusy(true)
    setError(undefined)
    try {
      const result = await action()
      if (!result.ok) {
        setError(result.error)
        return false
      }
      await reload()
      onChanged()
      return true
    } finally {
      setBusy(false)
    }
  }

  async function addServer(): Promise<void> {
    const ok = await run(() => window.claudeUI.addMcpServer(mcp))
    if (!ok) return
    setMcp({ ...mcp, name: '', target: '' })
    // The new server's state is only known after a health check.
    await checkServers()
  }

  async function addHook(): Promise<void> {
    const ok = await run(() =>
      window.claudeUI.addHook(
        hook.scope,
        { event: hook.event, matcher: hook.matcher.trim() || undefined, command: hook.command },
        root
      )
    )
    if (ok) setHook({ ...hook, matcher: '', command: '' })
  }

  const tabs: Array<{ id: 'mcp' | 'hooks'; icon: React.ReactNode; label: string; count: number }> = [
    { id: 'mcp', icon: <Plug size={11} />, label: t('MCP servers'), count: servers.length },
    { id: 'hooks', icon: <Webhook size={11} />, label: t('Hooks'), count: hooks.length }
  ]

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[620px] max-w-[95%] h-[72vh] flex flex-col bg-[var(--color-surface)]
                   border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)]">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-1.5 text-[12px] transition-colors ${
                tab === item.id
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {item.icon}
              {item.label}
              {item.count > 0 && <span className="tabular-nums text-[10px]">{item.count}</span>}
            </button>
          ))}
          {busy && <Loader2 size={12} className="animate-spin text-[var(--color-muted)]" />}
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-[var(--color-surface-2)]">
            <X size={13} />
          </button>
        </div>

        {broken && (
          <p className="shrink-0 px-4 py-1.5 text-[10.5px] text-red-400 border-b border-[var(--color-border)]">
            {t('{path} is not valid JSON — fix it by hand before editing here.', {
              path: broken.path
            })}
          </p>
        )}

        <div className="flex-1 overflow-y-auto">
          {tab === 'mcp' && (
            <>
              {servers.length === 0 && (
                <p className="px-4 py-3 text-[11px] text-[var(--color-muted)]">
                  {checking
                    ? t('Checking…')
                    : t('Press refresh to check which servers are configured and reachable.')}
                </p>
              )}
              {servers.map((server) => (
                <div
                  key={server.name}
                  className="group flex items-center gap-2 px-4 py-1.5 border-b
                             border-[var(--color-border)] last:border-0
                             hover:bg-[var(--color-surface-2)]"
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      server.connected ? 'bg-emerald-400' : 'bg-red-400'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11.5px] truncate">{server.name}</p>
                    <p className="text-[9.5px] font-mono text-[var(--color-muted)] truncate">
                      {server.target}
                    </p>
                  </div>
                  {!server.connected && (
                    <span className="text-[9.5px] text-red-400 shrink-0 max-w-[180px] truncate">
                      {server.status}
                    </span>
                  )}
                  <button
                    onClick={() =>
                      void run(() => window.claudeUI.removeMcpServer(server.name)).then((ok) => {
                        if (ok) void checkServers()
                      })
                    }
                    disabled={busy}
                    title={t('Remove server')}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 shrink-0
                               hover:bg-[var(--color-surface)] hover:text-red-400
                               disabled:opacity-30 transition-opacity"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </>
          )}

          {tab === 'hooks' &&
            (hooks.length === 0 ? (
              <p className="px-4 py-3 text-[11px] text-[var(--color-muted)]">
                {t('No hooks configured.')}
              </p>
            ) : (
              hooks.map((entry, index) => (
                <div
                  key={`${entry.scope}-${entry.event}-${index}`}
                  className="group flex items-start gap-2 px-4 py-1.5 border-b
                             border-[var(--color-border)] last:border-0
                             hover:bg-[var(--color-surface-2)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[11.5px]">{entry.event}</span>
                      {entry.matcher && (
                        <span className="text-[9.5px] font-mono text-[var(--color-accent)]">
                          {entry.matcher}
                        </span>
                      )}
                      <span className="text-[9px] text-[var(--color-muted)]">{entry.scope}</span>
                    </div>
                    <p className="text-[9.5px] font-mono text-[var(--color-muted)] break-all">
                      {entry.command}
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      void run(() =>
                        window.claudeUI.removeHook(
                          entry.scope,
                          { event: entry.event, matcher: entry.matcher, command: entry.command },
                          root
                        )
                      )
                    }
                    disabled={busy}
                    title={t('Remove hook')}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 shrink-0
                               hover:bg-[var(--color-surface)] hover:text-red-400
                               disabled:opacity-30 transition-opacity"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            ))}
        </div>

        <div className="shrink-0 px-4 py-2.5 border-t border-[var(--color-border)] space-y-1.5">
          {tab === 'mcp' ? (
            <>
              <div className="flex gap-1.5">
                <input
                  value={mcp.name}
                  onChange={(e) => setMcp({ ...mcp, name: e.target.value })}
                  placeholder={t('Name')}
                  className={`${INPUT_CLASS} w-[130px]`}
                />
                <select
                  value={mcp.transport}
                  onChange={(e) =>
                    setMcp({ ...mcp, transport: e.target.value as McpServerInput['transport'] })
                  }
                  className={`${INPUT_CLASS} cursor-pointer`}
                >
                  <option value="stdio">stdio</option>
                  <option value="http">http</option>
                  <option value="sse">sse</option>
                </select>
                <ScopeSelect
                  value={mcp.scope}
                  onChange={(scope) => setMcp({ ...mcp, scope })}
                  scopes={scopes}
                />
                <button
                  onClick={() => void addServer()}
                  disabled={busy || !mcp.name.trim() || !mcp.target.trim()}
                  className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-[11px]
                             bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/30
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={11} />
                  {t('Add')}
                </button>
              </div>
              <input
                value={mcp.target}
                onChange={(e) => setMcp({ ...mcp, target: e.target.value })}
                placeholder={
                  mcp.transport === 'stdio'
                    ? t('Command, e.g. npx -y @modelcontextprotocol/server-github')
                    : t('URL of the server')
                }
                className={`${INPUT_CLASS} w-full font-mono text-[10.5px]`}
              />
            </>
          ) : (
            <>
              <div className="flex gap-1.5">
                <select
                  value={hook.event}
                  onChange={(e) => setHook({ ...hook, event: e.target.value })}
                  className={`${INPUT_CLASS} cursor-pointer`}
                >
                  {HOOK_EVENTS.map((event) => (
                    <option key={event} value={event}>
                      {event}
                    </option>
                  ))}
                </select>
                <input
                  value={hook.matcher}
                  onChange={(e) => setHook({ ...hook, matcher: e.target.value })}
                  placeholder={t('Matcher, e.g. Edit|Write')}
                  className={`${INPUT_CLASS} w-[150px] font-mono`}
                />
                <ScopeSelect
                  value={hook.scope}
                  onChange={(scope) => setHook({ ...hook, scope })}
                  scopes={scopes}
                />
                <button
                  onClick={() => void addHook()}
                  disabled={busy || !hook.command.trim()}
                  className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-[11px]
                             bg-[var(--color-accent-soft)] hover:bg-[var(--color-accent)]/30
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Plus size={11} />
                  {t('Add')}
                </button>
              </div>
              <input
                value={hook.command}
                onChange={(e) => setHook({ ...hook, command: e.target.value })}
                placeholder={t('Shell command to run')}
                className={`${INPUT_CLASS} w-full font-mono text-[10.5px]`}
              />
            </>
          )}

          {error && <p className="text-[10px] text-red-400 line-clamp-2">{error}</p>}

          <div className="flex items-center gap-2 pt-0.5">
            {tab === 'mcp' && (
              <button
                onClick={() => void checkServers()}
                className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]
                           hover:text-[var(--color-text)]"
              >
                <RefreshCw size={9} className={checking ? 'animate-spin' : ''} />
                {t('Check connection')}
              </button>
            )}
            {scopes.map((scope) => (
              <button
                key={scope.scope}
                onClick={() => void window.claudeUI.openSettingsFile(scope.scope, root)}
                title={scope.path}
                className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]
                           hover:text-[var(--color-text)]"
              >
                <ExternalLink size={9} />
                {scope.scope}
                {!scope.exists && <span className="text-[9px]">({t('none yet')})</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
