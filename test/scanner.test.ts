import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { scanAllSessions, scanTranscript, emptyTotals, mergeTotals } from '../src/main/store/scanner'
import { CLAUDE_CONFIG } from '../src/main/store/project-paths'
import { hasClaudeConfig, hasTranscripts } from './local-data'

interface ProjectStats {
  lastSessionId?: string
  lastCost?: number
  lastTotalInputTokens?: number
  lastTotalOutputTokens?: number
  lastTotalCacheCreationInputTokens?: number
  lastTotalCacheReadInputTokens?: number
  lastModelUsage?: Record<string, Record<string, number>>
}

const fmt = (n: number): string => n.toLocaleString('en-US')

describe('scanAllSessions', () => {
  it('індексує сесії й рахує токени', async () => {
    const entries = await scanAllSessions()
    if (!entries.length) return

    console.log(`\nСесій у індексі: ${entries.length}`)
    for (const e of entries) {
      const sub = e.subagents.length ? ` +${e.subagents.length} субагент(ів)` : ''
      console.log(
        `  ${e.meta.sessionId.slice(0, 8)} [${e.meta.titleSource.padEnd(11)}] ` +
          `in=${fmt(e.usage.inputTokens).padStart(8)} out=${fmt(e.usage.outputTokens).padStart(8)} ` +
          `cw=${fmt(e.usage.cacheCreationTokens).padStart(9)} cr=${fmt(e.usage.cacheReadTokens).padStart(11)} ` +
          `req=${String(e.usage.requests).padStart(4)}${sub}  ${e.meta.title.slice(0, 40)}`
      )
    }

    for (const e of entries) {
      expect(e.usage.requests).toBeGreaterThanOrEqual(0)
      expect(e.meta.projectPath).toBeTruthy()
    }
  })

  /**
   * Незалежна перевірка дедуплікації: та сама сума, порахована іншим кодом —
   * прямим читанням файлу з групуванням по requestId.
   */
  it('збігається з незалежним підрахунком по requestId', async () => {
    const entries = await scanAllSessions()
    if (!entries.length) return

    for (const e of entries) {
      const raw = await readFile(e.meta.filePath, 'utf8')
      const byRequest = new Map<string, Record<string, number>>()
      let assistantLines = 0
      let naiveOutput = 0

      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        let obj: Record<string, unknown>
        try {
          obj = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
        if (obj.type !== 'assistant') continue
        const msg = obj.message as Record<string, unknown> | undefined
        if (!msg || msg.model === '<synthetic>') continue
        assistantLines++
        const usage = (msg.usage ?? {}) as Record<string, number>
        naiveOutput += usage.output_tokens ?? 0
        const key = (obj.requestId as string) ?? (msg.id as string)
        if (key && !byRequest.has(key)) byRequest.set(key, usage)
      }

      const expected = [...byRequest.values()].reduce(
        (acc, u) => {
          acc.input += u.input_tokens ?? 0
          acc.output += u.output_tokens ?? 0
          acc.cacheCreate += u.cache_creation_input_tokens ?? 0
          acc.cacheRead += u.cache_read_input_tokens ?? 0
          return acc
        },
        { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }
      )

      const main = await scanTranscript(e.meta.filePath, {
        projectPath: e.meta.projectPath,
        encodedDir: e.meta.encodedDir
      })

      expect(main.usage.requests).toBe(byRequest.size)
      expect(main.usage.inputTokens).toBe(expected.input)
      expect(main.usage.outputTokens).toBe(expected.output)
      expect(main.usage.cacheCreationTokens).toBe(expected.cacheCreate)
      expect(main.usage.cacheReadTokens).toBe(expected.cacheRead)

      // Доказ, що дедуплікація не безплатна: сирих рядків помітно більше за запити.
      if (assistantLines > byRequest.size) {
        const inflation = naiveOutput / (expected.output || 1)
        console.log(
          `  ${e.meta.sessionId.slice(0, 8)}: ${assistantLines} рядків → ${byRequest.size} запитів, ` +
            `без дедуплікації output був би ×${inflation.toFixed(2)}`
        )
      }
    }
  })

  /**
   * Інформативна звірка з ~/.claude.json. НЕ є assert: `lastTotal*` — це метрики
   * ОСТАННЬОГО процесу CLI, а не всієї сесії. Сесію, відновлену через --resume,
   * CLI перезаписує підсумками останнього сегмента, тому наші цифри законно більші.
   * Додатково CLI враховує службові виклики haiku, яких у транскрипті немає.
   */
  it.skipIf(!hasClaudeConfig)('звіряється з ~/.claude.json (довідково)', async () => {
    const config = JSON.parse(await readFile(CLAUDE_CONFIG, 'utf8')) as {
      projects?: Record<string, ProjectStats>
    }
    const entries = await scanAllSessions()
    const byId = new Map(entries.map((e) => [e.meta.sessionId, e]))

    for (const [projectPath, stats] of Object.entries(config.projects ?? {})) {
      if (!stats.lastSessionId || stats.lastTotalOutputTokens === undefined) continue
      const entry = byId.get(stats.lastSessionId)
      if (!entry) continue

      const live = Boolean(entry.meta.live)
      console.log(
        `\n${projectPath}\n  сесія ${stats.lastSessionId.slice(0, 8)}${live ? ' (активна)' : ''}: ` +
          `вся сесія out=${fmt(entry.usage.outputTokens)} (з субагентами), ` +
          `останній процес за CLI out=${fmt(stats.lastTotalOutputTokens)}` +
          (stats.lastCost !== undefined ? `, lastCost=$${stats.lastCost.toFixed(4)}` : '')
      )

      // Активну сесію звіряти не можна: CLI дописує ~/.claude.json просто зараз,
      // тож будь-яке порівняння читає два різні моменти часу.
      if (live) continue

      // Підсумок усієї сесії не може бути меншим за підсумок одного її сегмента.
      // Порівнюємо повний підсумок: CLI рахує і субагентів, і службові виклики haiku.
      expect(entry.usage.outputTokens).toBeGreaterThanOrEqual(stats.lastTotalOutputTokens * 0.9)
    }
  })

  it('mergeTotals складає без втрат', () => {
    const a = emptyTotals()
    const b = emptyTotals()
    b.inputTokens = 10
    b.outputTokens = 5
    b.requests = 1
    b.byModel['m'] = {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      requests: 1
    }
    mergeTotals(a, b)
    mergeTotals(a, b)
    expect(a.inputTokens).toBe(20)
    expect(a.byModel['m'].requests).toBe(2)
  })
})
