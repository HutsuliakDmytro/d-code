import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  EVENT,
  INVOKE,
  type ChatState,
  type ChatStreamEvent,
  type ClaudeUIApi,
  type PermissionRequest,
  type TaskChunk,
  type TaskState,
  type TerminalChunk,
  type TerminalInfo,
  type DiagnosticsState,
  type DebugState,
  type RemoteState
} from '@shared/ipc'
import type { RateLimitState } from '@shared/types'

/**
 * The renderer has no Node access. All file reads and process spawning live in
 * main; only a narrow typed API is exposed here.
 */
const api: ClaudeUIApi = {
  listSessions: () => ipcRenderer.invoke(INVOKE.listSessions),
  readTranscript: (filePath, projectPath, encodedDir) =>
    ipcRenderer.invoke(INVOKE.readTranscript, { filePath, projectPath, encodedDir }),
  readSubagent: (filePath, projectPath, encodedDir) =>
    ipcRenderer.invoke(INVOKE.readSubagent, { filePath, projectPath, encodedDir }),
  getRateLimits: () => ipcRenderer.invoke(INVOKE.rateLimits),
  refreshRateLimits: () => ipcRenderer.invoke(INVOKE.refreshRateLimits),
  getAppInfo: () => ipcRenderer.invoke(INVOKE.appInfo),

  chatStart: (tabId, opts) => ipcRenderer.invoke(INVOKE.chatStart, { tabId, opts }),
  chatSend: (tabId, text, attachments) =>
    ipcRenderer.invoke(INVOKE.chatSend, { tabId, text, attachments }),
  chatInterrupt: (tabId) => ipcRenderer.invoke(INVOKE.chatInterrupt, tabId),
  chatClose: (tabId) => ipcRenderer.invoke(INVOKE.chatClose, tabId),
  replyPermission: (tabId, requestId, reply) =>
    ipcRenderer.invoke(INVOKE.chatPermissionReply, { tabId, requestId, reply }),

  listWorkspaces: () => ipcRenderer.invoke(INVOKE.listWorkspaces),
  pickDirectory: () => ipcRenderer.invoke(INVOKE.pickDirectory),
  detectEditors: () => ipcRenderer.invoke(INVOKE.detectEditors),
  openInEditor: (editorId, path) => ipcRenderer.invoke(INVOKE.openInEditor, { editorId, path }),
  listSkills: () => ipcRenderer.invoke(INVOKE.listSkills),

  searchTranscripts: (query, includeTools) =>
    ipcRenderer.invoke(INVOKE.searchTranscripts, { query, includeTools }),
  listChangedFiles: (transcriptPath, sessionId) =>
    ipcRenderer.invoke(INVOKE.changedFiles, { transcriptPath, sessionId }),
  getFileDiff: (sessionId, backupFileName, path) =>
    ipcRenderer.invoke(INVOKE.fileDiff, { sessionId, backupFileName, path }),
  restoreFile: (opts) => ipcRenderer.invoke(INVOKE.restoreFile, opts),
  writeFileContent: (path, content) => ipcRenderer.invoke(INVOKE.writeFile, { path, content }),
  getActivityStats: (days) => ipcRenderer.invoke(INVOKE.activityStats, days),
  pickFiles: () => ipcRenderer.invoke(INVOKE.pickFiles),
  readAttachment: (path) => ipcRenderer.invoke(INVOKE.readAttachment, path),
  // The only way to learn a dropped file's path: Electron removed File.path.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  listDirectory: (root, dirPath) => ipcRenderer.invoke(INVOKE.listDirectory, { root, dirPath }),
  readTextFile: (path) => ipcRenderer.invoke(INVOKE.readTextFile, path),
  searchCode: (root, query, caseSensitive) =>
    ipcRenderer.invoke(INVOKE.searchCode, { root, query, caseSensitive }),

  gitStatus: (root) => ipcRenderer.invoke(INVOKE.gitStatus, root),
  gitDiff: (root, path, staged) => ipcRenderer.invoke(INVOKE.gitDiff, { root, path, staged }),
  gitStage: (root, paths) => ipcRenderer.invoke(INVOKE.gitStage, { root, paths }),
  gitUnstage: (root, paths) => ipcRenderer.invoke(INVOKE.gitUnstage, { root, paths }),
  gitDiscard: (root, paths) => ipcRenderer.invoke(INVOKE.gitDiscard, { root, paths }),
  gitCommit: (root, message, amend) =>
    ipcRenderer.invoke(INVOKE.gitCommit, { root, message, amend }),
  gitLog: (root, limit) => ipcRenderer.invoke(INVOKE.gitLog, { root, limit }),
  gitBranches: (root) => ipcRenderer.invoke(INVOKE.gitBranches, root),
  gitCheckout: (root, branch, create) =>
    ipcRenderer.invoke(INVOKE.gitCheckout, { root, branch, create }),
  gitShow: (root, hash) => ipcRenderer.invoke(INVOKE.gitShow, { root, hash }),
  gitBlame: (root, path) => ipcRenderer.invoke(INVOKE.gitBlame, { root, path }),
  promptHistory: (project) => ipcRenderer.invoke(INVOKE.promptHistory, project),
  projectFiles: (root) => ipcRenderer.invoke(INVOKE.projectFiles, root),
  listMcpServers: () => ipcRenderer.invoke(INVOKE.mcpServers),
  listHooks: (projectRoot) => ipcRenderer.invoke(INVOKE.hooks, projectRoot),
  listPlugins: () => ipcRenderer.invoke(INVOKE.plugins),
  listAgentTypes: () => ipcRenderer.invoke(INVOKE.agentTypes),

  remoteStatus: () => ipcRenderer.invoke(INVOKE.remoteStatus),
  remoteStart: (port) => ipcRenderer.invoke(INVOKE.remoteStart, port),
  remoteStop: () => ipcRenderer.invoke(INVOKE.remoteStop),
  remoteNewCode: () => ipcRenderer.invoke(INVOKE.remoteNewCode),
  remoteTunnelStart: (provider, custom) =>
    ipcRenderer.invoke(INVOKE.remoteTunnelStart, { provider, custom }),
  remoteTunnelStop: () => ipcRenderer.invoke(INVOKE.remoteTunnelStop),
  remoteQrCodes: () => ipcRenderer.invoke(INVOKE.remoteQrCodes),
  onRemoteState(fn) {
    const handler = (_e: unknown, state: RemoteState): void => fn(state)
    ipcRenderer.on(EVENT.remoteState, handler)
    return () => ipcRenderer.off(EVENT.remoteState, handler)
  },

  settingsScopes: (projectRoot) => ipcRenderer.invoke(INVOKE.settingsScopes, projectRoot),
  addHook: (scope, input, projectRoot) =>
    ipcRenderer.invoke(INVOKE.addHook, { scope, input, projectRoot }),
  removeHook: (scope, input, projectRoot) =>
    ipcRenderer.invoke(INVOKE.removeHook, { scope, input, projectRoot }),
  addMcpServer: (input) => ipcRenderer.invoke(INVOKE.addMcpServer, input),
  removeMcpServer: (name, scope) => ipcRenderer.invoke(INVOKE.removeMcpServer, { name, scope }),
  openSettingsFile: (scope, projectRoot) =>
    ipcRenderer.invoke(INVOKE.openSettingsFile, { scope, projectRoot }),

  listWorktrees: (root) => ipcRenderer.invoke(INVOKE.listWorktrees, root),
  addWorktree: (root, input) => ipcRenderer.invoke(INVOKE.addWorktree, { root, input }),
  removeWorktree: (root, path, force) =>
    ipcRenderer.invoke(INVOKE.removeWorktree, { root, path, force }),
  pruneWorktrees: (root) => ipcRenderer.invoke(INVOKE.pruneWorktrees, root),
  getNote: (sessionId) => ipcRenderer.invoke(INVOKE.getNote, sessionId),
  saveNote: (sessionId, text) => ipcRenderer.invoke(INVOKE.saveNote, { sessionId, text }),
  toggleBookmark: (sessionId, messageUuid) =>
    ipcRenderer.invoke(INVOKE.toggleBookmark, { sessionId, messageUuid }),
  exportSession: (filePath, projectPath, encodedDir, options) =>
    ipcRenderer.invoke(INVOKE.exportSession, { filePath, projectPath, encodedDir, options }),

  listScripts: (root) => ipcRenderer.invoke(INVOKE.listScripts, root),
  startTask: (root, script) => ipcRenderer.invoke(INVOKE.startTask, { root, script }),
  stopTask: (id) => ipcRenderer.invoke(INVOKE.stopTask, id),
  getTaskOutput: (id) => ipcRenderer.invoke(INVOKE.taskOutput, id),
  listTasks: () => ipcRenderer.invoke(INVOKE.listTasks),
  forgetTask: (id) => ipcRenderer.invoke(INVOKE.forgetTask, id),
  listCheckpoints: (transcriptPath) => ipcRenderer.invoke(INVOKE.listCheckpoints, transcriptPath),
  restoreCheckpoint: (sessionId, files) =>
    ipcRenderer.invoke(INVOKE.restoreCheckpoint, { sessionId, files }),
  compareSessions: (left, right) => ipcRenderer.invoke(INVOKE.compareSessions, { left, right }),

  terminalAvailable: () => ipcRenderer.invoke(INVOKE.termAvailable),
  terminalCreate: (cwd, cols, rows) => ipcRenderer.invoke(INVOKE.termCreate, { cwd, cols, rows }),
  terminalWrite: (id, data) => ipcRenderer.invoke(INVOKE.termWrite, { id, data }),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke(INVOKE.termResize, { id, cols, rows }),
  terminalClose: (id) => ipcRenderer.invoke(INVOKE.termClose, id),
  terminalList: () => ipcRenderer.invoke(INVOKE.termList),
  terminalBuffer: (id) => ipcRenderer.invoke(INVOKE.termBuffer, id),

  createFile: (root, dirPath, name) =>
    ipcRenderer.invoke(INVOKE.createFile, { root, dirPath, name }),
  createDirectory: (root, dirPath, name) =>
    ipcRenderer.invoke(INVOKE.createDir, { root, dirPath, name }),
  renamePath: (root, path, newName) =>
    ipcRenderer.invoke(INVOKE.renamePath, { root, path, newName }),
  trashPath: (root, path) => ipcRenderer.invoke(INVOKE.trashPath, { root, path }),
  movePath: (root, path, targetDir) =>
    ipcRenderer.invoke(INVOKE.movePath, { root, path, targetDir }),

  previewReplace: (opts) => ipcRenderer.invoke(INVOKE.previewReplace, opts),
  applyReplace: (opts) => ipcRenderer.invoke(INVOKE.applyReplace, opts),
  formatFile: (root, path, content) =>
    ipcRenderer.invoke(INVOKE.formatFile, { root, path, content }),
  canFormat: (root, path) => ipcRenderer.invoke(INVOKE.canFormat, { root, path }),

  runDiagnostics: (root, source) => ipcRenderer.invoke(INVOKE.runDiagnostics, { root, source }),
  stopDiagnostics: () => ipcRenderer.invoke(INVOKE.stopDiagnostics),
  getDiagnostics: () => ipcRenderer.invoke(INVOKE.getDiagnostics),
  fileSymbols: (language, content) =>
    ipcRenderer.invoke(INVOKE.fileSymbols, { language, content }),

  editSelection: (opts) => ipcRenderer.invoke(INVOKE.editSelection, opts),
  explainSelection: (opts) => ipcRenderer.invoke(INVOKE.explainSelection, opts),
  suggestCommitMessage: (root, model) =>
    ipcRenderer.invoke(INVOKE.suggestCommit, { root, model }),
  reviewStagedDiff: (root, model) => ipcRenderer.invoke(INVOKE.reviewStaged, { root, model }),

  gitRemote: (root, operation, opts) =>
    ipcRenderer.invoke(INVOKE.gitRemote, { root, operation, opts }),
  gitCancelRemote: () => ipcRenderer.invoke(INVOKE.gitCancelRemote),
  onRemoteProgress(fn) {
    const handler = (_e: unknown, text: string): void => fn(text)
    ipcRenderer.on(EVENT.gitRemoteProgress, handler)
    return () => ipcRenderer.off(EVENT.gitRemoteProgress, handler)
  },

  listStash: (root) => ipcRenderer.invoke(INVOKE.stashList, root),
  stashSave: (root, message) => ipcRenderer.invoke(INVOKE.stashSave, { root, message }),
  stashApply: (root, index, drop) =>
    ipcRenderer.invoke(INVOKE.stashApply, { root, index, drop }),
  stashDrop: (root, index) => ipcRenderer.invoke(INVOKE.stashDrop, { root, index }),

  diffBranches: (root, base, head) =>
    ipcRenderer.invoke(INVOKE.diffBranches, { root, base, head }),
  diffBranchFile: (root, base, head, path) =>
    ipcRenderer.invoke(INVOKE.diffBranchFile, { root, base, head, path }),

  readConflictFile: (root, path) => ipcRenderer.invoke(INVOKE.readConflict, { root, path }),
  writeConflictFile: (root, path, content) =>
    ipcRenderer.invoke(INVOKE.writeConflict, { root, path, content }),
  markResolved: (root, path) => ipcRenderer.invoke(INVOKE.markResolved, { root, path }),

  ghStatus: (root) => ipcRenderer.invoke(INVOKE.ghStatus, root),
  listPullRequests: (root) => ipcRenderer.invoke(INVOKE.ghList, root),
  currentPullRequest: (root) => ipcRenderer.invoke(INVOKE.ghCurrent, root),
  createPullRequest: (root, opts) => ipcRenderer.invoke(INVOKE.ghCreate, { root, opts }),

  lspComplete: (opts) => ipcRenderer.invoke(INVOKE.lspComplete, opts),
  lspDefinition: (opts) => ipcRenderer.invoke(INVOKE.lspDefinition, opts),
  lspHover: (opts) => ipcRenderer.invoke(INVOKE.lspHover, opts),
  lspRename: (opts) => ipcRenderer.invoke(INVOKE.lspRename, opts),
  lspStatus: (root) => ipcRenderer.invoke(INVOKE.lspStatus, root),

  debugStart: (opts) => ipcRenderer.invoke(INVOKE.debugStart, opts),
  debugStop: () => ipcRenderer.invoke(INVOKE.debugStop),
  debugBreakpoint: (path, line) => ipcRenderer.invoke(INVOKE.debugBreakpoint, { path, line }),
  debugBreakpoints: () => ipcRenderer.invoke(INVOKE.debugBreakpoints),
  debugResume: () => ipcRenderer.invoke(INVOKE.debugResume),
  debugStep: (kind) => ipcRenderer.invoke(INVOKE.debugStep, kind),
  debugScopes: (frameId) => ipcRenderer.invoke(INVOKE.debugScopes, frameId),
  debugVariables: (objectId) => ipcRenderer.invoke(INVOKE.debugVariables, objectId),
  debugEvaluate: (frameId, expression) =>
    ipcRenderer.invoke(INVOKE.debugEvaluate, { frameId, expression }),
  onDebugState(fn) {
    const handler = (_e: unknown, state: DebugState): void => fn(state)
    ipcRenderer.on(EVENT.debugState, handler)
    return () => ipcRenderer.off(EVENT.debugState, handler)
  },
  onDiagnostics(fn) {
    const handler = (_e: unknown, state: DiagnosticsState): void => fn(state)
    ipcRenderer.on(EVENT.diagnosticsState, handler)
    return () => ipcRenderer.off(EVENT.diagnosticsState, handler)
  },
  setPermissionMode: (tabId, mode) =>
    ipcRenderer.invoke(INVOKE.chatSetPermissionMode, { tabId, mode }),
  setModel: (tabId, model) => ipcRenderer.invoke(INVOKE.chatSetModel, { tabId, model }),

  listLiveSessions: () => ipcRenderer.invoke(INVOKE.liveSessions),
  openInTerminal: (cwd, sessionId) =>
    ipcRenderer.invoke(INVOKE.openInTerminal, { cwd, sessionId }),
  startRemoteControl: (cwd, name) =>
    ipcRenderer.invoke(INVOKE.startRemoteControl, { cwd, name }),
  stopProcess: (pid) => ipcRenderer.invoke(INVOKE.stopProcess, pid),
  revealInFinder: (path) => ipcRenderer.invoke(INVOKE.revealInFinder, path),
  openFolder: (path) => ipcRenderer.invoke(INVOKE.openFolder, path),

  onSessionsChanged(fn) {
    const handler = (): void => fn()
    ipcRenderer.on(EVENT.sessionsChanged, handler)
    return () => ipcRenderer.off(EVENT.sessionsChanged, handler)
  },
  onRateLimits(fn) {
    const handler = (_e: unknown, state: RateLimitState): void => fn(state)
    ipcRenderer.on(EVENT.rateLimits, handler)
    return () => ipcRenderer.off(EVENT.rateLimits, handler)
  },
  onChatEvent(fn) {
    const handler = (_e: unknown, p: { tabId: string; event: ChatStreamEvent }): void =>
      fn(p.tabId, p.event)
    ipcRenderer.on(EVENT.chatEvent, handler)
    return () => ipcRenderer.off(EVENT.chatEvent, handler)
  },
  onChatPermission(fn) {
    const handler = (_e: unknown, p: { tabId: string; request: PermissionRequest }): void =>
      fn(p.tabId, p.request)
    ipcRenderer.on(EVENT.chatPermission, handler)
    return () => ipcRenderer.off(EVENT.chatPermission, handler)
  },
  onTerminalData(fn) {
    const handler = (_e: unknown, chunk: TerminalChunk): void => fn(chunk)
    ipcRenderer.on(EVENT.termData, handler)
    return () => ipcRenderer.off(EVENT.termData, handler)
  },
  onTerminalExit(fn) {
    const handler = (_e: unknown, info: TerminalInfo): void => fn(info)
    ipcRenderer.on(EVENT.termExit, handler)
    return () => ipcRenderer.off(EVENT.termExit, handler)
  },
  onTaskChunk(fn) {
    const handler = (_e: unknown, chunk: TaskChunk): void => fn(chunk)
    ipcRenderer.on(EVENT.taskChunk, handler)
    return () => ipcRenderer.off(EVENT.taskChunk, handler)
  },
  onTaskState(fn) {
    const handler = (_e: unknown, state: TaskState): void => fn(state)
    ipcRenderer.on(EVENT.taskState, handler)
    return () => ipcRenderer.off(EVENT.taskState, handler)
  },
  onChatState(fn) {
    const handler = (_e: unknown, p: { tabId: string; state: ChatState }): void =>
      fn(p.tabId, p.state)
    ipcRenderer.on(EVENT.chatState, handler)
    return () => ipcRenderer.off(EVENT.chatState, handler)
  }
}

contextBridge.exposeInMainWorld('claudeUI', api)
