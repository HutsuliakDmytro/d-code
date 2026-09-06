import { describe, it, expect } from 'vitest'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { listCheckpoints } from '../src/main/store/checkpoints'
import { compareSessions } from '../src/main/store/session-compare'
import { PROJECTS_DIR, buildDirToPathMap } from '../src/main/store/project-paths'

async function transcripts(): Promise<Array<{ file: string; dir: string; path: string }>> {
  const out: Array<{ file: string; dir: string; path: string }> = []
  const map = await buildDirToPathMap()
  for (const d of await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue
    for (const f of await readdir(join(PROJECTS_DIR, d.name)).catch(() => [])) {
      if (!f.endsWith('.jsonl')) continue
      out.push({ file: join(PROJECTS_DIR, d.name, f), dir: d.name, path: map.get(d.name) ?? '' })
    }
  }
  return out
}

describe('listCheckpoints', () => {
  it('знаходить точки відкату й підписує їх реплікою', async () => {
    const files = await transcripts()
    let withCheckpoints = 0

    for (const f of files) {
      const points = await listCheckpoints(f.file)
      if (points.length === 0) continue
      withCheckpoints++

      console.log(`\n${f.file.split('/').at(-1)?.slice(0, 8)}: ${points.length} точок`)
      for (const p of points.slice(0, 3)) {
        console.log(`  ${p.files.length} файл(ів) — ${p.label?.slice(0, 50) ?? 'без підпису'}`)
      }

      for (const p of points) {
        expect(p.messageId).toBeTruthy()
        expect(p.files.length).toBeGreaterThan(0)
        // Шлях має бути абсолютним: trackingPath буває відносним.
        for (const file of p.files) expect(file.path.startsWith('/')).toBe(true)
      }

      // Найсвіжіші точки мають бути зверху.
      const times = points.map((p) => Date.parse(p.timestamp)).filter(Number.isFinite)
      for (let i = 1; i < times.length; i++) expect(times[i - 1]).toBeGreaterThanOrEqual(times[i])
    }

    console.log(`\nсесій із точками відкату: ${withCheckpoints}`)
  })
})

describe('compareSessions', () => {
  it('порівняння сесії з собою дає повний збіг', async () => {
    const [first] = await transcripts()
    if (!first) return

    const target = { filePath: first.file, projectPath: first.path, encodedDir: first.dir }
    const result = await compareSessions(target, target)

    console.log(`\nспільних повідомлень: ${result.commonLength}`)
    expect(result.left).toEqual([])
    expect(result.right).toEqual([])
    expect(result.isPrefix).toBe(true)
    expect(result.commonLength).toBeGreaterThan(0)
  })

  it('різні сесії розходяться з самого початку', async () => {
    const files = await transcripts()
    if (files.length < 2) return

    // Беремо дві найбільші — у них точно є що порівнювати.
    const [a, b] = files.slice(0, 2)
    const result = await compareSessions(
      { filePath: a.file, projectPath: a.path, encodedDir: a.dir },
      { filePath: b.file, projectPath: b.path, encodedDir: b.dir }
    )

    console.log(
      `спільних: ${result.commonLength}, розбіжність: ${result.left.length} ↔ ${result.right.length}`
    )
    // Незалежні сесії не мають спільного початку.
    expect(result.commonLength).toBe(0)
    expect(result.divergedAt).toBeUndefined()
  })
})
