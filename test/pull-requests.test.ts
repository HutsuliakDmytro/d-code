import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTranscript } from '../src/main/store/parser'
import { scanTranscript } from '../src/main/store/scanner'

/** Транскрипт із повторюваними рядками pr-link — саме так пише CLI. */
async function writeTranscript(dir: string, id: string): Promise<string> {
  const path = join(dir, `${id}.jsonl`)
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: '2026-09-01T10:00:00Z', sessionId: id,
      message: { role: 'user', content: 'зроби PR' }, cwd: '/proj' },
    { type: 'pr-link', sessionId: id, prNumber: 7, prUrl: 'https://github.com/a/b/pull/7',
      prRepository: 'a/b', timestamp: '2026-09-01T10:05:00Z' },
    { type: 'pr-link', sessionId: id, prNumber: 7, prUrl: 'https://github.com/a/b/pull/7',
      prRepository: 'a/b', timestamp: '2026-09-01T10:06:00Z' },
    { type: 'pr-link', sessionId: id, prNumber: 9, prUrl: 'https://github.com/a/b/pull/9',
      prRepository: 'a/b', timestamp: '2026-09-01T10:07:00Z' },
    // Побитий запис без номера не має ні падати, ні потрапляти у видачу.
    { type: 'pr-link', sessionId: id, prUrl: 'https://github.com/a/b/pull/x' }
  ]
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8')
  return path
}

describe('пул-реквести сесії', () => {
  it('парсер дедуплікує за номером і не падає на побитих записах', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccui-pr-'))
    try {
      const path = await writeTranscript(dir, 'sess-1')
      const parsed = await parseTranscript(path, { projectPath: '/proj', encodedDir: '-proj' })

      const prs = parsed.meta.pullRequests ?? []
      console.log('\nPR:', prs.map((p) => `#${p.number}`).join(', '))
      expect(prs).toHaveLength(2)
      expect(prs.map((p) => p.number).sort()).toEqual([7, 9])
      // Час має лишитись від ПЕРШОЇ згадки, а не від останньої.
      expect(prs.find((p) => p.number === 7)?.createdAt).toBe('2026-09-01T10:05:00Z')
      // Рядок pr-link не є повідомленням і не має потрапити в стрічку.
      expect(parsed.messages.every((m) => m.role !== 'system' || !m.text?.includes('pull'))).toBe(true)
      expect(parsed.unknownTypes.size).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('сканер бачить ті самі PR, що й парсер', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccui-pr2-'))
    try {
      const path = await writeTranscript(dir, 'sess-2')
      const { meta } = await scanTranscript(path, { projectPath: '/proj', encodedDir: '-proj' })
      // Швидкий прохід сканера й повний парсер не мають розходитись.
      expect(meta.pullRequests?.map((p) => p.number).sort()).toEqual([7, 9])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('сесія без PR не отримує порожнього списку', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccui-pr3-'))
    try {
      const path = join(dir, 'sess-3.jsonl')
      await writeFile(
        path,
        JSON.stringify({
          type: 'user', uuid: 'u1', timestamp: '2026-09-01T10:00:00Z', sessionId: 'sess-3',
          message: { role: 'user', content: 'привіт' }, cwd: '/proj'
        }) + '\n',
        'utf8'
      )
      const parsed = await parseTranscript(path, { projectPath: '/proj', encodedDir: '-proj' })
      // Саме undefined, а не []: інакше UI малював би порожній значок.
      expect(parsed.meta.pullRequests).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
