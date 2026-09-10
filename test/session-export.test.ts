import { describe, it, expect } from 'vitest'
import type { ChatMessage, SessionMeta } from '../src/shared/types'
import { redact, renderExport, toHtml, toMarkdown } from '../src/main/system/session-export'

const HOME = '/Users/tester'

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: 'abc-123',
    projectPath: `${HOME}/work/app`,
    encodedDir: '-Users-tester-work-app',
    filePath: `${HOME}/.claude/projects/-Users-tester-work-app/abc-123.jsonl`,
    title: 'Fix the parser',
    titleSource: 'ai-title',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T11:00:00.000Z',
    messageCount: 2,
    gitBranch: 'main',
    ...over
  }
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    uuid: 'm1',
    role: 'user',
    timestamp: '2026-09-01T10:00:00.000Z',
    text: 'hello',
    toolCalls: [],
    isSynthetic: false,
    ...over
  }
}

describe('redact', () => {
  it('прибирає ключі за префіксом провайдера', () => {
    const text = 'key sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFF done'
    expect(redact(text, HOME)).toBe('key [redacted:ANTHROPIC_KEY] done')
  })

  it('ловить токени GitHub, AWS, Slack і JWT', () => {
    const out = redact(
      [
        'gho_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'AKIAIOSFODNN7EXAMPLE',
        'xoxb-1234567890-abcdefghij',
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
      ].join('\n'),
      HOME
    )
    expect(out).not.toMatch(/gho_|AKIA|xoxb-|eyJhbGci/)
    expect(out.split('\n')).toEqual([
      '[redacted:GITHUB_TOKEN]',
      '[redacted:AWS_KEY]',
      '[redacted:SLACK_TOKEN]',
      '[redacted:JWT]'
    ])
  })

  it('ховає значення змінних, чия назва сама себе видає', () => {
    expect(redact('DATABASE_PASSWORD=hunter2000', HOME)).toBe('DATABASE_PASSWORD=[redacted]')
    expect(redact('MY_API_KEY: "abcd1234"', HOME)).toBe('MY_API_KEY: "[redacted]"')
  })

  it('не чіпає звичайні змінні оточення', () => {
    expect(redact('NODE_ENV=production', HOME)).toBe('NODE_ENV=production')
    expect(redact('PORT=3000', HOME)).toBe('PORT=3000')
  })

  it('замінює домашню теку на ~ в обох стилях розділювачів', () => {
    expect(redact('/Users/tester/work/app/src', HOME)).toBe('~/work/app/src')
    expect(redact('C:\\Users\\tester\\app', 'C:/Users/tester')).toBe('~\\app')
  })

  it('прибирає адреси пошти', () => {
    expect(redact('author dev@example.com wrote', HOME)).toBe('author [redacted:email] wrote')
  })

  it('не псує хеші, UUID та звичайний код', () => {
    const code = 'const id = "3f2a9c1e-8b7d-4e5f-a1b2-c3d4e5f6a7b8"; sha = a1b2c3d4e5f6'
    expect(redact(code, HOME)).toBe(code)
  })
})

describe('toMarkdown', () => {
  it('редагує шляхи всередині заголовка й тіла', () => {
    const md = toMarkdown(meta(), [message({ text: `see ${HOME}/work/app/x.ts` })], undefined, {}, HOME)
    expect(md).toContain('- **Project:** `~/work/app`')
    expect(md).toContain('see ~/work/app/x.ts')
    expect(md).not.toContain(HOME)
  })

  it('без редагування лишає все як є', () => {
    const md = toMarkdown(meta(), [message()], undefined, { redact: false }, HOME)
    expect(md).toContain(`- **Project:** \`${HOME}/work/app\``)
    expect(md).not.toContain('redacted')
  })

  it('редагує й вміст виклику інструмента, і його аргументи', () => {
    const msg = message({
      role: 'assistant',
      toolCalls: [
        {
          id: 't1',
          name: 'Bash',
          input: { command: `cat ${HOME}/.env` },
          result: { content: 'TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', isError: false, raw: null }
        }
      ]
    })
    const md = toMarkdown(meta(), [msg], undefined, {}, HOME)
    expect(md).toContain('cat ~/.env')
    expect(md).not.toContain('ghp_')
  })

  it('виклики інструментів можна вимкнути', () => {
    const msg = message({
      role: 'assistant',
      toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'ls' } }]
    })
    expect(toMarkdown(meta(), [msg], undefined, { includeTools: false }, HOME)).not.toContain('Bash')
    expect(toMarkdown(meta(), [msg], undefined, { includeTools: true }, HOME)).toContain('Bash')
  })

  it('роздуми додаються лише на запит', () => {
    const msg = message({ role: 'assistant', thinking: 'треба перевірити межі' })
    expect(toMarkdown(meta(), [msg], undefined, {}, HOME)).not.toContain('треба перевірити')
    expect(toMarkdown(meta(), [msg], undefined, { includeThinking: true }, HOME)).toContain(
      'треба перевірити'
    )
  })

  it('закладки позначаються в тексті', () => {
    const note = { text: '', bookmarks: ['m1'], updatedAt: 0 }
    expect(toMarkdown(meta(), [message()], note, {}, HOME)).toContain('### User 🔖')
  })
})

describe('toHtml', () => {
  it('екранує розмітку з тексту повідомлення', () => {
    const html = toHtml(meta(), [message({ text: '<script>alert(1)</script>' })], undefined, {}, HOME)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('стилі інлайняться, щоб файл був самодостатнім', () => {
    const html = toHtml(meta(), [message()], undefined, {}, HOME)
    expect(html).toContain('<style>')
    expect(html).not.toContain('<link')
  })

  it('екранує й назву інструмента, і його результат', () => {
    const msg = message({
      role: 'assistant',
      toolCalls: [
        {
          id: 't1',
          name: 'Read',
          input: { path: 'a.tsx' },
          result: { content: '<b>bold</b>', isError: true, raw: null }
        }
      ]
    })
    const html = toHtml(meta(), [msg], undefined, {}, HOME)
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(html).toContain('(error)')
  })
})

describe('renderExport', () => {
  it('обирає формат за опціями', () => {
    expect(renderExport(meta(), [message()], undefined, { format: 'html' }, HOME)).toMatch(
      /^<!doctype html>/
    )
    expect(renderExport(meta(), [message()], undefined, { format: 'md' }, HOME)).toMatch(/^# /)
  })
})
