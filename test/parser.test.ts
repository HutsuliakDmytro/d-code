import { describe, it, expect } from 'vitest'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseTranscript } from '../src/main/store/parser'
import { PROJECTS_DIR, buildDirToPathMap } from '../src/main/store/project-paths'

async function findTranscripts(): Promise<Array<{ file: string; dir: string; path: string }>> {
  const out: Array<{ file: string; dir: string; path: string }> = []
  const map = await buildDirToPathMap()
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const entries = await readdir(join(PROJECTS_DIR, d.name)).catch(() => [])
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue
      out.push({
        file: join(PROJECTS_DIR, d.name, f),
        dir: d.name,
        path: map.get(d.name) ?? '(unknown)'
      })
    }
  }
  return out
}

describe('parseTranscript проти реальних транскриптів', () => {
  it('парсить кожен наявний транскрипт без винятків', async () => {
    const files = await findTranscripts()
    if (files.length === 0) {
      console.warn('Транскриптів не знайдено — перевірку пропущено')
      return
    }

    const allUnknown = new Map<string, number>()
    const report: string[] = []

    for (const f of files) {
      const parsed = await parseTranscript(f.file, { projectPath: f.path, encodedDir: f.dir })
      for (const [t, n] of parsed.unknownTypes) {
        allUnknown.set(t, (allUnknown.get(t) ?? 0) + n)
      }
      report.push(
        `${parsed.meta.sessionId.slice(0, 8)} ${String(parsed.meta.messageCount).padStart(4)} msg ` +
          `[${parsed.meta.titleSource}] ${parsed.meta.title.slice(0, 50)}`
      )
      expect(parsed.meta.sessionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(parsed.meta.title.length).toBeGreaterThan(0)
    }

    console.log(`\nРозібрано транскриптів: ${files.length}`)
    console.log(report.join('\n'))
    console.log('\nНевідомі типи рядків:', allUnknown.size ? [...allUnknown] : 'немає')

    // Невідомий тип не є помилкою, але має бути видимим — формат CLI змінюється.
    expect(allUnknown.size).toBe(0)
  })

  it('не дублює usage для багатоблокових відповідей', async () => {
    const files = await findTranscripts()
    const longest = files.at(-1)
    if (!longest) return

    for (const f of files) {
      const parsed = await parseTranscript(f.file, { projectPath: f.path, encodedDir: f.dir })
      const withUsage = parsed.messages.filter((m) => m.usage)
      const requestIds = withUsage.map((m) => m.requestId).filter(Boolean)
      // Кожен requestId має зустрітися рівно раз серед повідомлень з usage.
      expect(new Set(requestIds).size).toBe(requestIds.length)
    }
  })

  it('привʼязує результати інструментів до викликів', async () => {
    const files = await findTranscripts()
    let totalCalls = 0
    let resolved = 0
    for (const f of files) {
      const parsed = await parseTranscript(f.file, { projectPath: f.path, encodedDir: f.dir })
      for (const m of parsed.messages) {
        for (const c of m.toolCalls) {
          totalCalls++
          if (c.result) resolved++
        }
      }
    }
    if (totalCalls === 0) return
    console.log(`\nВиклики інструментів: ${resolved}/${totalCalls} з результатом`)
    // Без результату лишається тільки останній виклик у незавершеній сесії.
    expect(resolved / totalCalls).toBeGreaterThan(0.8)
  })
})
