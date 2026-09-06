import type {
  Attachment,
  ChatMessage,
  LiveSession,
  PermissionMode,
  RateLimitState,
  SessionMeta,
  UsageTotals
} from './types'

/** A session list entry: metadata plus totals including subagents. */
export interface SessionListItem {
  meta: SessionMeta
  usage: UsageTotals
  subagentCount: number
}

export interface TranscriptPayload {
  meta: SessionMeta
  messages: ChatMessage[]
  usage: UsageTotals
  subagents: SubagentRef[]
}

export interface SubagentRef {
  agentId: string
  /** Path to the branch's own transcript. */
  filePath: string
  agentType?: string
  description?: string
  toolUseId?: string
}

export interface ProjectGroup {
  projectPath: string
  encodedDir: string
  sessions: SessionListItem[]
  usage: UsageTotals
}

/** main → renderer channels (events). */
export const EVENT = {
  sessionsChanged: 'sessions:changed',
  rateLimits: 'rate-limits:changed',
  chatEvent: 'chat:event',
  chatPermission: 'chat:permission',
  chatState: 'chat:state',
  taskChunk: 'task:chunk',
  taskState: 'task:state',
  diagnosticsState: 'diag:state',
  gitRemoteProgress: 'git:remote-progress',
  termData: 'term:data',
  termExit: 'term:exit',
  debugState: 'debug:state'
} as const

/** renderer → main channels (requests). */
export const INVOKE = {
  listSessions: 'sessions:list',
  readTranscript: 'sessions:read',
  readSubagent: 'sessions:read-subagent',
  rateLimits: 'rate-limits:get',
  refreshRateLimits: 'rate-limits:refresh',
  appInfo: 'app:info',
  chatStart: 'chat:start',
  chatSend: 'chat:send',
  chatInterrupt: 'chat:interrupt',
  chatStop: 'chat:stop',
  chatClose: 'chat:close',
  chatPermissionReply: 'chat:permission-reply',
  chatSetPermissionMode: 'chat:set-permission-mode',
  chatSetModel: 'chat:set-model',
  liveSessions: 'sessions:live',
  openInTerminal: 'session:open-terminal',
  startRemoteControl: 'session:start-remote-control',
  stopProcess: 'session:stop-process',
  revealInFinder: 'session:reveal',
  openFolder: 'session:open-folder',
  listWorkspaces: 'workspace:list',
  pickDirectory: 'workspace:pick',
  detectEditors: 'workspace:editors',
  openInEditor: 'workspace:open-in-editor',
  listSkills: 'workspace:skills',
  searchTranscripts: 'search:transcripts',
  changedFiles: 'files:changed',
  fileDiff: 'files:diff',
  restoreFile: 'files:restore',
  writeFile: 'files:write',
  activityStats: 'stats:activity',
  pickFiles: 'files:pick',
  readAttachment: 'files:read-attachment',
  listDirectory: 'fs:list',
  readTextFile: 'fs:read',
  searchCode: 'fs:search-code',
  gitStatus: 'git:status',
  gitDiff: 'git:diff',
  gitStage: 'git:stage',
  gitUnstage: 'git:unstage',
  gitDiscard: 'git:discard',
  gitCommit: 'git:commit',
  gitLog: 'git:log',
  gitBranches: 'git:branches',
  gitCheckout: 'git:checkout',
  gitShow: 'git:show',
  gitBlame: 'git:blame',
  promptHistory: 'prompts:history',
  projectFiles: 'fs:project-files',
  mcpServers: 'ext:mcp',
  hooks: 'ext:hooks',
  plugins: 'ext:plugins',
  agentTypes: 'ext:agents',
  getNote: 'notes:get',
  saveNote: 'notes:save',
  toggleBookmark: 'notes:bookmark',
  exportSession: 'notes:export',
  listScripts: 'task:scripts',
  startTask: 'task:start',
  stopTask: 'task:stop',
  taskOutput: 'task:output',
  listTasks: 'task:list',
  forgetTask: 'task:forget',
  listCheckpoints: 'checkpoint:list',
  restoreCheckpoint: 'checkpoint:restore',
  compareSessions: 'session:compare',
  termCreate: 'term:create',
  termWrite: 'term:write',
  termResize: 'term:resize',
  termClose: 'term:close',
  termList: 'term:list',
  termBuffer: 'term:buffer',
  termAvailable: 'term:available',
  createFile: 'fs:create-file',
  createDir: 'fs:create-dir',
  renamePath: 'fs:rename',
  trashPath: 'fs:trash',
  movePath: 'fs:move',
  previewReplace: 'fs:preview-replace',
  applyReplace: 'fs:apply-replace',
  formatFile: 'fs:format',
  canFormat: 'fs:can-format',
  runDiagnostics: 'diag:run',
  stopDiagnostics: 'diag:stop',
  getDiagnostics: 'diag:get',
  fileSymbols: 'code:symbols',
  editSelection: 'code:edit-selection',
  explainSelection: 'code:explain',
  suggestCommit: 'code:commit-message',
  reviewStaged: 'code:review-staged',
  gitRemote: 'git:remote',
  gitCancelRemote: 'git:remote-cancel',
  stashList: 'git:stash-list',
  stashSave: 'git:stash-save',
  stashApply: 'git:stash-apply',
  stashDrop: 'git:stash-drop',
  diffBranches: 'git:diff-branches',
  diffBranchFile: 'git:diff-branch-file',
  readConflict: 'git:read-conflict',
  writeConflict: 'git:write-conflict',
  markResolved: 'git:mark-resolved',
  ghStatus: 'gh:status',
  ghList: 'gh:list',
  ghCurrent: 'gh:current',
  ghCreate: 'gh:create',
  lspComplete: 'lsp:complete',
  lspDefinition: 'lsp:definition',
  lspHover: 'lsp:hover',
  lspRename: 'lsp:rename',
  lspStatus: 'lsp:status',
  debugStart: 'debug:start',
  debugStop: 'debug:stop',
  debugBreakpoint: 'debug:breakpoint',
  debugBreakpoints: 'debug:breakpoints',
  debugResume: 'debug:resume',
  debugStep: 'debug:step',
  debugScopes: 'debug:scopes',
  debugVariables: 'debug:variables',
  debugEvaluate: 'debug:evaluate'
} as const

export interface CompletionItem {
  label: string
  detail?: string
  kind?: number
  insertText?: string
}

export interface LspLocation {
  path: string
  line: number
  column: number
}

export interface RenameEdit {
  path: string
  line: number
  column: number
  endLine: number
  endColumn: number
  newText: string
}

export interface LspStatus {
  available: boolean
  ready: boolean
  error?: string
}

export interface Breakpoint {
  path: string
  line: number
}

export interface DebugStackFrame {
  id: string
  name: string
  path?: string
  line: number
  column: number
}

export interface DebugScope {
  name: string
  objectId?: string
}

export interface DebugVariable {
  name: string
  value: string
  type?: string
  objectId?: string
}

export interface DebugState {
  running: boolean
  paused: boolean
  reason?: string
  frames: DebugStackFrame[]
  error?: string
  output: string
}

/** Fields shared by language-server requests. */
export interface LspPosition {
  root: string
  path: string
  language: string
  content: string
  line: number
  column: number
}

export interface RemoteOpResult {
  ok: boolean
  output: string
  error?: string
}

export interface StashEntry {
  index: number
  label: string
  branch?: string
  date?: string
}

export interface BranchDiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  added: number
  removed: number
}

export interface ConflictBlock {
  index: number
  startLine: number
  endLine: number
  ours: string
  theirs: string
  oursLabel: string
  theirsLabel: string
}

export interface GhStatus {
  available: boolean
  authenticated: boolean
  error?: string
}

export interface PullRequest {
  number: number
  title: string
  state: string
  isDraft: boolean
  url: string
  author?: string
  checks?: string
  headRefName?: string
  baseRefName?: string
}

export interface QuickAskResult {
  ok: boolean
  text?: string
  costUsd?: number
  durationMs?: number
  error?: string
}

export interface EditSelectionResult extends QuickAskResult {
  code?: string
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  path: string
  relativePath: string
  line: number
  column: number
  severity: DiagnosticSeverity
  code?: string
  message: string
  source: 'typescript' | 'eslint'
}

export interface DiagnosticsState {
  running: boolean
  source?: 'typescript' | 'eslint'
  diagnostics: Diagnostic[]
  finishedAt?: number
  error?: string
}

export interface CodeSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'method' | 'enum' | 'widget'
  line: number
  depth: number
}

export interface OpResult {
  ok: boolean
  error?: string
  path?: string
}

export interface ReplacePreviewFile {
  path: string
  relativePath: string
  count: number
  samples: Array<{ line: number; before: string; after: string }>
}

export interface ReplacePreview {
  files: ReplacePreviewFile[]
  total: number
  error?: string
}

export interface ReplaceResult {
  ok: boolean
  changedFiles: number
  replacements: number
  failed: Array<{ path: string; error: string }>
}

export interface FormatResult {
  ok: boolean
  content?: string
  tool?: string
  error?: string
}

export interface TerminalInfo {
  id: string
  title: string
  cwd: string
  cols: number
  rows: number
  running: boolean
  exitCode?: number
}

export interface TerminalChunk {
  id: string
  data: string
}

// --- Checkpoints and branch comparison ---

export interface CheckpointFile {
  path: string
  displayPath: string
  backupFileName: string | null
  version: number
}

export interface Checkpoint {
  messageId: string
  timestamp: string
  label?: string
  files: CheckpointFile[]
}

export interface RestoreResult {
  ok: boolean
  restored: string[]
  failed: Array<{ path: string; error: string }>
  previous: Record<string, string>
}

export interface ComparedMessage {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: string
  toolNames: string[]
}

export interface SessionComparison {
  commonLength: number
  divergedAt?: ComparedMessage
  left: ComparedMessage[]
  right: ComparedMessage[]
  isPrefix: boolean
}

export interface ScriptEntry {
  name: string
  command: string
  kind: 'test' | 'build' | 'dev' | 'lint' | 'other'
}

export interface TaskSummary {
  passed?: number
  failed?: number
  skipped?: number
  problems?: number
}

export interface TaskState {
  id: string
  script: string
  root: string
  running: boolean
  exitCode?: number | null
  startedAt: number
  finishedAt?: number
  summary?: TaskSummary
}

export interface TaskChunk {
  id: string
  stream: 'stdout' | 'stderr'
  text: string
}

export interface SessionNote {
  text: string
  bookmarks: string[]
  updatedAt: number
}

// ─── Environment extensions ──────────────────────────────────────────────────

export interface McpServer {
  name: string
  target: string
  connected: boolean
  status: string
}

export interface HookEntry {
  event: string
  matcher?: string
  command: string
  scope: 'user' | 'project' | 'local'
}

export interface PluginEntry {
  name: string
  source?: string
  skills: number
}

export interface AgentType {
  name: string
  description?: string
}

// ─── Files and git ───────────────────────────────────────────────────────────

export interface FileNode {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
  size: number
  hasChildren?: boolean
}

export interface FileContent {
  path: string
  content: string
  size: number
  language: string
  truncated: boolean
}

export interface CodeSearchHit {
  path: string
  relativePath: string
  line: number
  text: string
  matchStart: number
  matchLength: number
}

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'

export interface GitFile {
  path: string
  absolutePath: string
  status: GitFileStatus
  staged: boolean
  from?: string
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  ahead?: number
  behind?: number
  upstream?: string
  files: GitFile[]
  unborn?: boolean
}

export interface GitCommit {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
  refs?: string
}

export interface GitBranch {
  name: string
  current: boolean
  remote: boolean
  lastCommit?: string
}

export interface BlameLine {
  hash: string
  author: string
  date: string
  line: number
  text: string
}

/** Result of an action that can fail for reasons outside our control. */
// ─── Workspaces, editors, skills ─────────────────────────────────────────────

export interface WorkspaceEntry {
  path: string
  name: string
  /** The directory may have been renamed or deleted since it was used. */
  exists: boolean
  gitBranch?: string
  sessionCount: number
  lastUsedAt?: number
}

export interface EditorEntry {
  id: string
  name: string
  command?: string
  appPath?: string
}

export interface SkillEntry {
  name: string
  description?: string
}

export interface SearchHit {
  sessionId: string
  filePath: string
  projectPath: string
  encodedDir: string
  title: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  timestamp: string
  snippet: string
  matchStart: number
  matchLength: number
}

export interface FileVersion {
  version: number
  /** null means the file did not exist before this change. */
  backupFileName: string | null
  backupTime: string
}

export interface ChangedFile {
  path: string
  displayPath: string
  versions: FileVersion[]
  exists: boolean
  createdBySession: boolean
}

export interface FileDiff {
  current?: string
  backup?: string
}

export interface DayBucket {
  date: string
  outputTokens: number
  requests: number
  sessions: number
}

export interface ToolUsage {
  name: string
  count: number
  errors: number
}

export interface ProjectUsage {
  projectPath: string
  outputTokens: number
  requests: number
  sessions: number
}

export interface ActivityStats {
  days: DayBucket[]
  tools: ToolUsage[]
  projects: ProjectUsage[]
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface ActionResult {
  ok: boolean
  error?: string
}

// ─── Live chat ───────────────────────────────────────────────────────────────

export interface ChatStartOptions {
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  effort?: string
  /** Resume an existing session instead of creating a new one. */
  resumeSessionId?: string
  /** On resume, branch off instead of appending. */
  forkSession?: boolean
}

/** Conversation state that drives what the composer shows. */
export type ChatStatus = 'idle' | 'starting' | 'ready' | 'thinking' | 'exited' | 'error'

/**
 * Context window fill after the last turn.
 * Computed from `result`: input plus cached tokens are exactly what the model held
 * in context, and `contextWindow` arrives in `modelUsage`.
 */
export interface ContextUsage {
  used: number
  total: number
  percent: number
  model: string
}

export interface ChatState {
  status: ChatStatus
  sessionId?: string
  cwd?: string
  model?: string
  permissionMode?: string
  /** Set when status === 'error'. */
  error?: string
  exitCode?: number | null
  /** Context fill after the last completed turn. */
  context?: ContextUsage
}

/** A tool permission request awaiting the user's decision. */
export interface PermissionRequest {
  requestId: string
  toolName: string
  input: unknown
}

export type PermissionReply =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message?: string }

/** A stream event, normalised for the renderer. */
export interface ChatStreamEvent {
  /** Raw type from the CLI stream: assistant, stream_event, result, rate_limit_event… */
  type: string
  payload: unknown
}

export interface AppInfo {
  claudeVersion?: string
  claudePath?: string
  claudeHome: string
  defaultModel?: string
}

/** The surface preload exposes to the renderer. */
export interface ClaudeUIApi {
  listSessions(): Promise<ProjectGroup[]>
  readTranscript(filePath: string, projectPath: string, encodedDir: string): Promise<TranscriptPayload>
  readSubagent(filePath: string, projectPath: string, encodedDir: string): Promise<TranscriptPayload>
  getRateLimits(): Promise<RateLimitState>
  /** Re-asks the CLI with `/usage` right now. */
  refreshRateLimits(): Promise<RateLimitState>
  getAppInfo(): Promise<AppInfo>

  chatStart(tabId: string, opts: ChatStartOptions): Promise<ChatState>
  chatSend(tabId: string, text: string, attachments?: Attachment[]): Promise<void>
  chatInterrupt(tabId: string): Promise<void>
  /** Stops the process and removes the tab from the pool. */
  chatClose(tabId: string): Promise<void>
  replyPermission(tabId: string, requestId: string, reply: PermissionReply): Promise<void>

  listWorkspaces(): Promise<WorkspaceEntry[]>
  /** System folder picker. Returns undefined when the user cancels. */
  pickDirectory(): Promise<string | undefined>
  detectEditors(): Promise<EditorEntry[]>
  openInEditor(editorId: string, path: string): Promise<ActionResult>
  listSkills(): Promise<SkillEntry[]>

  searchTranscripts(query: string, includeTools: boolean): Promise<SearchHit[]>
  /** Files the session changed, from the CLI's own history. */
  listChangedFiles(transcriptPath: string, sessionId: string): Promise<ChangedFile[]>
  getFileDiff(sessionId: string, backupFileName: string, path: string): Promise<FileDiff>
  /** Overwrites a file with a backup. Returns the previous content so it can be undone. */
  restoreFile(opts: {
    sessionId: string
    backupFileName: string
    targetPath: string
  }): Promise<ActionResult & { previousContent?: string }>
  writeFileContent(path: string, content: string): Promise<ActionResult>
  getActivityStats(days: number): Promise<ActivityStats>
  /** System file picker. An empty array means the user cancelled. */
  pickFiles(): Promise<string[]>
  /** Reads a file from disk into an attachment; images become base64. */
  readAttachment(path: string): Promise<Attachment | { error: string }>
  /** Path of a dropped file — the renderer cannot obtain it any other way. */
  getPathForFile(file: File): string

  listDirectory(root: string, dirPath?: string): Promise<FileNode[]>
  readTextFile(path: string): Promise<FileContent | { error: string }>
  searchCode(root: string, query: string, caseSensitive: boolean): Promise<CodeSearchHit[]>

  gitStatus(root: string): Promise<GitStatus>
  gitDiff(root: string, path: string, staged: boolean): Promise<{ diff: string } | { error: string }>
  gitStage(root: string, paths: string[]): Promise<ActionResult>
  gitUnstage(root: string, paths: string[]): Promise<ActionResult>
  /** Irreversibly discards changes in files. */
  gitDiscard(root: string, paths: string[]): Promise<ActionResult>
  gitCommit(root: string, message: string, amend: boolean): Promise<ActionResult & { output?: string }>
  gitLog(root: string, limit: number): Promise<GitCommit[]>
  gitBranches(root: string): Promise<GitBranch[]>
  gitCheckout(root: string, branch: string, create: boolean): Promise<ActionResult>
  gitShow(root: string, hash: string): Promise<string>
  gitBlame(root: string, path: string): Promise<BlameLine[]>

  /** Previously entered prompts; scoped to a project when one is given. */
  promptHistory(project?: string): Promise<Array<{ text: string; timestamp: number }>>
  /** Flat list of project files, used for @ mentions. */
  projectFiles(root: string): Promise<string[]>

  /** MCP servers with connection state. The health check is slow. */
  listMcpServers(): Promise<McpServer[]>
  listHooks(projectRoot?: string): Promise<HookEntry[]>
  listPlugins(): Promise<PluginEntry[]>
  listAgentTypes(): Promise<AgentType[]>

  getNote(sessionId: string): Promise<SessionNote>
  saveNote(sessionId: string, text: string): Promise<void>
  /** Toggles a bookmark on a message and returns the new list. */
  toggleBookmark(sessionId: string, messageUuid: string): Promise<string[]>
  /** Saves the session as Markdown via a system dialog. Returns a path or undefined. */
  exportSession(filePath: string, projectPath: string, encodedDir: string): Promise<string | undefined>

  listScripts(root: string): Promise<ScriptEntry[]>
  startTask(root: string, script: string): Promise<TaskState>
  stopTask(id: string): Promise<void>
  getTaskOutput(id: string): Promise<string>
  listTasks(): Promise<TaskState[]>
  forgetTask(id: string): Promise<void>
  onTaskChunk(fn: (chunk: TaskChunk) => void): () => void
  onTaskState(fn: (state: TaskState) => void): () => void

  listCheckpoints(transcriptPath: string): Promise<Checkpoint[]>
  /** Restores a checkpoint's files to their saved state. */
  restoreCheckpoint(sessionId: string, files: CheckpointFile[]): Promise<RestoreResult>
  compareSessions(
    left: { filePath: string; projectPath: string; encodedDir: string },
    right: { filePath: string; projectPath: string; encodedDir: string }
  ): Promise<SessionComparison>

  /** Whether the native terminal module loaded. */
  terminalAvailable(): Promise<{ available: boolean; error?: string }>
  terminalCreate(cwd: string, cols: number, rows: number): Promise<TerminalInfo>
  terminalWrite(id: string, data: string): Promise<void>
  terminalResize(id: string, cols: number, rows: number): Promise<void>
  terminalClose(id: string): Promise<void>
  terminalList(): Promise<TerminalInfo[]>
  terminalBuffer(id: string): Promise<string>
  onTerminalData(fn: (chunk: TerminalChunk) => void): () => void
  onTerminalExit(fn: (info: TerminalInfo) => void): () => void

  createFile(root: string, dirPath: string, name: string): Promise<OpResult>
  createDirectory(root: string, dirPath: string, name: string): Promise<OpResult>
  renamePath(root: string, path: string, newName: string): Promise<OpResult>
  /** Moves to the trash rather than deleting permanently. */
  trashPath(root: string, path: string): Promise<OpResult>
  movePath(root: string, path: string, targetDir: string): Promise<OpResult>

  previewReplace(opts: {
    root: string
    query: string
    replacement: string
    caseSensitive: boolean
    useRegex: boolean
  }): Promise<ReplacePreview>
  applyReplace(opts: {
    root: string
    query: string
    replacement: string
    caseSensitive: boolean
    useRegex: boolean
    paths: string[]
  }): Promise<ReplaceResult>

  formatFile(root: string, path: string, content: string): Promise<FormatResult>
  canFormat(root: string, path: string): Promise<boolean>

  runDiagnostics(root: string, source: 'typescript' | 'eslint'): Promise<DiagnosticsState>
  stopDiagnostics(): Promise<void>
  getDiagnostics(): Promise<DiagnosticsState>
  onDiagnostics(fn: (state: DiagnosticsState) => void): () => void
  /** File symbols for go-to-symbol and breadcrumbs. */
  fileSymbols(language: string, content: string): Promise<CodeSymbol[]>

  /** Rewrites the selected fragment according to an instruction. */
  editSelection(opts: {
    cwd: string
    path: string
    language: string
    selection: string
    instruction: string
    context?: string
    model?: string
  }): Promise<EditSelectionResult>
  explainSelection(opts: {
    cwd: string
    path: string
    language: string
    selection: string
    model?: string
  }): Promise<QuickAskResult>
  suggestCommitMessage(root: string, model?: string): Promise<QuickAskResult>
  reviewStagedDiff(root: string, model?: string): Promise<QuickAskResult>

  gitRemote(
    root: string,
    operation: 'fetch' | 'pull' | 'push',
    opts?: { setUpstream?: boolean; branch?: string; force?: boolean }
  ): Promise<RemoteOpResult>
  gitCancelRemote(): Promise<void>
  onRemoteProgress(fn: (text: string) => void): () => void

  listStash(root: string): Promise<StashEntry[]>
  stashSave(root: string, message?: string): Promise<RemoteOpResult>
  /** `drop: true` applies and removes the entry (pop). */
  stashApply(root: string, index: number, drop: boolean): Promise<RemoteOpResult>
  stashDrop(root: string, index: number): Promise<RemoteOpResult>

  diffBranches(root: string, base: string, head: string): Promise<BranchDiffFile[]>
  diffBranchFile(
    root: string,
    base: string,
    head: string,
    path: string
  ): Promise<{ before: string; after: string }>

  readConflictFile(root: string, path: string): Promise<string>
  writeConflictFile(root: string, path: string, content: string): Promise<RemoteOpResult>
  markResolved(root: string, path: string): Promise<RemoteOpResult>

  ghStatus(root: string): Promise<GhStatus>
  listPullRequests(root: string): Promise<PullRequest[]>
  currentPullRequest(root: string): Promise<PullRequest | undefined>
  createPullRequest(
    root: string,
    opts: { title: string; body: string; draft?: boolean; base?: string }
  ): Promise<{ ok: boolean; url?: string; error?: string }>

  lspComplete(opts: LspPosition): Promise<CompletionItem[]>
  lspDefinition(opts: LspPosition): Promise<LspLocation | undefined>
  lspHover(opts: LspPosition): Promise<{ contents: string } | undefined>
  /** Prepares rename edits; applying them is a separate step. */
  lspRename(opts: LspPosition & { newName: string }): Promise<RenameEdit[]>
  lspStatus(root: string): Promise<LspStatus>

  /** Runs a script under the debugger. */
  debugStart(opts: { root: string; program: string; args?: string[] }): Promise<DebugState>
  debugStop(): Promise<void>
  /** Sets or clears a breakpoint and returns the full list. */
  debugBreakpoint(path: string, line: number): Promise<Breakpoint[]>
  debugBreakpoints(): Promise<Breakpoint[]>
  debugResume(): Promise<void>
  debugStep(kind: 'over' | 'into' | 'out'): Promise<void>
  debugScopes(frameId: string): Promise<DebugScope[]>
  debugVariables(objectId: string): Promise<DebugVariable[]>
  debugEvaluate(frameId: string, expression: string): Promise<string>
  onDebugState(fn: (state: DebugState) => void): () => void

  /** Changes the permission mode of a running process, without restarting it. */
  setPermissionMode(tabId: string, mode: PermissionMode): Promise<ActionResult>
  /** Switches the conversation's model without restarting. */
  setModel(tabId: string, model: string): Promise<ActionResult>

  /** CLI processes currently running on this machine. */
  listLiveSessions(): Promise<LiveSession[]>
  openInTerminal(cwd: string, sessionId?: string): Promise<ActionResult>
  /** Starts a NEW interactive session with Remote Control in a terminal. */
  startRemoteControl(cwd: string, name?: string): Promise<ActionResult>
  stopProcess(pid: number): Promise<ActionResult>
  revealInFinder(path: string): Promise<void>
  openFolder(path: string): Promise<ActionResult>

  onSessionsChanged(fn: () => void): () => void
  onRateLimits(fn: (state: RateLimitState) => void): () => void
  onChatEvent(fn: (tabId: string, event: ChatStreamEvent) => void): () => void
  onChatPermission(fn: (tabId: string, req: PermissionRequest) => void): () => void
  onChatState(fn: (tabId: string, state: ChatState) => void): () => void
}
