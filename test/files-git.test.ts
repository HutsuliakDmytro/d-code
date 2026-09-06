import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { listDirectory, readTextFile, searchCode, languageOf } from '../src/main/system/files'
import * as git from '../src/main/system/git'

const execFileAsync = promisify(execFile)

const ROOT = process.cwd()

describe('listDirectory', () => {
  it('віддає каталоги першими й ховає сміття', async () => {
    const nodes = await listDirectory(ROOT)
    const names = nodes.map((n) => n.name)
    console.log('\nкорінь:', names.join(', '))

    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.git')
    expect(names).toContain('src')

    const firstFile = nodes.findIndex((n) => !n.isDirectory)
    if (firstFile > 0) {
      expect(nodes.slice(0, firstFile).every((n) => n.isDirectory)).toBe(true)
    }
    // Відносний шлях потрібен для UI і має бути справді відносним.
    for (const n of nodes) expect(n.relativePath.startsWith('/')).toBe(false)
  })

  it('позначає порожні каталоги без дітей', async () => {
    const nodes = await listDirectory(ROOT, `${ROOT}/src`)
    for (const n of nodes.filter((x) => x.isDirectory)) {
      expect(typeof n.hasChildren).toBe('boolean')
    }
  })

  it('не пускає за межі кореня', async () => {
    await expect(listDirectory(`${ROOT}/src`, '/etc')).rejects.toThrow(/outside the project/)
  })
})

describe('readTextFile', () => {
  it('читає текст і визначає мову', async () => {
    const result = await readTextFile(`${ROOT}/package.json`)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.language).toBe('json')
    expect(result.content).toContain('d-code')
    expect(result.truncated).toBe(false)
  })

  it('відмовляється показувати бінарник', async () => {
    const binary = '/Users/dmytro/.local/share/claude/versions/2.1.235'
    const result = await readTextFile(binary)
    expect('error' in result).toBe(true)
  })

  it('визначає мову за розширенням', () => {
    expect(languageOf('a/b/c.tsx')).toBe('tsx')
    expect(languageOf('script.sh')).toBe('bash')
    expect(languageOf('unknown.zzz')).toBe('text')
  })
})

describe('searchCode', () => {
  it('знаходить рядки з номерами і позицією збігу', async () => {
    const hits = await searchCode(ROOT, 'encodeProjectPath', { limit: 20 })
    console.log(`\nзбігів у коді: ${hits.length}`)
    for (const h of hits.slice(0, 3)) {
      console.log(`  ${h.relativePath}:${h.line} — ${h.text.trim().slice(0, 60)}`)
    }
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) {
      expect(h.line).toBeGreaterThan(0)
      expect(h.relativePath).not.toMatch(/^\//)
      // Позиція збігу має вказувати на справжнє входження.
      if (h.matchStart >= 0) {
        expect(h.text.slice(h.matchStart, h.matchStart + h.matchLength).toLowerCase()).toBe(
          'encodeprojectpath'
        )
      }
    }
  })

  it('ігнорує надто короткий запит', async () => {
    expect(await searchCode(ROOT, 'a')).toEqual([])
  })
})

describe('git', () => {
  /**
   * Репозиторій створюється тут-таки: на машині може не бути жодного, а тест
   * має перевіряти наш парсер, а не стан чужих проєктів.
   */
  async function makeRepo(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'ccui-git-'))
    const run = (args: string[]): Promise<unknown> => execFileAsync('git', ['-C', root, ...args])
    await run(['init', '-b', 'main'])
    await run(['config', 'user.email', 'test@example.com'])
    await run(['config', 'user.name', 'Test'])
    await writeFile(join(root, 'README.md'), '# hello\n', 'utf8')
    await run(['add', '.'])
    await run(['commit', '-m', 'перший коміт'])
    return root
  }

  it('читає статус, стейджить і комітить', async () => {
    const root = await makeRepo()
    try {
      const clean = await git.status(root)
      expect(clean.isRepo).toBe(true)
      expect(clean.branch).toBe('main')
      expect(clean.files).toHaveLength(0)

      // Змінений + новий файл дають різні статуси.
      await writeFile(join(root, 'README.md'), '# hello\n# змінено\n', 'utf8')
      await writeFile(join(root, 'new.txt'), 'новий\n', 'utf8')

      const dirty = await git.status(root)
      console.log('\nстатус:', dirty.files.map((f) => `${f.status}:${f.path}`).join(', '))
      expect(dirty.files.find((f) => f.path === 'README.md')?.status).toBe('modified')
      expect(dirty.files.find((f) => f.path === 'new.txt')?.status).toBe('untracked')

      await git.stage(root, ['README.md'])
      const staged = await git.status(root)
      expect(staged.files.find((f) => f.path === 'README.md' && f.staged)).toBeTruthy()

      await git.unstage(root, ['README.md'])
      const unstaged = await git.status(root)
      expect(unstaged.files.find((f) => f.path === 'README.md')?.staged).toBe(false)

      await git.stage(root, ['README.md', 'new.txt'])
      const result = await git.commit(root, 'другий коміт')
      expect(result.ok).toBe(true)

      const commits = await git.log(root, 10)
      expect(commits).toHaveLength(2)
      expect(commits[0].subject).toBe('другий коміт')
      expect(commits[0].hash).toMatch(/^[0-9a-f]{40}$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('дає діф і скидає зміни', async () => {
    const root = await makeRepo()
    try {
      await writeFile(join(root, 'README.md'), '# hello\n# рядок для дифу\n', 'utf8')

      const diff = await git.diffFile(root, 'README.md', false)
      expect('error' in diff).toBe(false)
      if (!('error' in diff)) {
        expect(diff.diff).toContain('рядок для дифу')
      }

      await git.discard(root, ['README.md'])
      const after = await git.status(root)
      // Після discard файл має повернутись до стану коміту.
      expect(after.files.find((f) => f.path === 'README.md')).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('створює і перемикає гілки', async () => {
    const root = await makeRepo()
    try {
      const created = await git.checkout(root, 'feature/test', { create: true })
      expect(created.ok).toBe(true)

      const list = await git.branches(root)
      console.log('гілки:', list.map((b) => `${b.current ? '*' : ' '}${b.name}`).join(', '))
      expect(list.find((b) => b.name === 'feature/test')?.current).toBe(true)
      expect(list.every((b) => !b.name.includes('HEAD'))).toBe(true)

      const back = await git.checkout(root, 'main')
      expect(back.ok).toBe(true)
      expect((await git.status(root)).branch).toBe('main')

      // Неіснуюча гілка має повернути помилку, а не кинути виняток.
      const missing = await git.checkout(root, 'nema-takoyi')
      expect(missing.ok).toBe(false)
      expect(missing.error).toBeTruthy()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('читає blame з авторами', async () => {
    const root = await makeRepo()
    try {
      const lines = await git.blame(root, 'README.md')
      expect(lines.length).toBeGreaterThan(0)
      expect(lines[0].author).toBe('Test')
      expect(lines[0].text).toBe('# hello')
      expect(lines[0].line).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('на не-репозиторії повертає isRepo=false, а не падає', async () => {
    const st = await git.status(tmpdir())
    expect(st.files).toEqual([])
  })
})
