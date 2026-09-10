import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addHook,
  mcpAddArgs,
  removeHook,
  settingsPath,
  settingsScopes,
  splitCommand
} from '../src/main/system/settings-edit'

let root: string
let projectFile: string

/** Reads the project settings file the tests write to. */
async function read(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(projectFile, 'utf8')) as Record<string, unknown>
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccui-settings-'))
  await mkdir(join(root, '.claude'), { recursive: true })
  projectFile = join(root, '.claude', 'settings.json')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('settingsPath', () => {
  it('розводить project і local по різних файлах', () => {
    expect(settingsPath('project', root)).toBe(join(root, '.claude', 'settings.json'))
    expect(settingsPath('local', root)).toBe(join(root, '.claude', 'settings.local.json'))
  })

  it('проєктний скоуп без теки проєкту — це помилка, а не тихий запис у ~', () => {
    expect(() => settingsPath('project')).toThrow()
  })
})

describe('addHook', () => {
  it('створює файл, якого ще не було', async () => {
    const result = await addHook('project', { event: 'PostToolUse', command: 'echo hi' }, root)
    expect(result.ok).toBe(true)

    const data = await read()
    expect(data.hooks).toEqual({
      PostToolUse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }]
    })
  })

  it('не чіпає сусідні ключі у файлі', async () => {
    await writeFile(projectFile, JSON.stringify({ model: 'opus', env: { A: '1' } }), 'utf8')
    await addHook('project', { event: 'Stop', command: 'echo bye' }, root)

    const data = await read()
    expect(data.model).toBe('opus')
    expect(data.env).toEqual({ A: '1' })
  })

  it('до наявного matcher додає команду, а не замінює її', async () => {
    await addHook('project', { event: 'PreToolUse', matcher: 'Edit', command: 'a' }, root)
    await addHook('project', { event: 'PreToolUse', matcher: 'Edit', command: 'b' }, root)

    const hooks = (await read()).hooks as Record<string, Array<{ hooks: unknown[] }>>
    expect(hooks.PreToolUse).toHaveLength(1)
    expect(hooks.PreToolUse[0].hooks).toHaveLength(2)
  })

  it('різні matcher — різні правила', async () => {
    await addHook('project', { event: 'PreToolUse', matcher: 'Edit', command: 'a' }, root)
    await addHook('project', { event: 'PreToolUse', matcher: 'Bash', command: 'a' }, root)

    const hooks = (await read()).hooks as Record<string, unknown[]>
    expect(hooks.PreToolUse).toHaveLength(2)
  })

  it('той самий хук двічі не додається', async () => {
    await addHook('project', { event: 'Stop', command: 'echo' }, root)
    const again = await addHook('project', { event: 'Stop', command: 'echo' }, root)
    expect(again.ok).toBe(false)
  })

  it('порожню команду відхиляє', async () => {
    expect((await addHook('project', { event: 'Stop', command: '  ' }, root)).ok).toBe(false)
  })

  it('зіпсований JSON не перезаписується наосліп', async () => {
    await writeFile(projectFile, '{ це не json', 'utf8')
    const result = await addHook('project', { event: 'Stop', command: 'echo' }, root)

    expect(result.ok).toBe(false)
    expect(await readFile(projectFile, 'utf8')).toBe('{ це не json')
  })

  it('перед першою зміною лишає резервну копію', async () => {
    await writeFile(projectFile, JSON.stringify({ model: 'opus' }), 'utf8')
    await addHook('project', { event: 'Stop', command: 'echo' }, root)

    const backup = JSON.parse(await readFile(`${projectFile}.bak`, 'utf8')) as { model: string }
    expect(backup.model).toBe('opus')
  })
})

describe('removeHook', () => {
  it('прибирає команду й лишає решту', async () => {
    await addHook('project', { event: 'PreToolUse', matcher: 'Edit', command: 'a' }, root)
    await addHook('project', { event: 'PreToolUse', matcher: 'Edit', command: 'b' }, root)

    const result = await removeHook('project', { event: 'PreToolUse', matcher: 'Edit', command: 'a' }, root)
    expect(result.ok).toBe(true)

    const hooks = (await read()).hooks as Record<string, Array<{ hooks: Array<{ command: string }> }>>
    expect(hooks.PreToolUse[0].hooks.map((h) => h.command)).toEqual(['b'])
  })

  it('порожні правила й події не лишаються у файлі', async () => {
    await addHook('project', { event: 'Stop', command: 'echo' }, root)
    await removeHook('project', { event: 'Stop', command: 'echo' }, root)

    expect(await read()).not.toHaveProperty('hooks')
  })

  it('видалення того, чого нема, — помилка, а не мовчазний успіх', async () => {
    await addHook('project', { event: 'Stop', command: 'echo' }, root)
    const result = await removeHook('project', { event: 'Stop', command: 'інша' }, root)
    expect(result.ok).toBe(false)
  })

  it('matcher враховується при пошуку', async () => {
    await addHook('project', { event: 'PreToolUse', matcher: 'Edit', command: 'a' }, root)
    const wrong = await removeHook('project', { event: 'PreToolUse', matcher: 'Bash', command: 'a' }, root)
    expect(wrong.ok).toBe(false)
  })
})

describe('settingsScopes', () => {
  it('розрізняє наявний, відсутній і зіпсований файл', async () => {
    await writeFile(projectFile, '{}', 'utf8')
    await writeFile(join(root, '.claude', 'settings.local.json'), '{ зламано', 'utf8')

    const scopes = await settingsScopes(root)
    const byScope = Object.fromEntries(scopes.map((s) => [s.scope, s]))

    expect(byScope.project.exists).toBe(true)
    expect(byScope.project.error).toBeUndefined()
    expect(byScope.local.exists).toBe(true)
    expect(byScope.local.error).toBeTruthy()
  })

  it('без теки проєкту лишається тільки глобальний скоуп', async () => {
    const scopes = await settingsScopes()
    expect(scopes.map((s) => s.scope)).toEqual(['user'])
  })
})

describe('splitCommand', () => {
  it('розбиває по пробілах', () => {
    expect(splitCommand('npx -y server')).toEqual(['npx', '-y', 'server'])
  })

  it('зберігає лапки навколо шляхів із пробілами', () => {
    expect(splitCommand('node "/My Files/s.js" --flag')).toEqual([
      'node',
      '/My Files/s.js',
      '--flag'
    ])
  })
})

describe('mcpAddArgs', () => {
  it('stdio-команда йде після --, щоб її прапорці не з’їв claude', () => {
    const args = mcpAddArgs({
      name: 'gh',
      transport: 'stdio',
      target: 'npx -y server --verbose',
      scope: 'user'
    })
    expect(args).toEqual([
      'mcp',
      'add',
      '--scope',
      'user',
      'gh',
      '--',
      'npx',
      '-y',
      'server',
      '--verbose'
    ])
  })

  it('для http/sse передає транспорт і URL без --', () => {
    const args = mcpAddArgs({
      name: 'api',
      transport: 'http',
      target: 'https://example.com/mcp',
      scope: 'project'
    })
    expect(args).toEqual([
      'mcp',
      'add',
      '--scope',
      'project',
      '--transport',
      'http',
      'api',
      'https://example.com/mcp'
    ])
  })

  it('змінні оточення без = ігноруються', () => {
    const args = mcpAddArgs({
      name: 'x',
      transport: 'stdio',
      target: 'run',
      scope: 'local',
      env: ['TOKEN=abc', 'сміття']
    })
    expect(args.filter((a) => a === '--env')).toHaveLength(1)
    expect(args).toContain('TOKEN=abc')
  })
})
