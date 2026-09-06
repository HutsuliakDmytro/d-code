import { describe, it, expect } from 'vitest'
import { collapseUnchanged, diffLines, diffStats } from '../src/renderer/src/lib/diff'

describe('diffLines', () => {
  it('однаковий текст не дає змін', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc')
    expect(rows.every((r) => r.kind === 'same')).toBe(true)
    expect(diffStats(rows)).toEqual({ added: 0, removed: 0 })
  })

  it('вставку показує як вставку, а не як зсув усього хвоста', () => {
    // Наївне порівняння «рядок i з рядком i» позначило б тут три зміни замість однієї.
    const rows = diffLines('a\nb\nc', 'a\nNEW\nb\nc')
    expect(diffStats(rows)).toEqual({ added: 1, removed: 0 })
    const added = rows.find((r) => r.kind === 'added')
    expect(added?.text).toBe('NEW')
  })

  it('видалення посеред файлу', () => {
    const rows = diffLines('a\nb\nc\nd', 'a\nc\nd')
    expect(diffStats(rows)).toEqual({ added: 0, removed: 1 })
    expect(rows.find((r) => r.kind === 'removed')?.text).toBe('b')
  })

  it('заміна рядка — це видалення плюс додавання', () => {
    const rows = diffLines('a\nb\nc', 'a\nX\nc')
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 })
  })

  it('нумерує рядки обох версій', () => {
    const rows = diffLines('a\nb', 'a\nNEW\nb')
    const same = rows.filter((r) => r.kind === 'same')
    expect(same[0].oldLine).toBe(1)
    expect(same[0].newLine).toBe(1)
    // «b» лишився тим самим рядком, але зсунувся у новій версії.
    expect(same[1].oldLine).toBe(2)
    expect(same[1].newLine).toBe(3)
  })

  it('порожній «до» — усе додано, порожній «після» — усе видалено', () => {
    expect(diffStats(diffLines('', 'a\nb'))).toEqual({ added: 2, removed: 0 })
    expect(diffStats(diffLines('a\nb', ''))).toEqual({ added: 0, removed: 2 })
  })

  it('не ламається на великих однакових файлах', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `рядок ${i}`).join('\n')
    const changed = big.replace('рядок 2500', 'ЗМІНЕНО')
    const rows = diffLines(big, changed)
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 })
  })
})

describe('collapseUnchanged', () => {
  const rows = diffLines(
    Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n'),
    Array.from({ length: 40 }, (_, i) => (i === 20 ? 'ЗМІНЕНО' : `l${i}`)).join('\n')
  )

  it('лишає лише контекст навколо змін', () => {
    const chunks = collapseUnchanged(rows, 3)
    const shown = chunks.reduce((n, c) => n + c.rows.length, 0)
    // Змінений рядок, видалений оригінал і по три рядки контексту з боків.
    expect(shown).toBeLessThan(12)
    expect(shown).toBeGreaterThan(4)
  })

  it('повідомляє, скільки рядків згорнуто перед блоком', () => {
    const [first] = collapseUnchanged(rows, 3)
    expect(first.skipped).toBeGreaterThan(10)
  })

  it('без змін не показує нічого', () => {
    const identical = diffLines('a\nb\nc', 'a\nb\nc')
    expect(collapseUnchanged(identical)).toEqual([])
  })

  it('сусідні зміни зливаються в один блок', () => {
    const near = diffLines('a\nb\nc\nd\ne', 'a\nX\nc\nY\ne')
    expect(collapseUnchanged(near, 3)).toHaveLength(1)
  })
})
