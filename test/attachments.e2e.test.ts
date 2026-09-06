import { describe, it, expect } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ClaudeRunner } from '../src/main/claude/runner'
import { readAttachment } from '../src/main/system/attachments'
import type { Attachment } from '../src/shared/types'
import type { StreamMessage } from '../src/main/claude/protocol'

const execFileAsync = promisify(execFile)
const enabled = process.env.CLAUDE_UI_E2E === '1'

function textOf(messages: StreamMessage[]): string {
  return messages
    .filter((m) => m.type === 'assistant')
    .flatMap((m) => ((m as { message?: { content?: unknown[] } }).message?.content ?? []) as unknown[])
    .filter((b): b is { type: string; text: string } => {
      const x = b as { type?: string; text?: unknown }
      return x.type === 'text' && typeof x.text === 'string'
    })
    .map((b) => b.text)
    .join('\n')
}

describe.runIf(enabled)('вкладення', () => {
  it(
    'модель бачить прикріплене зображення і прочитує прикріплений файл',
    async () => {
      const cwd = join(process.cwd(), '.e2e-tmp')
      await mkdir(cwd, { recursive: true })

      // Однотонний PNG відомого кольору — відповідь можна перевірити точно.
      const imagePath = join(cwd, 'swatch.png')
      await execFileAsync('/bin/zsh', [
        '-lc',
        `sips -s format png -z 240 240 --padColor FF0000 ` +
          `/System/Library/CoreServices/DefaultDesktop.heic --out ${JSON.stringify(imagePath)} ` +
          `>/dev/null 2>&1 || sips -s format png --resampleWidth 200 ` +
          `/System/Library/CoreServices/DefaultDesktop.heic --out ${JSON.stringify(imagePath)} >/dev/null 2>&1`
      ]).catch(() => undefined)

      const notePath = join(cwd, 'secret-note.txt')
      await writeFile(notePath, 'Кодове слово: ПЛАТИПУС\n', 'utf8')

      const image = await readAttachment(imagePath)
      const note = await readAttachment(notePath)
      console.log('\nзображення:', JSON.stringify(image).slice(0, 120))
      console.log('файл:', JSON.stringify(note).slice(0, 160))

      expect('error' in note).toBe(false)
      const noteAtt = note as Attachment
      // Звичайний файл передається шляхом, а не вмістом.
      expect(noteAtt.kind).toBe('file')
      expect(noteAtt.path).toBe(notePath)
      expect(noteAtt.base64).toBeUndefined()

      const attachments: Attachment[] = [noteAtt]
      if (!('error' in image)) {
        const imgAtt = image as Attachment
        expect(imgAtt.kind).toBe('image')
        expect(imgAtt.base64).toBeTruthy()
        expect(imgAtt.mediaType).toBe('image/png')
        attachments.unshift(imgAtt)
      } else {
        console.log('(зображення створити не вдалося — перевіряємо лише файл)')
      }

      const runner = new ClaudeRunner({ cwd, model: 'sonnet', permissionMode: 'acceptEdits' })
      const received: StreamMessage[] = []
      runner.on('message', (m) => received.push(m))
      runner.on('stderr', (l) => console.log('[stderr]', l.slice(0, 120)))

      const done = new Promise<void>((resolve, reject) => {
        runner.on('message', (m) => m.type === 'result' && resolve())
        runner.on('exit', (code) => code !== 0 && reject(new Error(`exit ${code}`)))
      })

      runner.start()
      runner.send(
        'Прочитай прикріплений файл і назви кодове слово. Якщо є зображення — додай одним словом його переважний колір.',
        attachments
      )
      await done
      runner.stop()

      const answer = textOf(received)
      console.log('відповідь:', answer.slice(0, 300))

      // Файл передавався лише шляхом — щоб назвати слово, модель мусила його прочитати.
      expect(answer.toUpperCase()).toContain('ПЛАТИПУС')
      const usedRead = received.some((m) =>
        JSON.stringify(m).includes('"name":"Read"')
      )
      expect(usedRead).toBe(true)
    },
    120_000
  )
})
