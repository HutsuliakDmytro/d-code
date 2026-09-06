import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { editSelection, suggestCommitMessage } from '../src/main/claude/code-actions'
import { cleanLine, extractCode } from '../src/main/claude/quick-ask'

const execFileAsync = promisify(execFile)
const enabled = process.env.CLAUDE_UI_E2E === '1'

describe('розбір відповіді моделі', () => {
  it('дістає код із ```-блоку', () => {
    const answer = 'Ось оновлений код:\n\n```ts\nconst x = 1\n```\n\nЯ додав константу.'
    expect(extractCode(answer)).toBe('const x = 1')
  })

  it('без блоку повертає текст як є', () => {
    expect(extractCode('const y = 2')).toBe('const y = 2')
  })

  it('зберігає відступи всередині блоку', () => {
    const answer = '```\nfunction a() {\n  return 1\n}\n```'
    expect(extractCode(answer)).toBe('function a() {\n  return 1\n}')
  })

  it('чистить однорядкову відповідь від лапок і блоків', () => {
    expect(cleanLine('"додати обробку помилок"')).toBe('додати обробку помилок')
    expect(cleanLine('```\nвиправити парсер\n```')).toBe('виправити парсер')
    // Зайві рядки відкидаються: повідомлення коміту має бути одне.
    expect(cleanLine('перший рядок\nдругий рядок')).toBe('перший рядок')
  })
})

describe.runIf(enabled)('дії з кодом на живому CLI', () => {
  it(
    'переписує виділений фрагмент за інструкцією',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'ccui-code-'))
      try {
        const result = await editSelection({
          cwd: root,
          path: 'sum.ts',
          language: 'typescript',
          selection: 'function sum(a, b) {\n  return a + b\n}',
          instruction: 'Додай типи number для аргументів і результату',
          model: 'sonnet'
        })

        console.log('\nвідповідь:', JSON.stringify(result.code))
        expect(result.ok).toBe(true)
        expect(result.code).toBeTruthy()
        // Модель мала додати типи, а не переписати функцію з нуля.
        expect(result.code).toContain('number')
        expect(result.code).toContain('sum')
        // Пояснень у коді бути не має — він іде прямо у файл.
        expect(result.code).not.toContain('```')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    180_000
  )

  it(
    'складає повідомлення коміту з підготовлених змін',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'ccui-commit-'))
      try {
        const git = (args: string[]): Promise<unknown> =>
          execFileAsync('git', ['-C', root, ...args])
        await git(['init', '-b', 'main'])
        await git(['config', 'user.email', 'test@example.com'])
        await git(['config', 'user.name', 'Test'])
        await writeFile(join(root, 'README.md'), '# проєкт\n', 'utf8')
        await git(['add', '.'])
        await git(['commit', '-m', 'початок'])

        // Зміна з очевидним змістом — так легше перевірити осмисленість відповіді.
        await writeFile(
          join(root, 'auth.ts'),
          'export function login(user: string): boolean {\n  return Boolean(user)\n}\n',
          'utf8'
        )
        await git(['add', '.'])

        const result = await suggestCommitMessage(root, 'sonnet')
        console.log('повідомлення:', JSON.stringify(result.text))

        expect(result.ok).toBe(true)
        expect(result.text).toBeTruthy()
        // Один рядок, без обгорток і без крапки в кінці.
        expect(result.text).not.toContain('\n')
        expect(result.text!.length).toBeLessThan(120)
        expect(result.text).not.toContain('```')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
    180_000
  )

  it('без підготовлених змін повідомляє про це', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccui-empty-'))
    try {
      await execFileAsync('git', ['-C', root, 'init', '-b', 'main'])
      const result = await suggestCommitMessage(root, 'sonnet')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/немає змін/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)
})
