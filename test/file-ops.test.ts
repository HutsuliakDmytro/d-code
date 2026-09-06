import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Кошик — системний виклик Electron; у тестах підміняємо його видаленням.
const trashed: string[] = []
vi.mock('electron', () => ({
  shell: {
    trashItem: async (path: string): Promise<void> => {
      trashed.push(path)
      await rm(path, { recursive: true, force: true })
    }
  }
}))

const {
  createDirectory,
  createFile,
  movePath,
  movePathToTrash,
  renamePath
} = await import('../src/main/system/file-ops')
const { applyReplace, previewReplace } = await import('../src/main/system/replace')

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccui-fs-'))
  trashed.length = 0
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('операції з файлами', () => {
  it('створює файл і каталог', async () => {
    const file = await createFile(root, root, 'нотатка.md')
    expect(file.ok).toBe(true)
    expect(await readFile(file.path!, 'utf8')).toBe('')

    const dir = await createDirectory(root, root, 'src')
    expect(dir.ok).toBe(true)
  })

  it('не дає перезаписати наявний файл', async () => {
    await createFile(root, root, 'a.txt')
    const again = await createFile(root, root, 'a.txt')
    expect(again.ok).toBe(false)
    expect(again.error).toMatch(/already exists/)
  })

  it('відхиляє небезпечні назви', async () => {
    for (const name of ['', '  ', '..', 'a/b', 'a\\b']) {
      const result = await createFile(root, root, name)
      expect(result.ok, `назва «${name}» мала бути відхилена`).toBe(false)
    }
  })

  it('не випускає за межі проєкту', async () => {
    // Найважливіша перевірка: інакше дерево дозволяло б писати куди завгодно.
    const escape = await createFile(root, join(root, '../../..'), 'зловмисний.txt')
    expect(escape.ok).toBe(false)
    expect(escape.error).toMatch(/outside the project/)

    await createFile(root, root, 'a.txt')
    const rename = await renamePath(root, join(root, 'a.txt'), '../../втеча.txt')
    expect(rename.ok).toBe(false)
  })

  it('перейменовує і не затирає зайняте ім’я', async () => {
    await createFile(root, root, 'старий.txt')
    await createFile(root, root, 'зайнятий.txt')

    const ok = await renamePath(root, join(root, 'старий.txt'), 'новий.txt')
    expect(ok.ok).toBe(true)
    expect(ok.path).toBe(join(root, 'новий.txt'))

    const clash = await renamePath(root, join(root, 'новий.txt'), 'зайнятий.txt')
    expect(clash.ok).toBe(false)
  })

  it('видаляє в Кошик, а не назавжди', async () => {
    await createFile(root, root, 'непотріб.txt')
    const result = await movePathToTrash(root, join(root, 'непотріб.txt'))
    expect(result.ok).toBe(true)
    // Саме trashItem, а не rm — видалене має лишатися відновлюваним.
    expect(trashed).toEqual([join(root, 'непотріб.txt')])
  })

  it('переміщує файл у інший каталог', async () => {
    await mkdir(join(root, 'src'), { recursive: true })
    await createFile(root, root, 'модуль.ts')

    const moved = await movePath(root, join(root, 'модуль.ts'), join(root, 'src'))
    expect(moved.ok).toBe(true)
    expect(moved.path).toBe(join(root, 'src/модуль.ts'))
  })

  it('не переміщує каталог усередину самого себе', async () => {
    await mkdir(join(root, 'a/b'), { recursive: true })
    const result = await movePath(root, join(root, 'a'), join(root, 'a/b'))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/into itself/)
  })
})

describe('пошук із заміною', () => {
  beforeEach(async () => {
    await writeFile(join(root, 'one.ts'), 'const oldName = 1\nconsole.log(oldName)\n', 'utf8')
    await writeFile(join(root, 'two.ts'), 'export { oldName }\n', 'utf8')
    await writeFile(join(root, 'three.ts'), 'нічого спільного\n', 'utf8')
  })

  it('перегляд рахує входження й не чіпає диск', async () => {
    const preview = await previewReplace({
      root,
      query: 'oldName',
      replacement: 'newName',
      caseSensitive: true
    })

    expect(preview.total).toBe(3)
    expect(preview.files).toHaveLength(2)
    expect(preview.files.some((f) => f.relativePath.includes('three'))).toBe(false)

    // Диск лишається незмінним, поки заміну не застосовано.
    expect(await readFile(join(root, 'one.ts'), 'utf8')).toContain('oldName')

    const sample = preview.files[0].samples[0]
    expect(sample.before).toContain('oldName')
    expect(sample.after).toContain('newName')
  })

  it('застосовує заміну лише до вибраних файлів', async () => {
    const result = await applyReplace({
      root,
      query: 'oldName',
      replacement: 'newName',
      caseSensitive: true,
      paths: [join(root, 'one.ts')]
    })

    expect(result.ok).toBe(true)
    expect(result.changedFiles).toBe(1)
    expect(result.replacements).toBe(2)

    expect(await readFile(join(root, 'one.ts'), 'utf8')).not.toContain('oldName')
    // Невибраний файл лишився недоторканим.
    expect(await readFile(join(root, 'two.ts'), 'utf8')).toContain('oldName')
  })

  it('без regex спецсимволи трактуються буквально', async () => {
    await writeFile(join(root, 'dot.ts'), 'a.b\naxb\n', 'utf8')
    const preview = await previewReplace({
      root,
      query: 'a.b',
      replacement: 'ZZZ',
      caseSensitive: true,
      useRegex: false
    })
    // «a.b» як текст, а не як шаблон: «axb» збігом не є.
    const file = preview.files.find((f) => f.relativePath.includes('dot'))
    expect(file?.count).toBe(1)
  })

  it('повідомляє про некоректний регулярний вираз', async () => {
    const preview = await previewReplace({
      root,
      query: '([',
      replacement: 'x',
      useRegex: true
    })
    expect(preview.error).toBeTruthy()
    expect(preview.files).toEqual([])
  })
})
