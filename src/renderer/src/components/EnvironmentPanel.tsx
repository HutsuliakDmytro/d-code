import { useEffect, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Plug,
  RefreshCw,
  Sparkles,
  Webhook,
  Package
} from 'lucide-react'
import type { AgentType, HookEntry, McpServer, PluginEntry, SkillEntry } from '@shared/ipc'
import { useWorkspaceStore } from '../store/workspace-store'
import { useTranslate } from '../i18n'

function Group({
  icon,
  title,
  count,
  children,
  action
}: {
  icon: React.ReactNode
  title: string
  count: number
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 py-1 text-[10.5px] text-[var(--color-muted)]
                   hover:text-[var(--color-text)] transition-colors"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {icon}
        <span>{title}</span>
        <span className="ml-auto tabular-nums">{count}</span>
        {action}
      </button>
      {open && <div className="pl-4 pb-1 space-y-0.5">{children}</div>}
    </div>
  )
}

/**
 * What the model actually has here: MCP servers, agents, skills, hooks, plugins.
 * Read from the same sources the CLI uses, not from our own settings.
 */
export default function EnvironmentPanel(): React.JSX.Element {
  const t = useTranslate()
  const root = useWorkspaceStore((s) => s.root)
  const [mcp, setMcp] = useState<McpServer[]>([])
  const [agents, setAgents] = useState<AgentType[]>([])
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [hooks, setHooks] = useState<HookEntry[]>([])
  const [plugins, setPlugins] = useState<PluginEntry[]>([])
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    void window.claudeUI.listAgentTypes().then(setAgents)
    void window.claudeUI.listSkills().then(setSkills)
    void window.claudeUI.listPlugins().then(setPlugins)
  }, [])

  useEffect(() => {
    void window.claudeUI.listHooks(root).then(setHooks)
  }, [root])

  async function checkMcp(): Promise<void> {
    setChecking(true)
    setMcp(await window.claudeUI.listMcpServers())
    setChecking(false)
  }

  return (
    <section className="pt-1 border-t border-[var(--color-border)]">
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1">
        {t('Model environment')}
      </h3>

      <Group
        icon={<Plug size={10} />}
        title={t('MCP servers')}
        count={mcp.length}
        action={
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              void checkMcp()
            }}
            title={t('Check connection')}
            className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
          >
            <RefreshCw size={9} className={checking ? 'animate-spin' : ''} />
          </span>
        }
      >
        {mcp.length === 0 && (
          <p className="text-[10px] text-[var(--color-muted)]">
            {checking ? t('Checking…') : t('Press refresh — the check takes a few seconds.')}
          </p>
        )}
        {mcp.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5" title={s.target}>
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                s.connected ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
            <span className="text-[10.5px] truncate">{s.name}</span>
            {!s.connected && (
              <span className="text-[9px] text-red-400 shrink-0">{s.status}</span>
            )}
          </div>
        ))}
      </Group>

      <Group icon={<Bot size={10} />} title={t('Agents')} count={agents.length}>
        {agents.map((a) => (
          <div key={a.name} title={a.description}>
            <span className="text-[10.5px] font-mono">{a.name}</span>
            {a.description && (
              <p className="text-[9.5px] text-[var(--color-muted)] line-clamp-2 leading-snug">
                {a.description}
              </p>
            )}
          </div>
        ))}
      </Group>

      <Group icon={<Sparkles size={10} />} title={t('Skills')} count={skills.length}>
        {skills.map((s) => (
          <div key={s.name} title={s.description}>
            <span className="text-[10.5px] font-mono text-[var(--color-accent)]">/{s.name}</span>
          </div>
        ))}
      </Group>

      <Group icon={<Webhook size={10} />} title={t('Hooks')} count={hooks.length}>
        {hooks.length === 0 && (
          <p className="text-[10px] text-[var(--color-muted)]">{t('Not configured.')}</p>
        )}
        {hooks.map((h, i) => (
          <div key={`${h.event}-${i}`} title={h.command}>
            <div className="flex items-baseline gap-1">
              <span className="text-[10.5px]">{h.event}</span>
              <span className="text-[9px] text-[var(--color-muted)]">{h.scope}</span>
            </div>
            <p className="text-[9.5px] font-mono text-[var(--color-muted)] truncate">
              {h.command}
            </p>
          </div>
        ))}
      </Group>

      <Group icon={<Package size={10} />} title={t('Plugins')} count={plugins.length}>
        {plugins.map((p) => (
          <div key={p.name}>
            <span className="text-[10.5px]">{p.name}</span>
            {p.source && (
              <span className="ml-1 text-[9px] text-[var(--color-muted)]">{p.source}</span>
            )}
          </div>
        ))}
      </Group>
    </section>
  )
}
