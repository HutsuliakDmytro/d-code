import { describe, it, expect } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ChatPool } from '../src/main/claude/chat-pool'
import type { ChatState } from '../src/shared/ipc'

const enabled = process.env.CLAUDE_UI_E2E === '1'

describe.runIf(enabled)('кілька діалогів одночасно', () => {
  it(
    'веде два процеси паралельно, події не змішуються',
    async () => {
      const cwdA = join(process.cwd(), '.e2e-tmp/a')
      const cwdB = join(process.cwd(), '.e2e-tmp/b')
      await mkdir(cwdA, { recursive: true })
      await mkdir(cwdB, { recursive: true })

      const pool = new ChatPool()
      const events: Array<{ tabId: string; type: string }> = []
      pool.on('event', (p: { tabId: string; event: { type: string } }) =>
        events.push({ tabId: p.tabId, type: p.event.type })
      )

      const resultOf = (tabId: string): Promise<void> =>
        new Promise((resolve) => {
          const handler = (p: { tabId: string }): void => {
            if (p.tabId !== tabId) return
            pool.off('result', handler)
            resolve()
          }
          pool.on('result', handler)
        })

      await pool.start('a', { cwd: cwdA, model: 'sonnet', permissionMode: 'acceptEdits' })
      await pool.start('b', { cwd: cwdB, model: 'sonnet', permissionMode: 'acceptEdits' })

      // Запускаємо обидва ходи, не чекаючи один одного — це і є паралельність.
      const doneA = resultOf('a')
      const doneB = resultOf('b')
      pool.send('a', 'Відповідай одним словом: альфа')
      pool.send('b', 'Відповідай одним словом: бета')
      await Promise.all([doneA, doneB])

      const stateA = pool.getState('a')
      const stateB = pool.getState('b')
      console.log('\nA:', stateA.sessionId?.slice(0, 8), stateA.cwd)
      console.log('B:', stateB.sessionId?.slice(0, 8), stateB.cwd)

      // Кожна вкладка має власну сесію й власний каталог.
      expect(stateA.sessionId).toBeTruthy()
      expect(stateB.sessionId).toBeTruthy()
      expect(stateA.sessionId).not.toBe(stateB.sessionId)
      expect(stateA.cwd).toBe(cwdA)
      expect(stateB.cwd).toBe(cwdB)

      // Події мають бути позначені правильною вкладкою.
      const tabsSeen = new Set(events.map((e) => e.tabId))
      console.log('вкладок у подіях:', [...tabsSeen].join(', '), '| подій:', events.length)
      expect(tabsSeen).toEqual(new Set(['a', 'b']))
      expect(events.filter((e) => e.tabId === 'a' && e.type === 'result')).toHaveLength(1)
      expect(events.filter((e) => e.tabId === 'b' && e.type === 'result')).toHaveLength(1)

      expect(pool.activeCount()).toBe(2)

      // Закриття однієї вкладки не чіпає другу.
      await pool.close('a')
      expect(pool.getState('a').status).toBe('idle')
      expect(pool.activeCount()).toBe(1)

      await pool.stopAll()
      expect(pool.activeCount()).toBe(0)

      await rm(join(process.cwd(), '.e2e-tmp'), { recursive: true, force: true })
    },
    180_000
  )
})
