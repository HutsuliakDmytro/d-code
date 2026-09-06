import { describe, it, expect } from 'vitest'
import { searchTranscripts } from '../src/main/store/search'
import { collectActivity } from '../src/main/store/stats'
import { listChangedFiles } from '../src/main/store/file-history'
import { scanAllSessions } from '../src/main/store/scanner'
import { hasTranscripts } from './local-data'

describe('searchTranscripts', () => {
  it('знаходить збіги по вмісту, а не по заголовках', async () => {
    const hits = await searchTranscripts({ query: 'сесі', limit: 50 })
    console.log(`\nзбігів: ${hits.length}`)
    for (const h of hits.slice(0, 4)) {
      console.log(`  [${h.role}] ${h.title.slice(0, 30)} :: ${h.snippet.slice(0, 80)}`)
    }
    if (hits.length === 0) return

    for (const h of hits) {
      // Фрагмент має справді містити запит, інакше підсвітка бреше.
      expect(h.snippet.toLowerCase()).toContain('сесі')
      expect(h.sessionId).toMatch(/^[0-9a-f-]{36}$/)
      // Шлях проєкту має бути справжнім, а не закодованим ім'ям каталогу.
      expect(h.projectPath.startsWith('/')).toBe(true)
      if (h.matchStart >= 0) {
        const found = h.snippet.slice(h.matchStart, h.matchStart + h.matchLength)
        expect(found.toLowerCase()).toBe('сесі')
      }
    }
  })

  it('ігнорує надто короткі запити', async () => {
    expect(await searchTranscripts({ query: 'a' })).toEqual([])
    expect(await searchTranscripts({ query: '  ' })).toEqual([])
  })

  it('за потреби шукає всередині інструментів', async () => {
    const without = await searchTranscripts({ query: 'jsonl', includeTools: false, limit: 100 })
    const withTools = await searchTranscripts({ query: 'jsonl', includeTools: true, limit: 100 })
    console.log(`\nбез інструментів: ${without.length}, з інструментами: ${withTools.length}`)
    expect(withTools.length).toBeGreaterThanOrEqual(without.length)
  })
})

describe('collectActivity', () => {
  it.skipIf(!hasTranscripts)('рахує дні, інструменти та проєкти', async () => {
    const stats = await collectActivity(30)
    console.log(`\nднів з активністю: ${stats.days.length}`)
    console.log('  ' + stats.days.map((d) => `${d.date.slice(5)}:${d.requests}`).join(' '))
    console.log(`топ інструментів: ${stats.tools.slice(0, 6).map((t) => `${t.name}(${t.count})`).join(', ')}`)
    console.log(`проєктів: ${stats.projects.length}`)
    const ratio =
      (stats.cacheReadTokens / (stats.cacheReadTokens + stats.cacheCreationTokens)) * 100
    console.log(`кеш покриває: ${ratio.toFixed(1)}%`)

    expect(stats.days.length).toBeGreaterThan(0)
    expect(stats.tools.length).toBeGreaterThan(0)
    // Дати мають бути локальними ISO-датами без часу.
    for (const d of stats.days) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // Помилок не може бути більше, ніж викликів.
    for (const t of stats.tools) expect(t.errors).toBeLessThanOrEqual(t.count)
  })
})

describe('listChangedFiles', () => {
  it('збирає файли, яких торкнулася сесія', async () => {
    const sessions = await scanAllSessions()
    let checked = 0
    for (const s of sessions) {
      const files = await listChangedFiles(s.meta.filePath, s.meta.sessionId)
      if (files.length === 0) continue
      checked++
      console.log(`\n${s.meta.title.slice(0, 40)}: ${files.length} файлів`)
      for (const f of files.slice(0, 4)) {
        console.log(
          `  ${f.createdBySession ? '+' : '~'} ${f.displayPath} ` +
            `(v${f.versions.at(-1)?.version}, ${f.exists ? 'є' : 'немає'})`
        )
      }
      for (const f of files) {
        // Шлях має бути абсолютним — trackingPath буває відносним.
        expect(f.path.startsWith('/')).toBe(true)
        expect(f.versions.length).toBeGreaterThan(0)
        // Версії відсортовані за зростанням.
        const nums = f.versions.map((v) => v.version)
        expect([...nums].sort((a, b) => a - b)).toEqual(nums)
      }
    }
    console.log(`\nсесій зі змінами: ${checked}`)
  })
})
