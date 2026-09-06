import { describe, it, expect } from 'vitest'
import {
  loginShell,
  planUsageHistoryPath,
  shellQuote,
  shellArgs,
  whichCommand,
  needsShell,
  hasCommand,
  IS_MAC,
  IS_WIN
} from '../src/main/system/platform'

describe('платформний шар', () => {
  it('оболонка існує на цій системі', async () => {
    const { access, constants } = await import('node:fs/promises')
    await expect(access(loginShell(), constants.X_OK)).resolves.toBeUndefined()
  })

  it('шлях історії лімітів залежить від системи', () => {
    const path = planUsageHistoryPath()
    expect(path.endsWith('plan-usage-history.json')).toBe(true)
    if (IS_MAC) expect(path).toContain('Library/Application Support')
    else if (IS_WIN) expect(path).toContain('Claude')
    else expect(path).not.toContain('Library')
  })

  it('аргументи оболонки відповідають системі', () => {
    const args = shellArgs('echo hi')
    // Команда завжди останній аргумент — інакше оболонка виконає не те.
    expect(args.at(-1)).toBe('echo hi')
    expect(args[0]).toBe(IS_WIN ? '/d' : '-lc')
    expect(whichCommand('git')).toBe(IS_WIN ? 'where git' : 'command -v git')
  })

  it('через оболонку запускаються лише батники Windows', () => {
    expect(needsShell('/usr/bin/git')).toBe(false)
    // На Unix жоден файл цього не потребує, тому очікування залежить від системи.
    expect(needsShell('C:\\npm\\claude.cmd')).toBe(IS_WIN)
    expect(needsShell('C:\\Program Files\\node.exe')).toBe(false)
  })

  it('знаходить наявну команду і не вигадує відсутню', async () => {
    await expect(hasCommand('git')).resolves.toBe(true)
    await expect(hasCommand('zzz-такої-команди-немає')).resolves.toBe(false)
    await expect(hasCommand('')).resolves.toBe(false)
  })

  it('екранує аргументи для оболонки', () => {
    if (IS_WIN) {
      expect(shellQuote('C:\\a b')).toBe('"C:\\a b"')
      expect(shellQuote('say "hi"')).toBe('"say ""hi"""')
    } else {
      // Каталог з апострофом у назві не має ламати команду оболонки.
      expect(shellQuote("/tmp/it's here")).toBe(`'/tmp/it'\\''s here'`)
      expect(shellQuote('/tmp/plain')).toBe(`'/tmp/plain'`)
    }
  })
})
