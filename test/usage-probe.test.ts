import { describe, it, expect } from 'vitest'
import { parseResetTime, parseUsageText } from '../src/main/metrics/usage-probe'

const SAMPLE = `You are currently using your subscription to power your Claude Code usage

Current session: 56% used · resets Aug 23 at 3:19pm (Europe/Kiev)
Current week (all models): 5% used · resets Aug 30 at 12:59am (Europe/Kiev)
Current week (Fable): 8% used · resets Aug 30 at 12:59am (Europe/Kiev)

What's contributing to your limits usage?
Approximate, based on local sessions on this machine — does not include other devices or claude.ai.

Last 24h · 629 requests · 3 sessions
  96% of your usage was at >150k context`

describe('parseUsageText', () => {
  const now = new Date(2026, 7, 23, 12, 0, 0)

  it('витягує сесійний і тижневий ліміти', () => {
    const snap = parseUsageText(SAMPLE, now)
    expect(snap.session?.percent).toBe(56)
    expect(snap.week?.percent).toBe(5)
    // Часовий пояс у дужках — це шум для UI.
    expect(snap.session?.resetsText).toBe('Aug 23 at 3:19pm')
  })

  it('окремі капи на моделі не плутає з загальним тижневим', () => {
    const snap = parseUsageText(SAMPLE, now)
    expect(snap.extra).toHaveLength(1)
    expect(snap.extra[0].label).toBe('Fable')
    expect(snap.extra[0].percent).toBe(8)
  })

  it('читає статистику за добу', () => {
    const snap = parseUsageText(SAMPLE, now)
    expect(snap.requests24h).toBe(629)
    expect(snap.sessions24h).toBe(3)
  })

  it('не падає на несподіваному тексті', () => {
    const snap = parseUsageText('щось геть інше', now)
    expect(snap.session).toBeUndefined()
    expect(snap.week).toBeUndefined()
    expect(snap.extra).toEqual([])
  })
})

describe('parseResetTime', () => {
  const now = new Date(2026, 7, 23, 12, 0, 0)

  it('розбирає час у той самий день', () => {
    const ts = parseResetTime('Aug 23 at 3:19pm', now)
    expect(new Date(ts!).getHours()).toBe(15)
    expect(new Date(ts!).getMinutes()).toBe(19)
  })

  it('правильно трактує полудень і північ', () => {
    expect(new Date(parseResetTime('Aug 23 at 12:00am', now)!).getHours()).toBe(0)
    expect(new Date(parseResetTime('Aug 23 at 12:30pm', now)!).getHours()).toBe(12)
  })

  it('переносить на наступний рік, якщо дата вже минула', () => {
    // Січень із позиції серпня — це наступний рік, а не той, що минув.
    const ts = parseResetTime('Jan 5 at 9:00am', now)
    expect(new Date(ts!).getFullYear()).toBe(2027)
  })

  it('повертає undefined на нерозбірливому тексті', () => {
    expect(parseResetTime('колись потім', now)).toBeUndefined()
  })
})
