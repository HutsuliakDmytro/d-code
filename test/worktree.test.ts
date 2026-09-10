import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  addWorktree,
  defaultWorktreePath,
  isValidBranchName,
  listWorktrees,
  parseWorktreeList,
  pruneWorktrees,
  removeWorktree
} from '../src/main/system/worktree'

const execFileAsync = promisify(execFile)
let root: string

async function git(args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', root, ...args])
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccui-wt-'))
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 'test@example.com'])
  await git(['config', 'user.name', 'Test'])
  await writeFile(join(root, 'a.txt'), 'перший рядок\n', 'utf8')
  await git(['add', '.'])
  await git(['commit', '-m', 'початок'])
})

afterEach(async () => {
  // Worktrees live beside the repository, so both get cleaned up.
  await rm(root, { recursive: true, force: true })
  await rm(`${root}-feature`, { recursive: true, force: true })
  await rm(`${root}-second`, { recursive: true, force: true })
})

describe('parseWorktreeList', () => {
  it('розбирає порцеляновий формат і скорочує ref гілки', () => {
    const trees = parseWorktreeList(
      ['worktree /repo', 'HEAD abc123', 'branch refs/heads/main', '', 'worktree /repo-x', 'HEAD def456', 'branch refs/heads/feature/x', ''].join('\n')
    )
    expect(trees).toHaveLength(2)
    expect(trees[0]).toMatchObject({ path: '/repo', branch: 'main', isMain: true })
    expect(trees[1]).toMatchObject({ path: '/repo-x', branch: 'feature/x', isMain: false })
  })

  it('відірваний HEAD лишається без гілки', () => {
    const trees = parseWorktreeList(['worktree /repo', 'HEAD abc123', 'detached', ''].join('\n'))
    expect(trees[0].branch).toBeUndefined()
    expect(trees[0].head).toBe('abc123')
  })

  it('позначає заблоковані й зниклі дерева', () => {
    const trees = parseWorktreeList(
      [
        'worktree /repo',
        'HEAD a',
        'branch refs/heads/main',
        '',
        'worktree /gone',
        'HEAD b',
        'branch refs/heads/old',
        'prunable gitdir file points to non-existent location',
        '',
        'worktree /held',
        'HEAD c',
        'locked бо треба',
        ''
      ].join('\n')
    )
    expect(trees[1].prunable).toBe(true)
    expect(trees[2].locked).toBe(true)
    expect(trees[2].lockReason).toBe('бо треба')
  })

  it('останній запис без порожнього рядка в кінці не губиться', () => {
    const trees = parseWorktreeList('worktree /repo\nHEAD abc\nbranch refs/heads/main')
    expect(trees).toHaveLength(1)
  })
})

describe('isValidBranchName', () => {
  it('приймає звичайні назви', () => {
    expect(isValidBranchName('feature/login')).toBe(true)
    expect(isValidBranchName('fix-123')).toBe(true)
  })

  it('відхиляє те, що git усе одно не візьме', () => {
    for (const bad of ['', 'has space', 'a..b', '-lead', 'tail/', 'x.lock', 'a~b', 'a^b', 'a:b']) {
      expect(isValidBranchName(bad), bad).toBe(false)
    }
  })
})

describe('defaultWorktreePath', () => {
  it('кладе дерево поруч із репозиторієм, а не всередині', () => {
    expect(defaultWorktreePath('/work/app', 'feature')).toBe('/work/app-feature')
  })

  it('скісні риски в назві гілки не створюють вкладених тек', () => {
    expect(defaultWorktreePath('/work/app', 'feature/login')).toBe('/work/app-feature-login')
  })
})

describe('worktree над справжнім репозиторієм', () => {
  it('додає, показує і видаляє дерево', async () => {
    const path = `${root}-feature`
    const added = await addWorktree(root, { path, branch: 'feature', createBranch: true })
    expect(added.ok).toBe(true)

    const trees = await listWorktrees(root)
    expect(trees).toHaveLength(2)
    expect(trees[0].isMain).toBe(true)
    expect(trees.map((t) => t.branch)).toContain('feature')

    const removed = await removeWorktree(root, path)
    expect(removed.ok).toBe(true)
    expect(await listWorktrees(root)).toHaveLength(1)
  })

  it('гілку, зайняту іншим деревом, вдруге не забрати', async () => {
    await addWorktree(root, { path: `${root}-feature`, branch: 'feature', createBranch: true })
    const second = await addWorktree(root, {
      path: `${root}-second`,
      branch: 'feature',
      createBranch: false
    })
    expect(second.ok).toBe(false)
    expect(second.error).toBeTruthy()
  })

  it('невалідну назву гілки відсіює ще до виклику git', async () => {
    const result = await addWorktree(root, {
      path: `${root}-second`,
      branch: 'has space',
      createBranch: true
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('has space')
  })

  it('дерево з незакомміченими змінами не видаляється без force', async () => {
    const path = `${root}-feature`
    await addWorktree(root, { path, branch: 'feature', createBranch: true })
    await writeFile(join(path, 'a.txt'), 'змінено\n', 'utf8')

    expect((await removeWorktree(root, path)).ok).toBe(false)
    expect((await removeWorktree(root, path, true)).ok).toBe(true)
  })

  it('prune не падає, коли прибирати нічого', async () => {
    expect((await pruneWorktrees(root)).ok).toBe(true)
  })

  it('не-репозиторій дає порожній список, а не помилку', async () => {
    const plain = await mkdtemp(join(tmpdir(), 'ccui-plain-'))
    try {
      expect(await listWorktrees(plain)).toEqual([])
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })
})
