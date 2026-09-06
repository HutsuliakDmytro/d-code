import { describe, it, expect } from 'vitest'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ChatManager } from '../src/main/claude/chat-manager'
import { parseTranscript } from '../src/main/store/parser'
import { encodeProjectPath, PROJECTS_DIR } from '../src/main/store/project-paths'
import type { ChatState, ChatStreamEvent } from '../src/shared/ipc'

const enabled = process.env.CLAUDE_UI_E2E === '1'

describe.runIf(enabled)('ChatManager (справжній CLI)', () => {
  it(
    'проводить діалог, зберігає транскрипт і продовжує сесію через resume',
    async () => {
      const cwd = join(process.cwd(), '.e2e-tmp')
      await mkdir(cwd, { recursive: true })

      const chat = new ChatManager()
      const states: ChatState[] = []
      const events: ChatStreamEvent[] = []
      chat.on('state', (s: ChatState) => states.push(s))
      chat.on('event', (e: ChatStreamEvent) => events.push(e))

      const nextResult = (): Promise<void> =>
        new Promise((resolve) => chat.once('result', () => resolve()))

      // ── Хід 1: нова сесія ────────────────────────────────────────────────
      await chat.start({ cwd, model: 'sonnet', permissionMode: 'acceptEdits' })
      const firstResult = nextResult()
      // Не чекаємо на `system/init`: CLI надсилає його лише у відповідь на першу
      // репліку, тож очікування тут заблокувало б діалог назавжди.
      const sessionId = chat.getState().sessionId
      expect(sessionId).toBeTruthy()

      chat.send('Запамʼятай число 7. Відповідай одним словом: готово')
      await firstResult
      await chat.stop()

      console.log('\nстани:', states.map((s) => s.status).join(' → '))
      console.log('типи подій:', [...new Set(events.map((e) => e.type))].join(', '))

      expect(states.map((s) => s.status)).toContain('ready')
      expect(states.map((s) => s.status)).toContain('thinking')

      // ── Транскрипт має лягти на диск і читатися нашим парсером ───────────
      const file = join(PROJECTS_DIR, encodeProjectPath(cwd), `${sessionId}.jsonl`)
      const parsed = await parseTranscript(file, { projectPath: cwd, encodedDir: '' })
      console.log(
        `транскрипт: ${parsed.messages.length} повід., заголовок "${parsed.meta.title}" ` +
          `[${parsed.meta.titleSource}], невідомих типів: ${parsed.unknownTypes.size}`
      )
      expect(parsed.messages.length).toBeGreaterThan(0)
      expect(parsed.unknownTypes.size).toBe(0)
      // Шлях проєкту має братися з cwd транскрипту, а не з імені каталогу.
      expect(parsed.meta.projectPath).toBe(cwd)

      // ── Хід 2: resume тієї самої сесії ───────────────────────────────────
      const chat2 = new ChatManager()
      const resumeResult = new Promise<void>((resolve) => chat2.once('result', () => resolve()))
      await chat2.start({
        cwd,
        model: 'sonnet',
        permissionMode: 'acceptEdits',
        resumeSessionId: sessionId
      })

      chat2.send('Яке число я просив запамʼятати? Відповідай лише цифрою.')
      await resumeResult
      await chat2.stop()

      // Контекст мав зберегтися — інакше resume не працює.
      const after = await parseTranscript(file, { projectPath: cwd, encodedDir: '' })
      const lastAssistant = [...after.messages].reverse().find((m) => m.role === 'assistant')
      console.log(`відповідь після resume: "${lastAssistant?.text.trim().slice(0, 60)}"`)
      expect(after.messages.length).toBeGreaterThan(parsed.messages.length)
      expect(lastAssistant?.text).toContain('7')
    },
    120_000
  )
})
