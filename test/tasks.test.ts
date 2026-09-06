import { describe, it, expect } from 'vitest'
import { listScripts, parseSummary, TaskRunner } from '../src/main/system/tasks'

describe('listScripts', () => {
  it('читає скрипти проєкту й сортує за типом', async () => {
    const scripts = await listScripts(process.cwd())
    console.log('\nскрипти:', scripts.map((s) => `${s.name}[${s.kind}]`).join(', '))
    expect(scripts.length).toBeGreaterThan(0)
    expect(scripts.find((s) => s.name === 'test')?.kind).toBe('test')
    expect(scripts.find((s) => s.name === 'build')?.kind).toBe('build')
    expect(scripts.find((s) => s.name === 'dev')?.kind).toBe('dev')
    expect(scripts.find((s) => s.name === 'typecheck')?.kind).toBe('lint')
    // Тести — найпотрібніше, тож ідуть першими.
    expect(scripts[0].kind).toBe('test')
  })

  it('на каталозі без package.json повертає порожньо', async () => {
    expect(await listScripts('/tmp')).toEqual([])
  })
})

describe('parseSummary', () => {
  it('розбирає підсумок vitest', () => {
    expect(parseSummary('Tests  81 passed | 9 skipped (90)')).toEqual({
      passed: 81,
      skipped: 9
    })
  })

  it('бачить провалені тести', () => {
    expect(parseSummary('Tests  2 failed | 79 passed (81)')).toEqual({ passed: 79, failed: 2 })
  })

  it('рахує помилки TypeScript', () => {
    expect(parseSummary('Found 3 errors in 2 files.')).toEqual({ problems: 3 })
    expect(parseSummary('src/a.ts(1,1): error TS2304: x\nsrc/b.ts(2,2): error TS2322: y')).toEqual({
      problems: 2
    })
  })

  it('не вигадує підсумку на сторонньому виводі', () => {
    expect(parseSummary('просто якийсь текст')).toBeUndefined()
  })
})

describe('TaskRunner', () => {
  it('запускає скрипт і повідомляє про завершення', async () => {
    const runner = new TaskRunner()
    const chunks: string[] = []
    runner.on('chunk', (c: { text: string }) => chunks.push(c.text))

    const done = new Promise<{ exitCode?: number | null }>((resolve) => {
      runner.on('state', (state: { running: boolean; exitCode?: number | null }) => {
        if (!state.running) resolve(state)
      })
    })

    // `typecheck` швидкий і не має побічних ефектів.
    const state = await runner.start(process.cwd(), 'typecheck')
    expect(state.running).toBe(true)

    const finished = await done
    console.log('\nкод виходу:', finished.exitCode, '| шматків виводу:', chunks.length)
    expect(finished.exitCode).toBe(0)
    expect(chunks.length).toBeGreaterThan(0)
    expect(runner.getOutput(state.id)).toContain('typecheck')

    // Завершену задачу можна прибрати, активну — ні.
    runner.forget(state.id)
    expect(runner.list()).toHaveLength(0)
  }, 120_000)

  it('зупиняє процес на вимогу', async () => {
    const runner = new TaskRunner()
    const done = new Promise<{ running: boolean }>((resolve) => {
      runner.on('state', (state: { running: boolean }) => {
        if (!state.running) resolve(state)
      })
    })

    const state = await runner.start(process.cwd(), 'dev')
    setTimeout(() => runner.stop(state.id), 2000)

    const finished = await done
    expect(finished.running).toBe(false)
    runner.stopAll()
  }, 60_000)
})
