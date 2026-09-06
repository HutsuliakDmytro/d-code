import { describe, it, expect } from 'vitest'
import { fuzzyMatch, listProjectFiles } from '../src/main/system/file-index'
import { readPromptHistory } from '../src/main/system/prompt-history'

describe('fuzzyMatch', () => {
  const files = [
    'src/main/store/parser.ts',
    'src/renderer/src/panels/ChatView.tsx',
    'src/shared/ipc.ts',
    'test/parser.test.ts',
    'package.json'
  ]

  it('знаходить за уривками імені', () => {
    const hits = fuzzyMatch('parser', files).map((m) => m.path)
    expect(hits).toContain('src/main/store/parser.ts')
    expect(hits).toContain('test/parser.test.ts')
  })

  it('віддає перевагу збігу в імені файлу, а не в каталозі', () => {
    const [best] = fuzzyMatch('ipc', files)
    expect(best.path).toBe('src/shared/ipc.ts')
  })

  it('розуміє розкидані символи, як ⌘P', () => {
    const hits = fuzzyMatch('chatview', files).map((m) => m.path)
    expect(hits[0]).toBe('src/renderer/src/panels/ChatView.tsx')
  })

  it('відкидає те, де символи йдуть не по порядку', () => {
    expect(fuzzyMatch('zzz', files)).toEqual([])
    // Ті самі літери, але у зворотному порядку — не збіг.
    expect(fuzzyMatch('nosj.egakcap', files)).toEqual([])
  })

  it('порожній запит повертає початок списку', () => {
    expect(fuzzyMatch('', files, 3)).toHaveLength(3)
  })
})

describe('listProjectFiles', () => {
  it('перелічує файли проєкту без сміття', async () => {
    const files = await listProjectFiles(process.cwd())
    console.log(`\nфайлів у проєкті: ${files.length}`)
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
    expect(files.some((f) => f.startsWith('/'))).toBe(false)
    expect(files).toContain('package.json')
  })

  it('другий виклик іде з кешу і не повільніший', async () => {
    const start = Date.now()
    await listProjectFiles(process.cwd())
    expect(Date.now() - start).toBeLessThan(1000)
  })
})

describe('readPromptHistory', () => {
  it('віддає свіжі промпти без повторів', async () => {
    const all = await readPromptHistory({ limit: 50 })
    console.log(`\nпромптів у історії: ${all.length}`)
    if (all.length === 0) return

    for (const entry of all.slice(0, 3)) {
      console.log(`  ${entry.text.slice(0, 60)}`)
    }
    // Дублікатів бути не має — гортати однакове безглуздо.
    const texts = all.map((e) => e.text)
    expect(new Set(texts).size).toBe(texts.length)
    // Найсвіжіший — перший.
    if (all.length > 1 && all[0].timestamp && all[1].timestamp) {
      expect(all[0].timestamp).toBeGreaterThanOrEqual(all[1].timestamp)
    }
  })

  it('фільтрує за проєктом', async () => {
    const filtered = await readPromptHistory({ project: '/цього/точно/немає' })
    expect(filtered).toEqual([])
  })
})
