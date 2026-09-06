import { describe, it, expect } from 'vitest'
import { languageOf } from '../src/main/system/files'
import { languageExtension } from '../src/renderer/src/lib/codemirror'

describe('визначення мови за розширенням', () => {
  it('розпізнає Flutter, Python і JS', () => {
    expect(languageOf('lib/main.dart')).toBe('dart')
    expect(languageOf('scripts/run.py')).toBe('python')
    expect(languageOf('src/app.js')).toBe('javascript')
    expect(languageOf('src/app.tsx')).toBe('tsx')
  })

  it('розпізнає суміжні мови мобільної розробки', () => {
    expect(languageOf('Runner.swift')).toBe('swift')
    expect(languageOf('MainActivity.kt')).toBe('kotlin')
    expect(languageOf('Native.java')).toBe('java')
    expect(languageOf('bridge.mm')).toBe('objectivec')
    expect(languageOf('engine.cpp')).toBe('cpp')
  })

  it('невідоме розширення лишається текстом', () => {
    expect(languageOf('data.bin')).toBe('text')
  })
})

describe('підсвітка в редакторі', () => {
  const highlighted = [
    'dart',
    'python',
    'javascript',
    'tsx',
    'typescript',
    'json',
    'markdown',
    'swift',
    'kotlin',
    'java',
    'c',
    'cpp',
    'csharp',
    'objectivec',
    'rust',
    'css',
    'html',
    'yaml'
  ]

  it('кожна заявлена мова отримує розширення CodeMirror', () => {
    for (const language of highlighted) {
      const extensions = languageExtension(language)
      expect(extensions.length, `мова ${language} без підсвітки`).toBeGreaterThan(0)
    }
  })

  it('невідома мова не ламає редактор', () => {
    expect(languageExtension('text')).toEqual([])
    expect(languageExtension('чогось-такого-немає')).toEqual([])
  })

  it('те, що бекенд визначив, редактор уміє підсвітити', () => {
    // Дві сторони мають узгоджуватися: інакше файл відкриється без кольорів.
    const files = ['a.dart', 'b.py', 'c.js', 'd.tsx', 'e.swift', 'f.kt', 'g.cpp', 'h.cs']
    for (const file of files) {
      const language = languageOf(file)
      expect(languageExtension(language).length, `${file} → ${language}`).toBeGreaterThan(0)
    }
  })
})
