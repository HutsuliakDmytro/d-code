import { describe, it, expect } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ClaudeRunner } from '../src/main/claude/runner'
import type { StreamMessage } from '../src/main/claude/protocol'

const enabled = process.env.CLAUDE_UI_E2E === '1'

describe.runIf(enabled)('переривання ходу', () => {
  it(
    'зупиняє хід, але лишає процес живим і придатним для наступної репліки',
    async () => {
      const cwd = join(process.cwd(), '.e2e-tmp')
      await mkdir(cwd, { recursive: true })

      const runner = new ClaudeRunner({ cwd, model: 'sonnet', permissionMode: 'acceptEdits' })
      const received: StreamMessage[] = []
      let exited = false

      runner.on('message', (m) => received.push(m))
      runner.on('exit', () => {
        exited = true
      })
      runner.on('stderr', (l) => console.log('[stderr]', l.slice(0, 120)))

      runner.start()
      // Свідомо довге завдання, щоб було що переривати.
      runner.send('Порахуй уголос від 1 до 300, кожне число з нового рядка.')

      // Даємо ходу початися, потім перериваємо.
      await new Promise((r) => setTimeout(r, 3500))
      const beforeInterrupt = received.length
      runner.interrupt()

      const firstResult = await new Promise<StreamMessage | undefined>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 20_000)
        const check = (m: StreamMessage): void => {
          if (m.type !== 'result') return
          clearTimeout(timer)
          runner.off('message', check)
          resolve(m)
        }
        runner.on('message', check)
      })

      console.log(`\nподій до переривання: ${beforeInterrupt}`)
      console.log('result після переривання:', JSON.stringify(firstResult)?.slice(0, 260))
      console.log('процес вийшов:', exited)

      // Головне: SIGINT убив би процес, а керуючий запит — ні.
      expect(exited).toBe(false)
      expect(runner.running).toBe(true)

      // Після переривання діалог має приймати нову репліку.
      const secondResult = new Promise<StreamMessage>((resolve) => {
        const check = (m: StreamMessage): void => {
          if (m.type !== 'result') return
          runner.off('message', check)
          resolve(m)
        }
        runner.on('message', check)
      })
      runner.send('Забудь попереднє. Відповідай одним словом: ОК')
      const second = await secondResult
      console.log('друга відповідь:', JSON.stringify(second).slice(0, 200))

      expect((second as { is_error?: boolean }).is_error).toBe(false)
      runner.stop()
    },
    90_000
  )
})
