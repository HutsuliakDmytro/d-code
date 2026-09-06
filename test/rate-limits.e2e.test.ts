import { describe, it, expect } from 'vitest'
import { RateLimitTracker } from '../src/main/metrics/rate-limits'
import { probeUsage } from '../src/main/metrics/usage-probe'

const enabled = process.env.CLAUDE_UI_E2E === '1'

describe.runIf(enabled)('ліміти з живого CLI', () => {
  it('probeUsage повертає свіжі відсотки', async () => {
    const result = await probeUsage()
    console.log('\nзнімок:', JSON.stringify(result, null, 2).slice(0, 500))

    expect('error' in result).toBe(false)
    if ('error' in result) return

    // Сесійний ліміт має бути завжди — це базовий кап підписки.
    expect(result.session).toBeDefined()
    expect(result.session!.percent).toBeGreaterThanOrEqual(0)
    expect(result.session!.percent).toBeLessThanOrEqual(100)
    expect(result.week).toBeDefined()
    expect(result.fetchedAt).toBeGreaterThan(Date.now() - 60_000)
  }, 60_000)

  it('трекер віддає знімок і оновлює його на вимогу', async () => {
    const tracker = new RateLimitTracker()
    await tracker.start()

    const first = await tracker.refresh()
    console.log(
      'session:', first.snapshot?.session?.percent + '%',
      '| week:', first.snapshot?.week?.percent + '%',
      '| extra:', first.snapshot?.extra.map((e) => `${e.label} ${e.percent}%`).join(', ') || '—'
    )
    console.log('resets:', first.snapshot?.session?.resetsText, '/', first.snapshot?.week?.resetsText)

    expect(first.snapshot).toBeDefined()
    expect(first.refreshing).toBe(false)

    // Файл історії лишається запасним джерелом і має читатися теж.
    console.log('семплів з файлу:', first.samples.length)

    const second = await tracker.refresh()
    expect(second.snapshot!.fetchedAt).toBeGreaterThanOrEqual(first.snapshot!.fetchedAt)

    tracker.stop()
  }, 90_000)
})
