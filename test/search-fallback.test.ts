import { it, expect } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchCode } from '../src/main/system/files'

it('шукає поза git-репозиторієм', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccui-search-'))
  try {
    await writeFile(join(root, 'a.ts'), 'const needle = 1\nconst other = 2\nNEEDLE again\n', 'utf8')
    await mkdir(join(root, 'sub'), { recursive: true })
    await writeFile(join(root, 'sub', 'b.js'), 'let x\n// needle here\n', 'utf8')
    // Ігнорований каталог не має потрапити у видачу.
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'node_modules', 'c.js'), 'needle\n', 'utf8')

    const hits = await searchCode(root, 'needle', { limit: 50 })
    console.log('\nзбігів:', hits.length)
    for (const h of hits) console.log(` ${h.relativePath}:${h.line} @${h.matchStart} ${h.text}`)

    expect(hits.length).toBe(3)
    expect(hits.some((h) => h.relativePath.includes('node_modules'))).toBe(false)
    expect(hits.every((h) => h.matchStart >= 0)).toBe(true)
    // Підсвітка не має брехати: за позицією справді стоїть шукане слово.
    for (const h of hits) {
      expect(h.text.slice(h.matchStart, h.matchStart + h.matchLength).toLowerCase()).toBe('needle')
    }

    const sensitive = await searchCode(root, 'NEEDLE', { caseSensitive: true, limit: 50 })
    expect(sensitive.length).toBe(1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
