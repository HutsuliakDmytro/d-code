import { describe, it, expect } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ChatManager } from '../src/main/claude/chat-manager'

const enabled = process.env.CLAUDE_UI_E2E === '1'

describe.runIf(enabled)('індикатор контексту', () => {
  it(
    'рахує заповнення вікна після ходу',
    async () => {
      const cwd = join(process.cwd(), '.e2e-tmp')
      await mkdir(cwd, { recursive: true })

      const chat = new ChatManager()
      const done = new Promise<void>((resolve) => chat.once('result', () => resolve()))

      await chat.start({ cwd, model: 'sonnet', permissionMode: 'acceptEdits' })
      chat.send('Скажи одним словом: контекст')
      await done
      await chat.stop()

      const context = chat.getState().context
      console.log('\nконтекст:', JSON.stringify(context))

      expect(context).toBeDefined()
      expect(context!.used).toBeGreaterThan(0)
      // Вікно моделі має бути реальним, а не вигаданим числом.
      expect(context!.total).toBeGreaterThanOrEqual(200_000)
      expect(context!.percent).toBeGreaterThanOrEqual(0)
      expect(context!.percent).toBeLessThanOrEqual(100)
      // Модель має бути основною, а не службовим haiku.
      expect(context!.model).toContain('sonnet')
    },
    120_000
  )
})
