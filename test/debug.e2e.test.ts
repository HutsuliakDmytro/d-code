import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DebugSession, type DebugState } from '../src/main/debug/session'

let session: DebugSession | undefined

afterEach(async () => {
  await session?.stop()
  session = undefined
})

/** Чекає на стан, який задовольняє умову, або падає за таймаутом. */
function waitFor(
  s: DebugSession,
  predicate: (state: DebugState) => boolean,
  timeoutMs = 20_000
): Promise<DebugState> {
  return new Promise((resolve, reject) => {
    if (predicate(s.getState())) return resolve(s.getState())
    const timer = setTimeout(() => reject(new Error('не дочекались стану')), timeoutMs)
    const onState = (state: DebugState): void => {
      if (!predicate(state)) return
      clearTimeout(timer)
      s.off('state', onState)
      resolve(state)
    }
    s.on('state', onState)
  })
}

describe('налагодження Node', () => {
  it('зупиняється на точці зупину й показує змінні', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccui-dbg-'))
    try {
      const program = join(root, 'script.js')
      await writeFile(
        program,
        [
          'const answer = 42',
          'const items = [1, 2, 3]',
          'function sum(list) {',
          '  let total = 0',
          '  for (const n of list) total += n',
          '  return total',
          '}',
          'const result = sum(items)',
          'console.log(answer, result)'
        ].join('\n'),
        'utf8'
      )

      session = new DebugSession()
      // Точку ставимо ще до запуску — вона має застосуватись при підключенні.
      session.toggleBreakpoint(program, 8)
      expect(session.listBreakpoints()).toHaveLength(1)

      await session.start({ root, program })
      const paused = await waitFor(session, (s) => s.paused)

      console.log('\nзупинка:', paused.reason, '| рамок:', paused.frames.length)
      expect(paused.frames.length).toBeGreaterThan(0)

      const top = paused.frames[0]
      expect(top.path).toBe(program)
      // Рядок 8 у нумерації редактора, а не рушія.
      expect(top.line).toBe(8)

      const scopes = await session.scopes(top.id)
      console.log('області:', scopes.map((s) => s.name).join(', '))
      expect(scopes.length).toBeGreaterThan(0)

      const local = scopes.find((s) => s.objectId)
      const variables = local?.objectId ? await session.variables(local.objectId) : []
      console.log('змінних:', variables.length)

      const value = await session.evaluate(top.id, 'answer')
      console.log('answer =', value)
      expect(value).toBe('42')

      const arrayValue = await session.evaluate(top.id, 'items.length')
      expect(arrayValue).toBe('3')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('крокує далі й доходить до завершення', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccui-dbg2-'))
    try {
      const program = join(root, 'step.js')
      await writeFile(program, ['let x = 1', 'x = x + 1', 'x = x * 3', 'console.log(x)'].join('\n'), 'utf8')

      session = new DebugSession()
      session.toggleBreakpoint(program, 2)
      await session.start({ root, program })

      const first = await waitFor(session, (s) => s.paused)
      expect(first.frames[0].line).toBe(2)

      await session.stepOver()
      const second = await waitFor(
        session,
        (s) => s.paused && s.frames[0]?.line === 3,
        15_000
      )
      expect(second.frames[0].line).toBe(3)

      await session.resume()
      const finished = await waitFor(session, (s) => !s.running, 20_000)
      console.log('вивід:', finished.output.trim().split('\n').at(-1))
      expect(finished.output).toContain('6')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('точки зупину перемикаються', () => {
    const s = new DebugSession()
    expect(s.toggleBreakpoint('/a.js', 5)).toHaveLength(1)
    expect(s.toggleBreakpoint('/a.js', 9)).toHaveLength(2)
    expect(s.toggleBreakpoint('/a.js', 5)).toHaveLength(1)
    expect(s.toggleBreakpoint('/a.js', 9)).toHaveLength(0)
  })
})
