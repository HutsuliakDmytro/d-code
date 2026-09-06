import { describe, it, expect } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ChatManager } from '../src/main/claude/chat-manager'
import type { ChatState } from '../src/shared/ipc'

const enabled = process.env.CLAUDE_UI_E2E === '1'

describe.runIf(enabled)('зміна налаштувань активного діалогу', () => {
  it(
    'міняє модель і вмикає bypassPermissions без перезапуску',
    async () => {
      const cwd = join(process.cwd(), '.e2e-tmp')
      await mkdir(cwd, { recursive: true })

      const chat = new ChatManager()
      const states: ChatState[] = []
      chat.on('state', (s: ChatState) => states.push(s))

      const turn = (): Promise<void> =>
        new Promise((resolve) => chat.once('result', () => resolve()))

      await chat.start({ cwd, model: 'sonnet', permissionMode: 'acceptEdits' })

      // Перша репліка потрібна, щоб CLI надіслав system/init із поточною моделлю.
      const first = turn()
      chat.send('Скажи одним словом: раз')
      await first
      const modelBefore = chat.getState().model
      console.log('\nмодель на старті:', modelBefore)
      expect(modelBefore).toContain('sonnet')

      // ── Модель на льоту ──
      const modelResult = await chat.setModel('opus')
      console.log('setModel:', JSON.stringify(modelResult))
      expect(modelResult.ok).toBe(true)

      const second = turn()
      chat.send('Скажи одним словом: два')
      await second
      const modelAfter = chat.getState().model
      console.log('модель після зміни:', modelAfter)
      expect(modelAfter).toContain('opus')
      expect(modelAfter).not.toBe(modelBefore)

      // ── Режим дозволів на льоту ──
      // Саме це раніше відмовляло: без --allow-dangerously-skip-permissions
      // CLI не давав перемкнутися на bypassPermissions.
      const modeResult = await chat.setPermissionMode('bypassPermissions')
      console.log('setPermissionMode:', JSON.stringify(modeResult))
      expect(modeResult.ok).toBe(true)
      expect(chat.getState().permissionMode).toBe('bypassPermissions')

      const third = turn()
      chat.send('Скажи одним словом: три')
      await third
      // init після зміни режиму приходить без моделі — вона не має загубитися.
      console.log('модель наприкінці:', chat.getState().model)
      expect(chat.getState().model).toContain('opus')
      expect(chat.getState().permissionMode).toBe('bypassPermissions')

      await chat.stop()
      console.log('стани:', states.map((s) => s.status).join(' → '))
    },
    150_000
  )
})
