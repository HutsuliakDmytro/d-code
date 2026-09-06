import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  diffBranches,
  listStash,
  parseConflicts,
  resolveConflict,
  stashApply,
  stashSave
} from '../src/main/system/git-remote'

const execFileAsync = promisify(execFile)
let root: string

async function git(args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args])
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccui-remote-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 'test@example.com'])
  await git(['config', 'user.name', 'Test'])
  await writeFile(join(root, 'a.txt'), 'перший рядок\n', 'utf8')
  await git(['add', '.'])
  await git(['commit', '-m', 'початок'])
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('parseConflicts', () => {
  const conflicted = [
    'спільний початок',
    '<<<<<<< HEAD',
    'наша версія',
    '=======',
    'їхня версія',
    '>>>>>>> feature',
    'спільний кінець'
  ].join('\n')

  it('знаходить блок і його сторони', () => {
    const [block] = parseConflicts(conflicted)
    expect(block.ours).toBe('наша версія')
    expect(block.theirs).toBe('їхня версія')
    expect(block.oursLabel).toBe('HEAD')
    expect(block.theirsLabel).toBe('feature')
  })

  it('на файлі без конфліктів нічого не повертає', () => {
    expect(parseConflicts('звичайний текст\nдругий рядок')).toEqual([])
  })

  it('знаходить кілька блоків', () => {
    const two = `${conflicted}\n${conflicted}`
    expect(parseConflicts(two)).toHaveLength(2)
  })

  it('незакритий маркер не створює блоку', () => {
    // Обірваний конфлікт краще лишити як є, ніж вгадувати межі.
    expect(parseConflicts('<<<<<<< HEAD\nнаше\n=======\nїхнє')).toEqual([])
  })
})

describe('resolveConflict', () => {
  const conflicted = [
    'до',
    '<<<<<<< HEAD',
    'наше',
    '=======',
    'їхнє',
    '>>>>>>> feature',
    'після'
  ].join('\n')

  it('бере наше', () => {
    expect(resolveConflict(conflicted, 0, 'ours')).toBe('до\nнаше\nпісля')
  })

  it('бере їхнє', () => {
    expect(resolveConflict(conflicted, 0, 'theirs')).toBe('до\nїхнє\nпісля')
  })

  it('бере обидва по порядку', () => {
    expect(resolveConflict(conflicted, 0, 'both')).toBe('до\nнаше\nїхнє\nпісля')
  })

  it('маркери зникають повністю', () => {
    const result = resolveConflict(conflicted, 0, 'ours')
    expect(result).not.toContain('<<<<')
    expect(result).not.toContain('====')
    expect(result).not.toContain('>>>>')
  })

  it('неіснуючий блок лишає текст незмінним', () => {
    expect(resolveConflict(conflicted, 9, 'ours')).toBe(conflicted)
  })
})

describe('stash', () => {
  it('зберігає, показує і повертає зміни', async () => {
    await writeFile(join(root, 'a.txt'), 'змінений рядок\n', 'utf8')

    const saved = await stashSave(root, 'моя правка')
    expect(saved.ok).toBe(true)

    const list = await listStash(root)
    expect(list).toHaveLength(1)
    expect(list[0].label).toContain('моя правка')

    // Після stash робоче дерево має бути чистим.
    const { stdout } = await execFileAsync('git', ['-C', root, 'status', '--porcelain'])
    expect(stdout.trim()).toBe('')

    const applied = await stashApply(root, 0, true)
    expect(applied.ok).toBe(true)
    expect(await listStash(root)).toHaveLength(0)
  })
})

describe('diffBranches', () => {
  it('показує, чим гілка відрізняється від точки розходження', async () => {
    await git(['checkout', '-b', 'feature'])
    await writeFile(join(root, 'b.txt'), 'новий файл\n', 'utf8')
    await writeFile(join(root, 'a.txt'), 'перший рядок\nдодано\n', 'utf8')
    await git(['add', '.'])
    await git(['commit', '-m', 'зміни у гілці'])

    const files = await diffBranches(root, 'main', 'feature')
    const byPath = new Map(files.map((f) => [f.path, f]))

    expect(byPath.get('b.txt')?.status).toBe('added')
    expect(byPath.get('a.txt')?.status).toBe('modified')
    expect(byPath.get('a.txt')?.added).toBe(1)
  })

  it('однакові гілки не дають різниці', async () => {
    await git(['checkout', '-b', 'same'])
    expect(await diffBranches(root, 'main', 'same')).toEqual([])
  })
})
