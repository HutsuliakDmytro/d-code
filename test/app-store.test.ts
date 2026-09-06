import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProjectGroup, SessionListItem } from '../src/shared/ipc'

/**
 * Логіка вибору сесії живе в renderer і залежить від `window.claudeUI`,
 * тому міст підміняється заглушкою.
 */
function makeSession(sessionId: string, projectPath: string): SessionListItem {
  return {
    meta: {
      sessionId,
      projectPath,
      encodedDir: projectPath.replace(/[^a-zA-Z0-9]/g, '-'),
      filePath: `${projectPath}/${sessionId}.jsonl`,
      title: sessionId,
      titleSource: 'ai-title',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: `2026-08-20T10:0${sessionId.length % 10}:00.000Z`,
      messageCount: 1
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      thinkingTokens: 0,
      requests: 0,
      byModel: {}
    },
    subagentCount: 0
  }
}

let groups: ProjectGroup[] = []

function setGroups(sessions: SessionListItem[]): void {
  groups = [
    {
      projectPath: '/proj',
      encodedDir: '-proj',
      sessions,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 0,
        requests: 0,
        byModel: {}
      }
    }
  ]
}

const claudeUI = {
  listSessions: vi.fn(async () => groups),
  // Вибір сесії підтягує її закладки — заглушка має це вміти.
  getNote: vi.fn(async () => ({ text: '', bookmarks: [] as string[], updatedAt: 0 })),
  toggleBookmark: vi.fn(async () => [] as string[]),
  readTranscript: vi.fn(async () => ({
    meta: groups[0].sessions[0].meta,
    messages: [],
    usage: groups[0].sessions[0].usage,
    subagents: []
  }))
}

vi.stubGlobal('window', { claudeUI })

const { useAppStore } = await import('../src/renderer/src/store/app-store')

describe('вибір сесії при запуску нового діалогу', () => {
  beforeEach(() => {
    useAppStore.setState({
      groups: [],
      selected: undefined,
      transcript: undefined,
      pendingSessionId: undefined
    })
    claudeUI.listSessions.mockClear()
  })

  it('без активного діалогу відкриває найсвіжішу сесію', async () => {
    setGroups([makeSession('old-1', '/proj'), makeSession('older-22', '/proj')])
    await useAppStore.getState().loadSessions()
    expect(useAppStore.getState().selected?.meta.sessionId).toBe('old-1')
  })

  it('нова сесія знімає вибір, доки CLI не запише її на диск', () => {
    setGroups([makeSession('old-1', '/proj')])
    useAppStore.setState({ groups, selected: groups[0].sessions[0] })

    useAppStore.getState().followSession('brand-new')

    const state = useAppStore.getState()
    // Головне: центр не має лишатися на попередній сесії того ж каталогу.
    expect(state.selected).toBeUndefined()
    expect(state.pendingSessionId).toBe('brand-new')
  })

  it('не перекидає на стару сесію, поки нова ще не з’явилась', async () => {
    setGroups([makeSession('old-1', '/proj')])
    useAppStore.setState({ groups, pendingSessionId: 'brand-new', selected: undefined })

    await useAppStore.getState().loadSessions()

    const state = useAppStore.getState()
    expect(state.selected).toBeUndefined()
    expect(state.pendingSessionId).toBe('brand-new')
  })

  it('перемикається на нову сесію, щойно вона з’явилась', async () => {
    useAppStore.setState({ pendingSessionId: 'brand-new', selected: undefined })
    setGroups([makeSession('brand-new', '/proj'), makeSession('old-1', '/proj')])

    await useAppStore.getState().loadSessions()

    const state = useAppStore.getState()
    expect(state.selected?.meta.sessionId).toBe('brand-new')
    expect(state.pendingSessionId).toBeUndefined()
  })

  it('явний вибір користувача скасовує очікування', async () => {
    setGroups([makeSession('old-1', '/proj')])
    useAppStore.setState({ groups, pendingSessionId: 'brand-new' })

    await useAppStore.getState().selectSession(groups[0].sessions[0])
    expect(useAppStore.getState().pendingSessionId).toBeUndefined()

    // Наступне оновлення індексу не повертає до очікуваної сесії.
    setGroups([makeSession('brand-new', '/proj'), makeSession('old-1', '/proj')])
    await useAppStore.getState().loadSessions()
    expect(useAppStore.getState().selected?.meta.sessionId).toBe('old-1')
  })

  it('followSession нічого не робить, якщо сесія вже вибрана', () => {
    setGroups([makeSession('same', '/proj')])
    useAppStore.setState({ groups, selected: groups[0].sessions[0], pendingSessionId: undefined })

    useAppStore.getState().followSession('same')

    expect(useAppStore.getState().selected?.meta.sessionId).toBe('same')
    expect(useAppStore.getState().pendingSessionId).toBeUndefined()
  })
})
