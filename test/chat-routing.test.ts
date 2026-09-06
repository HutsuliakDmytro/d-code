import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ChatState } from '../src/shared/ipc'

/**
 * Перевірка маршрутизації реплік між вкладками.
 *
 * Баг, який це покриває: користувач вибирав давнішу сесію зліва, а написане
 * летіло в розмову, яку вела активна вкладка.
 */

const sent: Array<{ tabId: string; text: string }> = []

const claudeUI = {
  chatStart: vi.fn(async (tabId: string, opts: { resumeSessionId?: string; cwd: string }) => {
    const state: ChatState = {
      status: 'ready',
      sessionId: opts.resumeSessionId ?? `new-${tabId}`,
      cwd: opts.cwd
    }
    return state
  }),
  chatSend: vi.fn(async (tabId: string, text: string) => {
    sent.push({ tabId, text })
  }),
  chatClose: vi.fn(async () => undefined),
  chatInterrupt: vi.fn(async () => undefined)
}

vi.stubGlobal('window', { claudeUI })
vi.stubGlobal('crypto', { randomUUID: () => `id-${Math.random().toString(36).slice(2, 8)}` })

const { useChatStore } = await import('../src/renderer/src/store/chat-store')

describe('маршрутизація реплік по вкладках', () => {
  beforeEach(() => {
    sent.length = 0
    const first = useChatStore.getState().tabs[0]
    useChatStore.setState({
      tabs: [{ ...first, state: { status: 'idle' }, live: [], queue: [], attachments: [] }],
      activeId: first.id
    })
  })

  it('репліка йде саме в ту вкладку, що активна', async () => {
    const store = useChatStore.getState()
    const firstId = store.activeId

    await store.start('/proj', { resumeSessionId: 'session-A' })
    await useChatStore.getState().send('привіт з A')

    expect(sent).toEqual([{ tabId: firstId, text: 'привіт з A' }])
  })

  it('дві вкладки не змішують повідомлення', async () => {
    const store = useChatStore.getState()
    const tabA = store.activeId

    await store.start('/proj', { resumeSessionId: 'session-A' })
    await useChatStore.getState().send('в A')

    const tabB = useChatStore.getState().openTab({ cwd: '/proj2' })
    await useChatStore.getState().start('/proj2', { resumeSessionId: 'session-B' })
    await useChatStore.getState().send('в B')

    expect(sent).toEqual([
      { tabId: tabA, text: 'в A' },
      { tabId: tabB, text: 'в B' }
    ])

    // Кожна вкладка тримає власну сесію.
    const tabs = useChatStore.getState().tabs
    expect(tabs.find((t) => t.id === tabA)?.state.sessionId).toBe('session-A')
    expect(tabs.find((t) => t.id === tabB)?.state.sessionId).toBe('session-B')
  })

  it('жива стрічка не перетікає між вкладками', async () => {
    const store = useChatStore.getState()
    const tabA = store.activeId

    await store.start('/proj', { resumeSessionId: 'session-A' })
    await useChatStore.getState().send('перше')

    const tabB = useChatStore.getState().openTab({ cwd: '/proj' })
    await useChatStore.getState().start('/proj', { resumeSessionId: 'session-B' })

    const tabs = useChatStore.getState().tabs
    expect(tabs.find((t) => t.id === tabA)?.live).toHaveLength(1)
    expect(tabs.find((t) => t.id === tabB)?.live).toHaveLength(0)
  })

  it('події застосовуються до названої вкладки, а не до активної', () => {
    const store = useChatStore.getState()
    const tabA = store.activeId
    const tabB = store.openTab({ cwd: '/proj' })

    // Активна — B, але подія адресована A.
    expect(useChatStore.getState().activeId).toBe(tabB)
    useChatStore.getState().applyEvent(tabA, {
      type: 'assistant',
      payload: {
        uuid: 'm1',
        message: { model: 'claude-opus-5', content: [{ type: 'text', text: 'відповідь для A' }] }
      }
    })

    const tabs = useChatStore.getState().tabs
    expect(tabs.find((t) => t.id === tabA)?.live.at(-1)?.text).toBe('відповідь для A')
    expect(tabs.find((t) => t.id === tabB)?.live).toHaveLength(0)
  })

  it('черга належить своїй вкладці', async () => {
    const store = useChatStore.getState()
    const tabA = store.activeId
    await store.start('/proj', { resumeSessionId: 'session-A' })

    useChatStore.getState().enqueue('у чергу A')
    const tabB = useChatStore.getState().openTab({ cwd: '/proj' })
    useChatStore.getState().enqueue('у чергу B')

    const tabs = useChatStore.getState().tabs
    expect(tabs.find((t) => t.id === tabA)?.queue).toEqual(['у чергу A'])
    expect(tabs.find((t) => t.id === tabB)?.queue).toEqual(['у чергу B'])
  })

  it('спорожнення черги надсилає у власну вкладку', async () => {
    const store = useChatStore.getState()
    const tabA = store.activeId
    await store.start('/proj', { resumeSessionId: 'session-A' })
    useChatStore.getState().enqueue('відкладене A')

    // Перемикаємось на іншу вкладку — черга A має піти все одно в A.
    useChatStore.getState().openTab({ cwd: '/proj' })
    await useChatStore.getState().flushQueue(tabA)

    expect(sent.at(-1)).toEqual({ tabId: tabA, text: 'відкладене A' })
  })
})
