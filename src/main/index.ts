import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import { dirname, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import chokidar, { type FSWatcher } from 'chokidar'
import {
  EVENT,
  INVOKE,
  type AppInfo,
  type ChatStartOptions,
  type ChatState,
  type ChatStreamEvent,
  type PermissionReply,
  type PermissionRequest,
  type ProjectGroup,
  type TranscriptPayload
} from '@shared/ipc'
import type { Attachment, PermissionMode, RateLimitEventInfo } from '@shared/types'
import { CLAUDE_HOME, PROJECTS_DIR } from './store/project-paths'
import {
  scanAllSessions,
  scanTranscript,
  emptyTotals,
  mergeTotals,
  readLiveSessions
} from './store/scanner'
import { parseTranscript } from './store/parser'
import { RateLimitTracker } from './metrics/rate-limits'
import { ChatPool } from './claude/chat-pool'
import { childEnv, resolveClaudePath } from './claude/resolve-cli'
import { detectEditors, listSkills, listWorkspaces, openInEditor } from './system/workspace'
import { searchTranscripts } from './store/search'
import { collectActivity } from './store/stats'
import { readAttachment } from './system/attachments'
import { listDirectory, readTextFile, searchCode } from './system/files'
import * as git from './system/git'
import {
  GitRemoteRunner,
  diffBranchFile,
  diffBranches,
  listStash,
  markResolved,
  readConflictFile,
  stashApply,
  stashDrop,
  stashSave,
  writeConflictFile,
  type RemoteOperation
} from './system/git-remote'
import {
  createPullRequest,
  currentPullRequest,
  ghStatus,
  listPullRequests
} from './system/github'

const gitRemote = new GitRemoteRunner()
import { readPromptHistory } from './system/prompt-history'
import { listProjectFiles } from './system/file-index'
import { listAgentTypes, listHooks, listMcpServers, listPlugins } from './system/extensions'
import { getNote, saveNote, toggleBookmark, toMarkdown } from './system/session-notes'
import { listScripts, TaskRunner, type TaskChunk, type TaskState } from './system/tasks'
import { listCheckpoints, restoreCheckpoint, type CheckpointFile } from './store/checkpoints'
import { compareSessions } from './store/session-compare'
import { TerminalManager, type TerminalChunk, type TerminalInfo } from './system/terminal'
import {
  createDirectory,
  createFile,
  movePath,
  movePathToTrash,
  renamePath
} from './system/file-ops'
import { applyReplace, previewReplace, type ReplaceOptions } from './system/replace'
import { canFormat, formatFile } from './system/formatter'
import { DiagnosticsRunner, type DiagnosticsState } from './system/diagnostics'
import { symbolsFor } from './system/symbols'
import { LspManager } from './lsp/manager'
import { DebugSession, type DebugState } from './debug/session'

const lsp = new LspManager()
const debugSession = new DebugSession()
import {
  editSelection,
  explainSelection,
  reviewStagedDiff,
  suggestCommitMessage,
  type EditSelectionOptions,
  type ExplainOptions
} from './claude/code-actions'

const diagnostics = new DiagnosticsRunner()

const terminals = new TerminalManager()

const tasks = new TaskRunner()

/** Wrapper for actions that can fail for reasons outside our control. */
async function attempt(fn: () => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    await fn()
    return { ok: true }
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    return { ok: false, error: (e.stderr || e.message).trim() }
  }
}
import {
  listChangedFiles,
  readBackup,
  readCurrent,
  restoreBackup,
  writeContent
} from './store/file-history'
import {
  openPath,
  openSessionInTerminal,
  revealInFinder,
  startRemoteControlSession,
  stopProcess
} from './claude/session-actions'

import { log } from './log'

const execFileAsync = promisify(execFile)
const isDev = !app.isPackaged

/**
 * When the app runs with a pipe attached (dev mode, nohup), that pipe can close
 * before the process does. Any `console.log` afterwards throws EPIPE and, as an
 * uncaught exception, takes the whole window down. Silenced at the stream level.
 */
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') return
    // Other stream errors are no reason to crash either, but worth knowing about.
    try {
      process.stderr.write(`[stream] ${err.message}\n`)
    } catch {
      // Nowhere to write; swallowing is all that is left.
    }
  })
}

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return
  log('[main] uncaught exception:', err.message)
})

let mainWindow: BrowserWindow | null = null
let watcher: FSWatcher | null = null
const rateLimits = new RateLimitTracker()
const chat = new ChatPool()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Needed for the localhost preview: dev servers forbid iframe embedding.
      webviewTag: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // The renderer has no terminal of its own; without this, UI errors stay invisible.
  mainWindow.webContents.on('console-message', (event) => {
    const level = event.level === 'error' ? 'ERR' : event.level === 'warning' ? 'WRN' : 'LOG'
    log(`[renderer:${level}] ${event.message}`)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, description) => {
    log(`[renderer] load failed: ${code} ${description}`)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('[renderer] process gone:', details.reason)
  })

  // External links open in the browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

/** Groups the flat session index by project for the left panel. */
async function buildProjectGroups(): Promise<ProjectGroup[]> {
  const entries = await scanAllSessions()
  const groups = new Map<string, ProjectGroup>()

  for (const e of entries) {
    let group = groups.get(e.meta.projectPath)
    if (!group) {
      group = {
        projectPath: e.meta.projectPath,
        encodedDir: e.meta.encodedDir,
        sessions: [],
        usage: emptyTotals()
      }
      groups.set(e.meta.projectPath, group)
    }
    group.sessions.push({
      meta: e.meta,
      usage: e.usage,
      subagentCount: e.subagents.length
    })
    mergeTotals(group.usage, e.usage)
  }

  if (isDev) {
    const n = entries.length
    const live = entries.filter((e) => e.meta.live).length
    log(`[index] projects: ${groups.size}, sessions: ${n}, live: ${live}`)
  }

  // Projects are ordered by how recent their newest session is.
  return [...groups.values()].sort((a, b) =>
    (b.sessions[0]?.meta.updatedAt ?? '').localeCompare(a.sessions[0]?.meta.updatedAt ?? '')
  )
}

async function loadTranscript(args: {
  filePath: string
  projectPath: string
  encodedDir: string
}): Promise<TranscriptPayload> {
  const opts = { projectPath: args.projectPath, encodedDir: args.encodedDir }
  const [parsed, scanned] = await Promise.all([
    parseTranscript(args.filePath, opts),
    scanTranscript(args.filePath, opts)
  ])

  if (parsed.unknownTypes.size) {
    // The CLI format shifts between versions — do not stay silent about it.
    log('Unknown line types in', args.filePath, [...parsed.unknownTypes])
  }

  // Subagent branches live separately; the UI loads them on demand by agentId.
  const subagentDir = join(dirname(args.filePath), scanned.meta.sessionId, 'subagents')
  const subagents = await readdir(subagentDir)
    .then((files) =>
      Promise.all(
        files
          .filter((f) => f.endsWith('.jsonl'))
          .map(async (f) => {
            const agentId = f.replace(/^agent-/, '').replace(/\.jsonl$/, '')
            const meta = await readFile(join(subagentDir, `agent-${agentId}.meta.json`), 'utf8')
              .then((t) => JSON.parse(t) as Record<string, unknown>)
              .catch(() => ({}) as Record<string, unknown>)
            return {
              agentId,
              filePath: join(subagentDir, f),
              agentType: meta.agentType as string | undefined,
              description: meta.description as string | undefined,
              toolUseId: meta.toolUseId as string | undefined
            }
          })
      )
    )
    .catch(() => [])

  return {
    meta: { ...scanned.meta, ...parsed.meta },
    messages: parsed.messages,
    usage: scanned.usage,
    subagents
  }
}

/** The CLI version matters because the transcript schema changes between them. */
async function readAppInfo(): Promise<AppInfo> {
  const info: AppInfo = { claudeHome: CLAUDE_HOME }
  try {
    const claudePath = await resolveClaudePath()
    const { stdout } = await execFileAsync(claudePath, ['--version'], {
      timeout: 5000,
      env: await childEnv()
    })
    info.claudeVersion = stdout.trim()
    info.claudePath = claudePath
  } catch {
    // The CLI may be off the app's PATH — not fatal for browsing history.
  }
  try {
    const settings = JSON.parse(await readFile(join(CLAUDE_HOME, 'settings.json'), 'utf8')) as {
      model?: string
    }
    info.defaultModel = settings.model
  } catch {
    // settings.json is optional.
  }
  return info
}

function registerIpc(): void {
  ipcMain.handle(INVOKE.listSessions, () => buildProjectGroups())
  ipcMain.handle(INVOKE.readTranscript, (_e, args) => loadTranscript(args))
  ipcMain.handle(INVOKE.readSubagent, (_e, args) => loadTranscript(args))
  ipcMain.handle(INVOKE.rateLimits, () => rateLimits.getState())
  ipcMain.handle(INVOKE.refreshRateLimits, () => rateLimits.refresh())
  ipcMain.handle(INVOKE.appInfo, () => readAppInfo())

  ipcMain.handle(INVOKE.chatStart, (_e, a: { tabId: string; opts: ChatStartOptions }) =>
    chat.start(a.tabId, a.opts)
  )
  ipcMain.handle(
    INVOKE.chatSend,
    (_e, a: { tabId: string; text: string; attachments?: Attachment[] }) =>
      chat.send(a.tabId, a.text, a.attachments)
  )
  ipcMain.handle(INVOKE.chatInterrupt, (_e, tabId: string) => chat.interrupt(tabId))
  ipcMain.handle(INVOKE.chatClose, (_e, tabId: string) => chat.close(tabId))
  ipcMain.handle(
    INVOKE.chatPermissionReply,
    (_e, a: { tabId: string; requestId: string; reply: PermissionReply }) =>
      chat.replyPermission(a.tabId, a.requestId, a.reply)
  )
  ipcMain.handle(
    INVOKE.chatSetPermissionMode,
    (_e, a: { tabId: string; mode: PermissionMode }) => chat.setPermissionMode(a.tabId, a.mode)
  )
  ipcMain.handle(INVOKE.chatSetModel, (_e, a: { tabId: string; model: string }) =>
    chat.setModel(a.tabId, a.model)
  )

  ipcMain.handle(INVOKE.liveSessions, () => readLiveSessions())

  // The actions below reach outside the app, so each returns a result instead of
  // throwing: osascript or someone else's process can refuse for reasons the user
  // needs to read as text.
  ipcMain.handle(INVOKE.openInTerminal, async (_e, args: { cwd: string; sessionId?: string }) => {
    try {
      await openSessionInTerminal(args.cwd, args.sessionId)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    INVOKE.startRemoteControl,
    async (_e, args: { cwd: string; name?: string }) => {
      try {
        await startRemoteControlSession(args.cwd, args.name)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    INVOKE.searchTranscripts,
    (_e, args: { query: string; includeTools: boolean }) =>
      searchTranscripts({ query: args.query, includeTools: args.includeTools })
  )
  ipcMain.handle(INVOKE.changedFiles, (_e, args: { transcriptPath: string; sessionId: string }) =>
    listChangedFiles(args.transcriptPath, args.sessionId)
  )
  ipcMain.handle(
    INVOKE.fileDiff,
    async (_e, args: { sessionId: string; backupFileName: string; path: string }) => ({
      backup: await readBackup(args.sessionId, args.backupFileName),
      current: await readCurrent(args.path)
    })
  )
  ipcMain.handle(
    INVOKE.restoreFile,
    (_e, args: { sessionId: string; backupFileName: string; targetPath: string }) =>
      restoreBackup(args)
  )
  ipcMain.handle(INVOKE.writeFile, (_e, args: { path: string; content: string }) =>
    writeContent(args.path, args.content)
  )

  ipcMain.handle(INVOKE.activityStats, (_e, days: number) => collectActivity(days))

  ipcMain.handle(INVOKE.pickFiles, async () => {
    if (!mainWindow) return []
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
      buttonLabel: 'Attach'
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle(INVOKE.readAttachment, (_e, path: string) => readAttachment(path))

  ipcMain.handle(INVOKE.listDirectory, (_e, a: { root: string; dirPath?: string }) =>
    listDirectory(a.root, a.dirPath)
  )
  ipcMain.handle(INVOKE.readTextFile, (_e, path: string) => readTextFile(path))
  ipcMain.handle(
    INVOKE.searchCode,
    (_e, a: { root: string; query: string; caseSensitive: boolean }) =>
      searchCode(a.root, a.query, { caseSensitive: a.caseSensitive })
  )

  ipcMain.handle(INVOKE.promptHistory, (_e, project?: string) =>
    readPromptHistory({ project })
  )
  ipcMain.handle(INVOKE.projectFiles, (_e, root: string) => listProjectFiles(root))
  ipcMain.handle(INVOKE.mcpServers, () => listMcpServers())
  ipcMain.handle(INVOKE.hooks, (_e, projectRoot?: string) => listHooks(projectRoot))
  ipcMain.handle(INVOKE.plugins, () => listPlugins())
  ipcMain.handle(INVOKE.agentTypes, () => listAgentTypes())

  ipcMain.handle(INVOKE.listCheckpoints, (_e, transcriptPath: string) =>
    listCheckpoints(transcriptPath)
  )
  ipcMain.handle(
    INVOKE.restoreCheckpoint,
    (_e, a: { sessionId: string; files: CheckpointFile[] }) =>
      restoreCheckpoint(a.sessionId, a.files)
  )
  ipcMain.handle(
    INVOKE.compareSessions,
    (
      _e,
      a: {
        left: { filePath: string; projectPath: string; encodedDir: string }
        right: { filePath: string; projectPath: string; encodedDir: string }
      }
    ) => compareSessions(a.left, a.right)
  )

  ipcMain.handle(INVOKE.createFile, (_e, a: { root: string; dirPath: string; name: string }) =>
    createFile(a.root, a.dirPath, a.name)
  )
  ipcMain.handle(INVOKE.createDir, (_e, a: { root: string; dirPath: string; name: string }) =>
    createDirectory(a.root, a.dirPath, a.name)
  )
  ipcMain.handle(INVOKE.renamePath, (_e, a: { root: string; path: string; newName: string }) =>
    renamePath(a.root, a.path, a.newName)
  )
  ipcMain.handle(INVOKE.trashPath, (_e, a: { root: string; path: string }) =>
    movePathToTrash(a.root, a.path)
  )
  ipcMain.handle(INVOKE.movePath, (_e, a: { root: string; path: string; targetDir: string }) =>
    movePath(a.root, a.path, a.targetDir)
  )

  ipcMain.handle(INVOKE.previewReplace, (_e, a: ReplaceOptions) => previewReplace(a))
  ipcMain.handle(INVOKE.applyReplace, (_e, a: ReplaceOptions & { paths: string[] }) =>
    applyReplace(a)
  )
  ipcMain.handle(
    INVOKE.formatFile,
    (_e, a: { root: string; path: string; content: string }) =>
      formatFile(a.root, a.path, a.content)
  )
  ipcMain.handle(INVOKE.canFormat, (_e, a: { root: string; path: string }) =>
    canFormat(a.root, a.path)
  )

  ipcMain.handle(
    INVOKE.runDiagnostics,
    (_e, a: { root: string; source: 'typescript' | 'eslint' }) => diagnostics.run(a.root, a.source)
  )
  ipcMain.handle(INVOKE.stopDiagnostics, () => diagnostics.stop())
  ipcMain.handle(INVOKE.getDiagnostics, () => diagnostics.getState())
  ipcMain.handle(INVOKE.fileSymbols, (_e, a: { language: string; content: string }) =>
    symbolsFor(a.language, a.content)
  )

  ipcMain.handle(INVOKE.editSelection, (_e, a: EditSelectionOptions) => editSelection(a))
  ipcMain.handle(INVOKE.explainSelection, (_e, a: ExplainOptions) => explainSelection(a))
  ipcMain.handle(INVOKE.suggestCommit, (_e, a: { root: string; model?: string }) =>
    suggestCommitMessage(a.root, a.model)
  )
  ipcMain.handle(INVOKE.reviewStaged, (_e, a: { root: string; model?: string }) =>
    reviewStagedDiff(a.root, a.model)
  )

  ipcMain.handle(INVOKE.lspComplete, (_e, a) => lsp.complete(a))
  ipcMain.handle(INVOKE.lspDefinition, (_e, a) => lsp.definition(a))
  ipcMain.handle(INVOKE.lspHover, (_e, a) => lsp.hover(a))
  ipcMain.handle(INVOKE.lspRename, (_e, a) => lsp.rename(a))
  ipcMain.handle(INVOKE.lspStatus, (_e, root: string) => lsp.status(root))

  ipcMain.handle(INVOKE.debugStart, (_e, opts) => debugSession.start(opts))
  ipcMain.handle(INVOKE.debugStop, () => debugSession.stop())
  ipcMain.handle(INVOKE.debugBreakpoint, (_e, { path, line }) =>
    debugSession.toggleBreakpoint(path, line)
  )
  ipcMain.handle(INVOKE.debugBreakpoints, () => debugSession.listBreakpoints())
  ipcMain.handle(INVOKE.debugResume, () => debugSession.resume())
  ipcMain.handle(INVOKE.debugStep, (_e, kind: 'over' | 'into' | 'out') => {
    if (kind === 'into') return debugSession.stepInto()
    if (kind === 'out') return debugSession.stepOut()
    return debugSession.stepOver()
  })
  ipcMain.handle(INVOKE.debugScopes, (_e, frameId: string) => debugSession.scopes(frameId))
  ipcMain.handle(INVOKE.debugVariables, (_e, objectId: string) => debugSession.variables(objectId))
  ipcMain.handle(INVOKE.debugEvaluate, (_e, { frameId, expression }) =>
    debugSession.evaluate(frameId, expression)
  )

  ipcMain.handle(INVOKE.termAvailable, () => ({
    available: terminals.available,
    error: terminals.loadError
  }))
  ipcMain.handle(INVOKE.termCreate, (_e, a: { cwd: string; cols: number; rows: number }) =>
    terminals.create(a)
  )
  ipcMain.handle(INVOKE.termWrite, (_e, a: { id: string; data: string }) =>
    terminals.write(a.id, a.data)
  )
  ipcMain.handle(INVOKE.termResize, (_e, a: { id: string; cols: number; rows: number }) =>
    terminals.resize(a.id, a.cols, a.rows)
  )
  ipcMain.handle(INVOKE.termClose, (_e, id: string) => terminals.close(id))
  ipcMain.handle(INVOKE.termList, () => terminals.list())
  ipcMain.handle(INVOKE.termBuffer, (_e, id: string) => terminals.getBuffer(id))

  ipcMain.handle(INVOKE.listScripts, (_e, root: string) => listScripts(root))
  ipcMain.handle(INVOKE.startTask, (_e, a: { root: string; script: string }) =>
    tasks.start(a.root, a.script)
  )
  ipcMain.handle(INVOKE.stopTask, (_e, id: string) => tasks.stop(id))
  ipcMain.handle(INVOKE.taskOutput, (_e, id: string) => tasks.getOutput(id))
  ipcMain.handle(INVOKE.listTasks, () => tasks.list())
  ipcMain.handle(INVOKE.forgetTask, (_e, id: string) => tasks.forget(id))

  ipcMain.handle(INVOKE.getNote, (_e, sessionId: string) => getNote(sessionId))
  ipcMain.handle(INVOKE.saveNote, (_e, a: { sessionId: string; text: string }) =>
    saveNote(a.sessionId, a.text)
  )
  ipcMain.handle(INVOKE.toggleBookmark, (_e, a: { sessionId: string; messageUuid: string }) =>
    toggleBookmark(a.sessionId, a.messageUuid)
  )

  ipcMain.handle(
    INVOKE.exportSession,
    async (_e, a: { filePath: string; projectPath: string; encodedDir: string }) => {
      if (!mainWindow) return undefined
      const payload = await loadTranscript(a)
      const note = await getNote(payload.meta.sessionId)
      const markdown = toMarkdown(payload.meta, payload.messages, note)

      // Name taken from the session title, stripped of filesystem-hostile characters.
      const safeName = payload.meta.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60)
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Export session',
        defaultPath: `${safeName || payload.meta.sessionId}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })
      if (result.canceled || !result.filePath) return undefined

      await writeFile(result.filePath, markdown, 'utf8')
      return result.filePath
    }
  )

  ipcMain.handle(
    INVOKE.gitRemote,
    (
      _e,
      a: {
        root: string
        operation: RemoteOperation
        opts?: { setUpstream?: boolean; branch?: string; force?: boolean }
      }
    ) => gitRemote.run(a.root, a.operation, a.opts)
  )
  ipcMain.handle(INVOKE.gitCancelRemote, () => gitRemote.cancel())

  ipcMain.handle(INVOKE.stashList, (_e, root: string) => listStash(root))
  ipcMain.handle(INVOKE.stashSave, (_e, a: { root: string; message?: string }) =>
    stashSave(a.root, a.message)
  )
  ipcMain.handle(INVOKE.stashApply, (_e, a: { root: string; index: number; drop: boolean }) =>
    stashApply(a.root, a.index, a.drop)
  )
  ipcMain.handle(INVOKE.stashDrop, (_e, a: { root: string; index: number }) =>
    stashDrop(a.root, a.index)
  )

  ipcMain.handle(INVOKE.diffBranches, (_e, a: { root: string; base: string; head: string }) =>
    diffBranches(a.root, a.base, a.head)
  )
  ipcMain.handle(
    INVOKE.diffBranchFile,
    (_e, a: { root: string; base: string; head: string; path: string }) =>
      diffBranchFile(a.root, a.base, a.head, a.path)
  )

  ipcMain.handle(INVOKE.readConflict, (_e, a: { root: string; path: string }) =>
    readConflictFile(a.root, a.path)
  )
  ipcMain.handle(
    INVOKE.writeConflict,
    (_e, a: { root: string; path: string; content: string }) =>
      writeConflictFile(a.root, a.path, a.content)
  )
  ipcMain.handle(INVOKE.markResolved, (_e, a: { root: string; path: string }) =>
    markResolved(a.root, a.path)
  )

  ipcMain.handle(INVOKE.ghStatus, (_e, root: string) => ghStatus(root))
  ipcMain.handle(INVOKE.ghList, (_e, root: string) => listPullRequests(root))
  ipcMain.handle(INVOKE.ghCurrent, (_e, root: string) => currentPullRequest(root))
  ipcMain.handle(
    INVOKE.ghCreate,
    (_e, a: { root: string; opts: { title: string; body: string; draft?: boolean; base?: string } }) =>
      createPullRequest(a.root, a.opts)
  )

  ipcMain.handle(INVOKE.gitStatus, (_e, root: string) => git.status(root))
  ipcMain.handle(INVOKE.gitDiff, (_e, a: { root: string; path: string; staged: boolean }) =>
    git.diffFile(a.root, a.path, a.staged)
  )
  ipcMain.handle(INVOKE.gitStage, (_e, a: { root: string; paths: string[] }) =>
    attempt(() => git.stage(a.root, a.paths))
  )
  ipcMain.handle(INVOKE.gitUnstage, (_e, a: { root: string; paths: string[] }) =>
    attempt(() => git.unstage(a.root, a.paths))
  )
  ipcMain.handle(INVOKE.gitDiscard, (_e, a: { root: string; paths: string[] }) =>
    attempt(() => git.discard(a.root, a.paths))
  )
  ipcMain.handle(
    INVOKE.gitCommit,
    (_e, a: { root: string; message: string; amend: boolean }) =>
      git.commit(a.root, a.message, { amend: a.amend })
  )
  ipcMain.handle(INVOKE.gitLog, (_e, a: { root: string; limit: number }) =>
    git.log(a.root, a.limit)
  )
  ipcMain.handle(INVOKE.gitBranches, (_e, root: string) => git.branches(root))
  ipcMain.handle(INVOKE.gitCheckout, (_e, a: { root: string; branch: string; create: boolean }) =>
    git.checkout(a.root, a.branch, { create: a.create })
  )
  ipcMain.handle(INVOKE.gitShow, (_e, a: { root: string; hash: string }) =>
    git.showCommit(a.root, a.hash)
  )
  ipcMain.handle(INVOKE.gitBlame, (_e, a: { root: string; path: string }) =>
    git.blame(a.root, a.path)
  )

  ipcMain.handle(INVOKE.listWorkspaces, () => listWorkspaces())
  ipcMain.handle(INVOKE.detectEditors, () => detectEditors())
  ipcMain.handle(INVOKE.listSkills, () => listSkills())
  ipcMain.handle(INVOKE.openInEditor, async (_e, args: { editorId: string; path: string }) => {
    try {
      await openInEditor(args.editorId, args.path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(INVOKE.pickDirectory, async () => {
    if (!mainWindow) return undefined
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a working directory',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Choose'
    })
    return result.canceled ? undefined : result.filePaths[0]
  })

  ipcMain.handle(INVOKE.stopProcess, (_e, pid: number) => stopProcess(pid))
  ipcMain.handle(INVOKE.revealInFinder, (_e, path: string) => revealInFinder(path))
  ipcMain.handle(INVOKE.openFolder, async (_e, path: string) => {
    const error = await openPath(path)
    return error ? { ok: false, error } : { ok: true }
  })
}

/**
 * Notifies while the window is unfocused. Long turns are easy to miss: the window
 * may be on another desktop or behind other applications.
 */
function notifyIfHidden(title: string, body: string): void {
  if (!Notification.isSupported()) return
  if (mainWindow?.isFocused()) return

  const notification = new Notification({ title, body, silent: false })
  notification.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  notification.show()
}

/** Short task summary for a notification. */
function describeSummary(state: TaskState): string {
  const s = state.summary
  if (!s) return state.root.split('/').at(-1) ?? ''
  const parts: string[] = []
  if (s.passed !== undefined) parts.push(`${s.passed} passed`)
  if (s.failed) parts.push(`${s.failed} failed`)
  if (s.problems) parts.push(`${s.problems} problems`)
  return parts.join(', ') || (state.root.split('/').at(-1) ?? '')
}

function wireChatEvents(): void {
  const send = (channel: string, payload: unknown): void => {
    mainWindow?.webContents.send(channel, payload)
  }
  chat.on('event', (payload: { tabId: string; event: ChatStreamEvent }) =>
    send(EVENT.chatEvent, payload)
  )
  chat.on('state', (payload: { tabId: string; state: ChatState }) =>
    send(EVENT.chatState, payload)
  )
  chat.on('permission', (payload: { tabId: string; request: PermissionRequest }) => {
    send(EVENT.chatPermission, payload)
    // The CLI process is blocked waiting for a decision — that needs to be known now.
    notifyIfHidden('Permission needed', `Claude wants to run ${payload.request.toolName}`)
  })
  chat.on(
    'result',
    (payload: {
      result: { is_error?: boolean; total_cost_usd?: number }
      meta?: { interrupted?: boolean }
    }) => {
      // A turn the user stopped arrives as an error; notifying about it is noise.
      if (payload.meta?.interrupted) return
      const cost = payload.result.total_cost_usd
        ? ` · $${payload.result.total_cost_usd.toFixed(3)}`
        : ''
      notifyIfHidden(
        payload.result.is_error ? 'Turn ended with an error' : 'Claude is done',
        `Ready to continue${cost}`
      )
    }
  )
  // Stream limits add an exact reset time to the percentages from plan-usage-history.json.
  chat.on('rateLimit', (info: RateLimitEventInfo) => rateLimits.applyEvent(info))

  terminals.on('data', (chunk: TerminalChunk) => send(EVENT.termData, chunk))
  terminals.on('exit', (info: TerminalInfo) => send(EVENT.termExit, info))

  diagnostics.on('state', (state: DiagnosticsState) => send(EVENT.diagnosticsState, state))
  debugSession.on('state', (state: DebugState) => send(EVENT.debugState, state))
  gitRemote.on('progress', (text: string) => send(EVENT.gitRemoteProgress, text))

  tasks.on('chunk', (chunk: TaskChunk) => send(EVENT.taskChunk, chunk))
  tasks.on('state', (state: TaskState) => {
    send(EVENT.taskState, state)
    if (state.running) return
    const label = state.exitCode === 0 ? 'Done' : `Failed (code ${state.exitCode})`
    notifyIfHidden(`${state.script}: ${label}`, describeSummary(state))
  })
}

/**
 * Transcripts are appended to constantly, so notifications are debounced —
 * otherwise every written line during an active session would trigger a full
 * rescan of all projects. 1.5s is the compromise: the list stays live without
 * rebuilding dozens of times a minute while the CLI works alongside.
 */
function startWatching(): void {
  let timer: NodeJS.Timeout | undefined
  const notify = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => mainWindow?.webContents.send(EVENT.sessionsChanged), 1500)
  }

  watcher = chokidar.watch(PROJECTS_DIR, {
    ignoreInitial: true,
    depth: 3,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  })
  watcher.on('add', notify).on('change', notify).on('unlink', notify)
}

void app.whenReady().then(async () => {
  registerIpc()
  await rateLimits.start()
  rateLimits.onChange((state) => mainWindow?.webContents.send(EVENT.rateLimits, state))

  wireChatEvents()
  createWindow()
  startWatching()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void watcher?.close()
  rateLimits.stop()
  // A running CLI process must be closed properly so it finishes the transcript.
  void chat.stopAll()
  tasks.stopAll()
  terminals.closeAll()
  diagnostics.stop()
  void lsp.stopAll()
  void debugSession.stop()
})
