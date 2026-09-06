import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ClaudeRunner } from '../src/main/claude/runner'
import { childEnv, resolveClaudePath, resolveShellPath } from '../src/main/claude/resolve-cli'
import type { StreamMessage } from '../src/main/claude/protocol'
import { hasClaudeBinary } from './local-data'

const enabled = process.env.CLAUDE_UI_E2E === '1'

/**
 * Відтворює середовище застосунку, запущеного з Dock: там PATH урізаний до
 * системного мінімуму, без `~/.local/bin` і homebrew. Саме через це `spawn('claude')`
 * падав з ENOENT, хоча в терміналі все працювало.
 */
const DOCK_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

describe('запуск CLI з урізаним PATH', () => {
  let originalPath: string | undefined

  beforeEach(() => {
    originalPath = process.env.PATH
    process.env.PATH = DOCK_PATH
  })

  afterEach(() => {
    process.env.PATH = originalPath
  })

  it.skipIf(!hasClaudeBinary)('знаходить claude, якого немає в PATH', async () => {
    const path = await resolveClaudePath()
    console.log('\nрезолв:', path)

    expect(path).not.toBe('claude')
    expect(path.startsWith('/')).toBe(true)
    expect(path).toContain('claude')
  })

  it('відновлює повний PATH для дочірніх процесів', async () => {
    const shellPath = await resolveShellPath()
    console.log('каталогів у PATH:', shellPath.split(':').length)

    // Урізаний PATH мав рівно чотири каталоги; повний має бути ширшим.
    expect(shellPath.split(':').length).toBeGreaterThan(4)

    const env = await childEnv()
    expect(env.PATH).toBe(shellPath)
    expect(env.PATH).not.toBe(DOCK_PATH)
  })

  it.runIf(enabled)(
    'сесія стартує навіть коли claude поза PATH',
    async () => {
      const cwd = join(process.cwd(), '.e2e-tmp')
      await mkdir(cwd, { recursive: true })

      const runner = new ClaudeRunner({ cwd, model: 'sonnet', permissionMode: 'acceptEdits' })
      const received: StreamMessage[] = []
      const errors: string[] = []

      runner.on('message', (m) => received.push(m))
      runner.on('error', (e) => errors.push(e.message))

      const done = new Promise<void>((resolve, reject) => {
        runner.on('message', (m) => m.type === 'result' && resolve())
        runner.on('exit', (code) => {
          if (!received.some((m) => m.type === 'result')) {
            reject(new Error(`вихід ${code}; помилки: ${errors.join(', ') || 'немає'}`))
          }
        })
      })

      await runner.start()
      runner.send('Відповідай одним словом: працює')
      await done
      runner.stop()

      console.log('подій:', received.length, '| помилок:', errors.length)
      // Головне: жодного ENOENT — саме він ламав запуск із Dock.
      expect(errors.filter((e) => e.includes('ENOENT'))).toEqual([])
      expect(received.some((m) => m.type === 'result')).toBe(true)

      await rm(cwd, { recursive: true, force: true })
    },
    120_000
  )
})
