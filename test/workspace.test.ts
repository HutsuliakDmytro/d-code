import { describe, it, expect } from 'vitest'
import { detectEditors, listSkills, listWorkspaces } from '../src/main/system/workspace'
import { hasLocalClaudeData } from './local-data'

describe('listWorkspaces', () => {
  it.skipIf(!hasLocalClaudeData)('знаходить каталоги, у яких працював CLI, зі справжніми шляхами', async () => {
    const ws = await listWorkspaces()
    console.log(`\nробочих каталогів: ${ws.length}`)
    for (const w of ws) {
      console.log(
        `  ${w.exists ? '✓' : '✗'} ${w.name.padEnd(24)} ${String(w.sessionCount).padStart(2)} сес.` +
          `${w.gitBranch ? `  [${w.gitBranch}]` : ''}  ${w.path}`
      )
    }
    expect(ws.length).toBeGreaterThan(0)
    // Шлях має бути абсолютним, а не закодованим ім'ям каталогу.
    for (const w of ws) {
      expect(w.path.startsWith('/')).toBe(true)
      expect(w.path).not.toMatch(/^-Users-/)
    }
    // Наявні каталоги йдуть першими.
    const firstMissing = ws.findIndex((w) => !w.exists)
    if (firstMissing !== -1) {
      expect(ws.slice(firstMissing).every((w) => !w.exists)).toBe(true)
    }
  })
})

describe('detectEditors', () => {
  it('повертає лише встановлені редактори', async () => {
    const editors = await detectEditors()
    console.log(
      '\nредактори:',
      editors.map((e) => `${e.name}${e.command ? ` (${e.command})` : ' (.app)'}`).join(', ')
    )
    expect(editors.length).toBeGreaterThan(0)
    // Finder доступний завжди і має бути останнім запасним варіантом.
    expect(editors.at(-1)?.id).toBe('finder')
    for (const e of editors) {
      if (e.id === 'finder') continue
      expect(Boolean(e.command || e.appPath)).toBe(true)
    }
  })
})

describe('listSkills', () => {
  it('читає перелік скілів із вкладення skill_listing', async () => {
    const skills = await listSkills()
    console.log(`\nскілів: ${skills.length}`)
    console.log('  ' + skills.map((s) => s.name).join(', '))
    const withDesc = skills.filter((s) => s.description).length
    console.log(`  з описом: ${withDesc}/${skills.length}`)

    if (skills.length === 0) return // порожньо, поки в транскриптах немає skill_listing
    for (const s of skills) {
      expect(s.name).toMatch(/^[a-z0-9:_-]+$/i)
    }
    // Описи потрібні для меню — без них список нечитабельний.
    expect(withDesc).toBeGreaterThan(0)
  })
})
