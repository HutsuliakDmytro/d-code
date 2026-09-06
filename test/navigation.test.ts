import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FileContent } from '../src/shared/ipc'

/** Заглушка мосту: історія навігації живе в renderer і читає файли через нього. */
const claudeUI = {
  readTextFile: vi.fn(
    async (path: string): Promise<FileContent> => ({
      path,
      content: `вміст ${path}`,
      size: 10,
      language: 'typescript',
      truncated: false
    })
  ),
  listDirectory: vi.fn(async () => []),
  gitStatus: vi.fn(async () => ({ isRepo: false, files: [] })),
  writeFileContent: vi.fn(async () => ({ ok: true }))
}

vi.stubGlobal('window', { claudeUI })
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined
})

const { useWorkspaceStore } = await import('../src/renderer/src/store/workspace-store')

const ROOT = '/proj'

describe('історія навігації', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      root: ROOT,
      openFiles: [],
      activePath: undefined,
      history: [],
      historyIndex: -1,
      recent: [],
      tree: {}
    })
  })

  it('запам’ятовує переходи й дозволяє йти назад', async () => {
    const store = useWorkspaceStore.getState()
    await store.openFile('/proj/a.ts')
    await store.openFile('/proj/b.ts')

    expect(useWorkspaceStore.getState().history).toHaveLength(2)
    expect(useWorkspaceStore.getState().canGoBack()).toBe(true)
    expect(useWorkspaceStore.getState().canGoForward()).toBe(false)

    useWorkspaceStore.getState().goBack()
    expect(useWorkspaceStore.getState().activePath).toBe('/proj/a.ts')
    expect(useWorkspaceStore.getState().canGoForward()).toBe(true)
  })

  it('вперед повертає туди, звідки пішли', async () => {
    const store = useWorkspaceStore.getState()
    await store.openFile('/proj/a.ts')
    await store.openFile('/proj/b.ts')

    useWorkspaceStore.getState().goBack()
    useWorkspaceStore.getState().goForward()
    expect(useWorkspaceStore.getState().activePath).toBe('/proj/b.ts')
  })

  it('новий перехід після «назад» обрізає гілку вперед', async () => {
    const store = useWorkspaceStore.getState()
    await store.openFile('/proj/a.ts')
    await store.openFile('/proj/b.ts')
    useWorkspaceStore.getState().goBack()

    // Як у браузері: пішли в інший бік — «вперед» більше нікуди.
    await useWorkspaceStore.getState().openFile('/proj/c.ts')
    expect(useWorkspaceStore.getState().canGoForward()).toBe(false)
    expect(useWorkspaceStore.getState().history.map((h) => h.path)).toEqual([
      '/proj/a.ts',
      '/proj/c.ts'
    ])
  })

  it('повторне відкриття того самого місця не плодить записів', async () => {
    const store = useWorkspaceStore.getState()
    await store.openFile('/proj/a.ts')
    await store.openFile('/proj/a.ts')
    await store.openFile('/proj/a.ts')

    // Інакше «назад» довелося б тиснути тричі без видимого результату.
    expect(useWorkspaceStore.getState().history).toHaveLength(1)
  })

  it('перехід на інший рядок того самого файлу — окремий запис', async () => {
    const store = useWorkspaceStore.getState()
    await store.openFile('/proj/a.ts', 10)
    await store.openFile('/proj/a.ts', 40)

    expect(useWorkspaceStore.getState().history).toHaveLength(2)
    useWorkspaceStore.getState().goBack()
    expect(useWorkspaceStore.getState().history[useWorkspaceStore.getState().historyIndex].line).toBe(
      10
    )
  })

  it('назад на початку історії нічого не ламає', async () => {
    await useWorkspaceStore.getState().openFile('/proj/a.ts')
    useWorkspaceStore.getState().goBack()
    useWorkspaceStore.getState().goBack()
    expect(useWorkspaceStore.getState().activePath).toBe('/proj/a.ts')
    expect(useWorkspaceStore.getState().historyIndex).toBe(0)
  })
})

describe('нещодавні файли', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      root: ROOT,
      openFiles: [],
      activePath: undefined,
      history: [],
      historyIndex: -1,
      recent: []
    })
  })

  it('найсвіжіші йдуть першими, без повторів', async () => {
    const store = useWorkspaceStore.getState()
    await store.openFile('/proj/a.ts')
    await store.openFile('/proj/b.ts')
    await store.openFile('/proj/a.ts')

    expect(useWorkspaceStore.getState().recent).toEqual(['/proj/a.ts', '/proj/b.ts'])
  })
})
