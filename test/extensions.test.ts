import { describe, it, expect } from 'vitest'
import { listAgentTypes, listHooks, listMcpServers, listPlugins } from '../src/main/system/extensions'

describe('listMcpServers', () => {
  it('парсить перелік із станом підключення', async () => {
    const servers = await listMcpServers()
    console.log(`\nMCP-серверів: ${servers.length}`)
    for (const s of servers) {
      console.log(`  ${s.connected ? '✓' : '✗'} ${s.name} → ${s.target} (${s.status})`)
    }
    if (servers.length === 0) return

    for (const s of servers) {
      expect(s.name.length).toBeGreaterThan(0)
      // Рядок статусу не має тягнути за собою значок.
      expect(s.status).not.toMatch(/^[✔✘×]/)
      // Заголовок «Checking MCP server health…» не є сервером.
      expect(s.name).not.toMatch(/Checking/)
    }
  }, 60_000)
})

describe('listHooks', () => {
  it('не падає, коли хуків немає', async () => {
    const hooks = await listHooks(process.cwd())
    console.log(`\nхуків: ${hooks.length}`)
    for (const h of hooks.slice(0, 5)) {
      console.log(`  [${h.scope}] ${h.event}${h.matcher ? ` (${h.matcher})` : ''} → ${h.command.slice(0, 40)}`)
    }
    for (const h of hooks) {
      expect(['user', 'project', 'local']).toContain(h.scope)
      expect(h.command.length).toBeGreaterThan(0)
    }
  })
})

describe('listPlugins', () => {
  it('читає маркетплейси', async () => {
    const plugins = await listPlugins()
    console.log(`\nмаркетплейсів: ${plugins.length}`)
    for (const p of plugins.slice(0, 4)) console.log(`  ${p.name} — ${p.source ?? 'без джерела'}`)
    for (const p of plugins) expect(p.name.length).toBeGreaterThan(0)
  })
})

describe('listAgentTypes', () => {
  it('витягує типи агентів із транскриптів', async () => {
    const agents = await listAgentTypes()
    console.log(`\nтипів агентів: ${agents.length}`)
    console.log('  ' + agents.map((a) => a.name).join(', '))
    for (const a of agents) {
      expect(a.name).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })
})
