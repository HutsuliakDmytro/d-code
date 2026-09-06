import { describe, it, expect } from 'vitest'
import { readdir } from 'node:fs/promises'
import { encodeProjectPath, buildDirToPathMap, PROJECTS_DIR } from '../src/main/store/project-paths'

describe('encodeProjectPath', () => {
  it('замінює роздільники шляху', () => {
    expect(encodeProjectPath('/Users/dmytro/Desktop/claude-code-ui')).toBe(
      '-Users-dmytro-Desktop-claude-code-ui'
    )
  })

  it('замінює підкреслення, крапки та пробіли — не лише слеші', () => {
    expect(encodeProjectPath('/Users/dmytro/Desktop/back_tournament')).toBe(
      '-Users-dmytro-Desktop-back-tournament'
    )
    expect(encodeProjectPath('/Users/dmytro/Desktop/foo.bar')).toBe('-Users-dmytro-Desktop-foo-bar')
    expect(encodeProjectPath('/Users/dmytro/my project')).toBe('-Users-dmytro-my-project')
  })

  it('дає подвійний дефіс для прихованих каталогів', () => {
    expect(encodeProjectPath('/Users/dmytro/.config')).toBe('-Users-dmytro--config')
  })

  it('перетворює кожен не-ASCII символ на окремий дефіс', () => {
    expect(encodeProjectPath('/Users/dmytro/проєкт')).toBe('-Users-dmytro-------')
  })

  it('є неоднозначним — різні шляхи дають один каталог', () => {
    const variants = ['/a/foo.bar', '/a/foo_bar', '/a/foo bar', '/a/foo-bar']
    const encoded = new Set(variants.map(encodeProjectPath))
    expect(encoded.size).toBe(1)
  })

  it('обрізає до 200 символів і дописує base36-хеш повного шляху', () => {
    const long = '/Users/dmytro/' + 'x'.repeat(300)
    const result = encodeProjectPath(long)
    expect(result.length).toBeGreaterThan(200)
    expect(result.slice(0, 200)).toBe(long.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200))
    expect(result[200]).toBe('-')
    expect(result.slice(201)).toMatch(/^[0-9a-z]+$/)
  })

  it('розрізняє довгі шляхи зі спільним префіксом', () => {
    const a = '/Users/dmytro/' + 'x'.repeat(300) + '/alpha'
    const b = '/Users/dmytro/' + 'x'.repeat(300) + '/beta'
    expect(encodeProjectPath(a)).not.toBe(encodeProjectPath(b))
  })
})

describe('відповідність реальним каталогам на диску', () => {
  it('кожен відомий шлях кодується в наявний каталог', async () => {
    const [dirs, map] = await Promise.all([
      readdir(PROJECTS_DIR).catch(() => [] as string[]),
      buildDirToPathMap()
    ])
    if (dirs.length === 0 || map.size === 0) return // немає даних — нічого перевіряти

    const onDisk = new Set(dirs)
    const matched = [...map.keys()].filter((d) => onDisk.has(d))
    expect(matched.length).toBeGreaterThan(0)
  })
})
