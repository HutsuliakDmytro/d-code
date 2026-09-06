import { useEffect, useState } from 'react'
import { Group, Panel, Separator, usePanelRef, useDefaultLayout } from 'react-resizable-panels'
import Sidebar from './panels/Sidebar'
import ActivityBar from './panels/ActivityBar'
import ChatView from './panels/ChatView'
import MetricsPanel from './panels/MetricsPanel'
import { useAppStore } from './store/app-store'
import { useChatStore } from './store/chat-store'
import NewSessionDialog from './components/NewSessionDialog'
import SearchDialog from './components/SearchDialog'
import CodeSearchDialog from './components/CodeSearchDialog'
import CompareDialog from './components/CompareDialog'
import ReplaceDialog from './components/ReplaceDialog'
import SymbolPalette from './components/SymbolPalette'
import CommandPalette, { type Command } from './components/CommandPalette'
import BranchDiffDialog from './components/BranchDiffDialog'
import FileViewer from './panels/FileViewer'
import RightPanel from './panels/RightPanel'
import TerminalPanel from './panels/TerminalPanel'
import PreviewPanel from './panels/PreviewPanel'
import BottomTabs from './components/BottomTabs'
import DebugPanel from './components/DebugPanel'
import { useWorkspaceStore } from './store/workspace-store'
import { useTranslate } from './i18n'

const PANEL_IDS = ['sessions', 'chat', 'metrics']

export default function App(): React.JSX.Element {
  const t = useTranslate()
  const loadSessions = useAppStore((s) => s.loadSessions)
  const activeTab = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const chatSessionId = activeTab?.state.sessionId
  const chatStatus = activeTab?.state.status
  const sidebarRef = usePanelRef()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [codeSearchOpen, setCodeSearchOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [palette, setPalette] = useState<'commands' | 'files' | 'recent'>()
  const [branchDiffOpen, setBranchDiffOpen] = useState(false)
  // Editor mode kicks in as soon as at least one file is open.
  const editorMode = useWorkspaceStore((s) => s.openFiles.length > 0)
  const terminalOpen = useWorkspaceStore((s) => s.terminalOpen)
  const bottomTab = useWorkspaceStore((s) => s.bottomTab)
  const symbolsOpen = useWorkspaceStore((s) => s.symbolPaletteOpen)
  const setSymbolsOpen = useWorkspaceStore((s) => s.setSymbolPaletteOpen)
  const setTab = useWorkspaceStore((s) => s.setTab)
  const setRoot = useWorkspaceStore((s) => s.setRoot)

  // Panel widths survive an application restart.
  const layout = useDefaultLayout({ id: 'claude-ui-layout', panelIds: PANEL_IDS, storage: localStorage })

  useEffect(() => {
    void loadSessions()
    // Transcripts grow while the CLI runs, so the index refreshes itself.
    return window.claudeUI.onSessionsChanged(() => void loadSessions())
  }, [loadSessions])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        // Shift separates the two searches: project code and chat history.
        if (e.shiftKey) setCodeSearchOpen(true)
        else setSearchOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        setNewSessionOpen(true)
      }
      // ⌃` is the terminal toggle editors have trained everyone to expect.
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        useWorkspaceStore.getState().toggleTerminal()
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setCompareOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setReplaceOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setSymbolsOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPalette('commands')
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPalette('files')
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        setPalette('recent')
      }
      // ⌃- and ⌃⇧- walk the navigation history, as editors do.
      if (e.ctrlKey && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        const store = useWorkspaceStore.getState()
        if (e.shiftKey) store.goForward()
        else store.goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Root for files and git is the working directory of the current work.
  useEffect(() => {
    const unsubscribe = useAppStore.subscribe((state) => {
      const cwd = state.selected?.meta.projectPath ?? useChatStore.getState().active().cwd
      setRoot(cwd)
    })
    const initial =
      useAppStore.getState().selected?.meta.projectPath ?? useChatStore.getState().active().cwd
    setRoot(initial)
    return unsubscribe
  }, [setRoot])

  // The centre always shows the active conversation's session. Without this,
  // starting a new session in a directory that already had one would leave the
  // previous transcript on screen.
  useEffect(() => {
    if (!chatSessionId) return
    if (chatStatus !== 'ready' && chatStatus !== 'thinking') return
    useAppStore.getState().followSession(chatSessionId)
  }, [chatSessionId, chatStatus])

  // And the reverse: picking a session on the left switches to its tab if one is
  // open. Otherwise the selected session and the active conversation drift apart,
  // and what you type goes to the wrong place.
  useEffect(() =>
    useAppStore.subscribe((state, previous) => {
      const sessionId = state.selected?.meta.sessionId
      if (!sessionId || sessionId === previous.selected?.meta.sessionId) return

      const store = useChatStore.getState()
      const owner = store.tabs.find((t) => t.state.sessionId === sessionId)
      if (owner && owner.id !== store.activeId) store.setActive(owner.id)
    })
  , [])

  useEffect(() => {
    const { setState, applyEvent, setPermission } = useChatStore.getState()

    const handleEvent = (tabId: string, event: Parameters<typeof applyEvent>[1]): void => {
      applyEvent(tabId, event)
      if (event.type !== 'result') return

      // The queue moves at once: the next message must not wait for a re-read.
      void useChatStore.getState().flushQueue(tabId)

      // The CLI appends to the transcript asynchronously — reading immediately
      // would catch the file without the last turn.
      setTimeout(() => {
        const store = useChatStore.getState()
        const tab = store.tabs.find((t) => t.id === tabId)
        const { selected, refreshTranscript, loadSessions } = useAppStore.getState()
        void loadSessions()

        // Refresh the centre only for the active tab, and only once the queue is
        // empty: otherwise the context of an ongoing conversation disappears.
        if (
          tab?.state.sessionId &&
          tab.id === store.activeId &&
          tab.state.sessionId === selected?.meta.sessionId &&
          tab.queue.length === 0
        ) {
          void refreshTranscript().then(() => store.clearLive(tabId))
        }
      }, 1200)
    }

    const off = [
      window.claudeUI.onChatState(setState),
      window.claudeUI.onChatEvent(handleEvent),
      window.claudeUI.onChatPermission(setPermission)
    ]
    return () => off.forEach((fn) => fn())
  }, [])

  /**
   * Every application action in one list.
   *
   * The palette is the only place they are visible together, so new capabilities
   * belong here: otherwise they stay hidden behind a shortcut nobody knows.
   */
  const commands: Command[] = [
    {
      id: 'session.new',
      category: t('Session'),
      label: t('New session'),
      hint: '⌘N',
      run: () => setNewSessionOpen(true)
    },
    {
      id: 'chat.newTab',
      category: t('Session'),
      label: t('New conversation tab'),
      run: () => useChatStore.getState().openTab()
    },
    {
      id: 'search.history',
      category: t('Search'),
      label: t('Search chat history'),
      hint: '⌘F',
      run: () => setSearchOpen(true)
    },
    {
      id: 'search.code',
      category: t('Search'),
      label: t('Search code'),
      hint: '⌘⇧F',
      run: () => setCodeSearchOpen(true)
    },
    {
      id: 'search.replace',
      category: t('Search'),
      label: t('Replace in project'),
      hint: '⌘⇧H',
      run: () => setReplaceOpen(true)
    },
    {
      id: 'go.file',
      category: t('Go'),
      label: t('Open file'),
      hint: '⌘P',
      run: () => setPalette('files')
    },
    {
      id: 'go.recent',
      category: t('Go'),
      label: t('Recent files'),
      hint: '⌘E',
      run: () => setPalette('recent')
    },
    {
      id: 'go.symbol',
      category: t('Go'),
      label: t('Go to symbol'),
      hint: '⌘⇧O',
      run: () => setSymbolsOpen(true)
    },
    {
      id: 'go.back',
      category: t('Go'),
      label: t('Back'),
      hint: '⌃-',
      enabled: useWorkspaceStore.getState().canGoBack(),
      run: () => useWorkspaceStore.getState().goBack()
    },
    {
      id: 'go.forward',
      category: t('Go'),
      label: t('Forward'),
      hint: '⌃⇧-',
      enabled: useWorkspaceStore.getState().canGoForward(),
      run: () => useWorkspaceStore.getState().goForward()
    },
    {
      id: 'view.terminal',
      category: t('View'),
      label: terminalOpen ? t('Hide terminal') : t('Show terminal'),
      hint: '⌃`',
      run: () => useWorkspaceStore.getState().toggleTerminal()
    },
    {
      id: 'view.files',
      category: t('View'),
      label: t('Files panel'),
      run: () => selectTab('files')
    },
    {
      id: 'view.git',
      category: t('View'),
      label: t('Git panel'),
      run: () => selectTab('git')
    },
    {
      id: 'view.problems',
      category: t('View'),
      label: t('Problems panel'),
      run: () => selectTab('problems')
    },
    {
      id: 'view.tasks',
      category: t('View'),
      label: t('Tasks panel'),
      run: () => selectTab('tasks')
    },
    {
      id: 'file.closeAll',
      category: t('File'),
      label: t('Close all files'),
      enabled: editorMode,
      run: () => useWorkspaceStore.getState().closeAllFiles()
    },
    {
      id: 'view.preview',
      category: t('View'),
      label: t('Localhost preview'),
      run: () => useWorkspaceStore.getState().setBottomTab('preview')
    },
    {
      id: 'git.branchDiff',
      category: 'Git',
      label: t('Compare branches'),
      run: () => setBranchDiffOpen(true)
    },
    {
      id: 'file.split',
      category: t('File'),
      label: t('Close second column'),
      enabled: useWorkspaceStore.getState().splitPath !== undefined,
      run: () => useWorkspaceStore.getState().closeSplit()
    },
    {
      id: 'session.compare',
      category: t('Session'),
      label: t('Compare session branches'),
      hint: '⌘⇧D',
      run: () => setCompareOpen(true)
    }
  ]

  /** Clicking the active tab collapses the panel; another switches and expands. */
  const selectTab = (next: Parameters<typeof setTab>[0]): void => {
    const { tab } = useWorkspaceStore.getState()
    if (next === tab && !sidebarCollapsed) {
      sidebarRef.current?.collapse()
      return
    }
    setTab(next)
    if (sidebarCollapsed) sidebarRef.current?.expand()
  }

  const main = (
    <div className="h-full flex">
      <ActivityBar collapsed={sidebarCollapsed} onSelect={selectTab} />

      <Group orientation="horizontal" className="flex-1 min-w-0" {...layout}>
        <Panel
          id="sessions"
          panelRef={sidebarRef}
          defaultSize="19%"
          minSize="12%"
          maxSize="34%"
          collapsible
          collapsedSize={0}
          onResize={(size) => setSidebarCollapsed(size.inPixels < 1)}
        >
          <Sidebar
            onNewSession={() => setNewSessionOpen(true)}
            onSearch={() => setSearchOpen(true)}
            onCompareBranches={() => setBranchDiffOpen(true)}
          />
        </Panel>

        <Separator className="resize-separator" />

        <Panel id="chat" defaultSize="56%" minSize="30%">
          {editorMode ? (
            <FileViewer />
          ) : (
            <ChatView />
          )}
        </Panel>

        <Separator className="resize-separator" />

        <Panel id="metrics" defaultSize={editorMode ? '32%' : '23%'} minSize="18%" maxSize="46%">
          {/* With code in the centre, chat moves here — as in any normal IDE. */}
          {editorMode ? <RightPanel /> : <MetricsPanel />}
        </Panel>

        <NewSessionDialog open={newSessionOpen} onClose={() => setNewSessionOpen(false)} />
        <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
        <CodeSearchDialog open={codeSearchOpen} onClose={() => setCodeSearchOpen(false)} />
        <CompareDialog open={compareOpen} onClose={() => setCompareOpen(false)} />
        <ReplaceDialog open={replaceOpen} onClose={() => setReplaceOpen(false)} />
        <BranchDiffDialog open={branchDiffOpen} onClose={() => setBranchDiffOpen(false)} />
        <SymbolPalette open={symbolsOpen} onClose={() => setSymbolsOpen(false)} />
        <CommandPalette
          open={palette !== undefined}
          initialMode={palette ?? 'commands'}
          commands={commands}
          onClose={() => setPalette(undefined)}
        />
      </Group>
    </div>
  )

  // The terminal spans the full width at the bottom, sparing the side panels.
  if (!terminalOpen) return main

  return (
    <Group orientation="vertical" className="h-full">
      <Panel id="main-area" defaultSize="68%" minSize="30%">
        {main}
      </Panel>
      <Separator className="resize-separator-h" />
      <Panel id="terminal" defaultSize="32%" minSize="12%">
        <div className="h-full flex flex-col">
          <BottomTabs />
          <div className="flex-1 min-h-0">
            {bottomTab === 'terminal' ? (
              <TerminalPanel />
            ) : bottomTab === 'debug' ? (
              <DebugPanel />
            ) : (
              <PreviewPanel />
            )}
          </div>
        </div>
      </Panel>
    </Group>
  )
}
