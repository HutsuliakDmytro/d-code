import { describe, it, expect } from 'vitest'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ClaudeRunner } from '../src/main/claude/runner'
import { encodeProjectPath, PROJECTS_DIR } from '../src/main/store/project-paths'
import type { ResultEvent, StreamMessage, SystemInitEvent } from '../src/main/claude/protocol'

/**
 * Ці тести роблять СПРАВЖНІ виклики API і витрачають ліміт, тому за замовчуванням
 * вимкнені. Запуск: CLAUDE_UI_E2E=1 npx vitest run test/runner.e2e.test.ts
 */
const enabled = process.env.CLAUDE_UI_E2E === '1'

describe.runIf(enabled)('ClaudeRunner (справжній CLI)', () => {
  it(
    'проводить хід і віддає потік подій',
    async () => {
      const cwd = join(process.cwd(), '.e2e-tmp')
      await mkdir(cwd, { recursive: true })

      const runner = new ClaudeRunner({ cwd, model: 'sonnet', permissionMode: 'acceptEdits' })
      const received: StreamMessage[] = []
      const stderr: string[] = []

      const done = new Promise<ResultEvent>((resolve, reject) => {
        runner.on('message', (m) => {
          received.push(m)
          if (m.type === 'result') resolve(m as ResultEvent)
        })
        runner.on('stderr', (l) => stderr.push(l))
        runner.on('error', reject)
        runner.on('exit', (code) => {
          if (!received.some((m) => m.type === 'result')) {
            reject(new Error(`процес вийшов з кодом ${code} без result. stderr: ${stderr.join('\n')}`))
          }
        })
      })

      runner.start()
      runner.send('Відповідай рівно одним словом: OK')

      const result = await done
      runner.stop()

      const types = received.map((m) => m.type)
      console.log('\nтипи подій:', [...new Set(types)].join(', '))
      console.log('подій усього:', received.length)
      if (stderr.length) console.log('stderr:', stderr.slice(0, 5).join('\n'))

      // Мінімальний контракт потоку, на який спирається UI.
      expect(types).toContain('system')
      expect(types).toContain('assistant')
      expect(types).toContain('result')
      expect(result.is_error).toBe(false)

      const init = received.find(
        (m): m is SystemInitEvent => m.type === 'system' && (m as SystemInitEvent).subtype === 'init'
      )
      expect(init?.session_id).toBe(runner.sessionId)
      expect(init?.tools.length).toBeGreaterThan(0)
      console.log(`модель: ${init?.model}, режим дозволів: ${init?.permissionMode}`)

      // Вартість приходить готовою — власний прайсинг для живих сесій не потрібен.
      expect(result.total_cost_usd).toBeGreaterThan(0)
      console.log(`вартість: $${result.total_cost_usd?.toFixed(4)}, моделі:`,
        Object.keys(result.modelUsage ?? {}).join(', '))

      // Часткові чанки — основа стрімінгу в UI.
      expect(types).toContain('stream_event')

      // Сесія має опинитися на диску там, де її очікує список сесій.
      const dir = join(PROJECTS_DIR, encodeProjectPath(cwd))
      const files = await readdir(dir).catch(() => [] as string[])
      console.log(`файли сесії в ${encodeProjectPath(cwd)}:`, files.join(', '))
      expect(files).toContain(`${runner.sessionId}.jsonl`)
    },
    120_000
  )
})
