import { describe, it, expect, afterAll } from 'vitest'
import { LspManager } from '../src/main/lsp/manager'

const manager = new LspManager()
const ROOT = process.cwd()

afterAll(async () => {
  await manager.stopAll()
})

/**
 * Тести піднімають справжній typescript-language-server. Він стартує кілька
 * секунд, тому таймаути щедрі, а сам сервер — один на всі перевірки.
 */
describe('LSP на справжньому сервері', () => {
  const file = `${ROOT}/src/main/store/project-paths.ts`

  it('дає автодоповнення', async () => {
    const content = 'const x = "abc"\nx.'
    const items = await manager.complete({
      root: ROOT,
      path: `${ROOT}/scratch-completion.ts`,
      language: 'typescript',
      content,
      line: 2,
      column: 3
    })

    console.log('\nваріантів доповнення:', items.length)
    expect(items.length).toBeGreaterThan(0)
    // Для рядка мають бути стандартні методи.
    expect(items.some((i) => i.label === 'toUpperCase')).toBe(true)
  }, 90_000)

  it('знаходить визначення символа', async () => {
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(file, 'utf8')
    // Позиція виклику encodeProjectPath усередині projectDir.
    const lines = content.split('\n')
    const lineNumber = lines.findIndex((l) => l.includes('join(PROJECTS_DIR, encodeProjectPath')) + 1
    const column = lines[lineNumber - 1].indexOf('encodeProjectPath') + 3

    const location = await manager.definition({
      root: ROOT,
      path: file,
      language: 'typescript',
      content,
      line: lineNumber,
      column
    })

    console.log('визначення:', JSON.stringify(location))
    expect(location).toBeDefined()
    expect(location!.path).toContain('project-paths.ts')
    // Має вказувати на оголошення функції, а не на її виклик.
    expect(location!.line).toBeLessThan(lineNumber)
  }, 90_000)

  it('показує типи при наведенні', async () => {
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(file, 'utf8')
    const lines = content.split('\n')
    const lineNumber = lines.findIndex((l) => l.includes('export function encodeProjectPath')) + 1
    const column = lines[lineNumber - 1].indexOf('encodeProjectPath') + 3

    const hover = await manager.hover({
      root: ROOT,
      path: file,
      language: 'typescript',
      content,
      line: lineNumber,
      column
    })

    console.log('hover:', hover?.contents.slice(0, 120))
    expect(hover?.contents).toContain('encodeProjectPath')
  }, 90_000)

  it('готує перейменування по всіх входженнях', async () => {
    const { readFile } = await import('node:fs/promises')
    const content = await readFile(file, 'utf8')
    const lines = content.split('\n')
    const lineNumber = lines.findIndex((l) => l.includes('export function encodeProjectPath')) + 1
    const column = lines[lineNumber - 1].indexOf('encodeProjectPath') + 3

    const edits = await manager.rename({
      root: ROOT,
      path: file,
      language: 'typescript',
      content,
      line: lineNumber,
      column,
      newName: 'encodePath'
    })

    console.log('правок перейменування:', edits.length)
    expect(edits.length).toBeGreaterThan(1)
    // Перейменування має зачепити не лише оголошення, а й виклики.
    expect(edits.every((e) => e.newText === 'encodePath')).toBe(true)
    expect(new Set(edits.map((e) => e.path)).size).toBeGreaterThanOrEqual(1)
  }, 120_000)

  it('невідома мова не піднімає сервер', async () => {
    const items = await manager.complete({
      root: ROOT,
      path: `${ROOT}/a.py`,
      language: 'python',
      content: 'x = 1',
      line: 1,
      column: 2
    })
    expect(items).toEqual([])
  }, 30_000)
})
