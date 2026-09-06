import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DiagnosticsRunner } from '../src/main/system/diagnostics'

describe('DiagnosticsRunner на справжньому tsc', () => {
  it('знаходить помилку типів і повідомляє позицію', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccui-diag-'))
    try {
      // Мінімальний проєкт із власним tsc: беремо той, що вже стоїть у нас.
      await mkdir(join(root, 'node_modules/.bin'), { recursive: true })
      await symlink(join(process.cwd(), 'node_modules/.bin/tsc'), join(root, 'node_modules/.bin/tsc'))
      await writeFile(
        join(root, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ['*.ts'] }),
        'utf8'
      )
      await writeFile(join(root, 'broken.ts'), 'const x: number = "рядок"\n', 'utf8')

      const runner = new DiagnosticsRunner()
      const state = await runner.run(root, 'typescript')

      console.log('\nдіагностика:', JSON.stringify(state.diagnostics[0]))
      expect(state.running).toBe(false)
      expect(state.diagnostics.length).toBeGreaterThan(0)

      const first = state.diagnostics[0]
      expect(first.relativePath).toBe('broken.ts')
      expect(first.line).toBe(1)
      expect(first.severity).toBe('error')
      expect(first.code).toMatch(/^TS\d+$/)
      // Шлях має бути абсолютним — за ним UI відкриває файл.
      expect(first.path.startsWith('/')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 90_000)

  it('на проєкті без TypeScript повідомляє про це, а не падає', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccui-diag-empty-'))
    try {
      const runner = new DiagnosticsRunner()
      const state = await runner.run(root, 'typescript')
      expect(state.error).toMatch(/no TypeScript/)
      expect(state.diagnostics).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
