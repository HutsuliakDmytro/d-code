import { describe, it, expect } from 'vitest'
import { parseEslintOutput, parseTscOutput } from '../src/main/system/diagnostics'
import { enclosingSymbol, symbolsFor } from '../src/main/system/symbols'

const ROOT = '/proj'

describe('parseTscOutput', () => {
  it('розбирає помилки з відносним шляхом', () => {
    const output = [
      "src/a.ts(12,5): error TS2304: Cannot find name 'foo'.",
      'src/b.tsx(3,10): error TS2322: Type mismatch.'
    ].join('\n')

    const result = parseTscOutput(output, ROOT)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      path: '/proj/src/a.ts',
      relativePath: 'src/a.ts',
      line: 12,
      column: 5,
      severity: 'error',
      code: 'TS2304',
      source: 'typescript'
    })
    expect(result[0].message).toContain('Cannot find name')
  })

  it('нормалізує абсолютний шлях', () => {
    const result = parseTscOutput('/proj/src/c.ts(1,1): error TS1005: x', ROOT)
    expect(result[0].relativePath).toBe('src/c.ts')
  })

  it('розрізняє warning і error', () => {
    const result = parseTscOutput('a.ts(1,1): warning TS6133: unused', ROOT)
    expect(result[0].severity).toBe('warning')
  })

  it('ігнорує сторонні рядки виводу', () => {
    const noise = 'Compiling...\nFound 0 errors.\nrandom text'
    expect(parseTscOutput(noise, ROOT)).toEqual([])
  })
})

describe('parseEslintOutput', () => {
  it('розбирає unix-формат', () => {
    const output = '/proj/src/a.ts:4:2: Missing semicolon [Error/semi]'
    const [first] = parseEslintOutput(output, ROOT)
    expect(first).toMatchObject({
      relativePath: 'src/a.ts',
      line: 4,
      column: 2,
      severity: 'error',
      code: 'semi',
      source: 'eslint'
    })
  })

  it('розрізняє попередження', () => {
    const output = '/proj/a.ts:1:1: Unused var [Warning/no-unused-vars]'
    expect(parseEslintOutput(output, ROOT)[0].severity).toBe('warning')
  })
})

describe('symbolsFor', () => {
  it('знаходить символи TypeScript', () => {
    const code = [
      'export interface User { id: string }',
      'export type Id = string',
      'export class Service {',
      '  async load(): Promise<void> {',
      '    return',
      '  }',
      '}',
      'export function helper() {}',
      'export const handler = async () => {}'
    ].join('\n')

    const names = symbolsFor('typescript', code).map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('interface:User')
    expect(names).toContain('type:Id')
    expect(names).toContain('class:Service')
    expect(names).toContain('function:helper')
    expect(names).toContain('const:handler')
    expect(names).toContain('method:load')
  })

  it('не плутає керівні конструкції з функціями', () => {
    const code = 'function real() {\n  if (x) {\n    for (;;) {\n    }\n  }\n}'
    const names = symbolsFor('typescript', code).map((s) => s.name)
    expect(names).toContain('real')
    expect(names).not.toContain('if')
    expect(names).not.toContain('for')
  })

  it('ігнорує коментарі', () => {
    const code = '// function fake() {}\n/* class Fake {} */\nfunction real() {}'
    const names = symbolsFor('typescript', code).map((s) => s.name)
    expect(names).toEqual(['real'])
  })

  it('знаходить символи Python і Dart', () => {
    const py = symbolsFor('python', 'class Model:\n    def train(self):\n        pass')
    expect(py.map((s) => s.name)).toEqual(['Model', 'train'])

    const dart = symbolsFor('dart', 'class HomePage extends StatelessWidget {\n}')
    expect(dart.map((s) => s.name)).toContain('HomePage')
  })

  it('невідома мова не дає символів', () => {
    expect(symbolsFor('brainfuck', '+++')).toEqual([])
  })
})

describe('enclosingSymbol', () => {
  const symbols = symbolsFor(
    'typescript',
    ['function first() {', '  return 1', '}', '', 'function second() {', '  return 2', '}'].join('\n')
  )

  it('знаходить символ, у якому лежить рядок', () => {
    expect(enclosingSymbol(symbols, 2)?.name).toBe('first')
    expect(enclosingSymbol(symbols, 6)?.name).toBe('second')
  })

  it('до першого символу нічого не повертає', () => {
    expect(enclosingSymbol(symbols, 0)).toBeUndefined()
  })
})
