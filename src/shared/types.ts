/**
 * Domain model.
 *
 * The schema was derived from real CLI 2.1.235 transcripts. The format is not
 * stable across versions, so every raw line type is described permissively:
 * unknown fields are harmless, and unknown `type` values land in `UnknownLine`
 * instead of breaking the parser.
 */

// ─── Raw JSONL lines ─────────────────────────────────────────────────────────

/** The common tail present on every message line, though not on meta lines. */
export interface RawMessageTail {
  parentUuid: string | null
  isSidechain: boolean
  uuid: string
  timestamp: string
  sessionId: string
  /** Duplicate of `sessionId`; the CLI writes both. */
  session_id?: string
  cwd: string
  version: string
  gitBranch?: string
  userType?: string
  entrypoint?: string
  /** Present only in subagent transcripts. */
  agentId?: string
  /** Human-readable identifier matching the file name in ~/.claude/plans/. */
  slug?: string
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens_details?: { thinking_tokens?: number } | null
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number }
  service_tier?: string | null
  cache_creation?: {
    ephemeral_1h_input_tokens?: number
    ephemeral_5m_input_tokens?: number
  }
  /**
   * A breakdown of THE SAME usage, not additional calls.
   * Ignore when summing, or everything is counted twice.
   */
  iterations?: unknown[]
  speed?: string
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown; caller?: { type: string } }
  | {
      type: 'tool_result'
      tool_use_id: string
      /** Arrives as a string or as an array of blocks — handle both. */
      content: string | Array<{ type: string; text?: string; [k: string]: unknown }>
      is_error?: boolean
    }
  | { type: string; [k: string]: unknown }

export interface RawAssistantLine extends RawMessageTail {
  type: 'assistant'
  /** Dedup key: several lines sharing a requestId are one API reply. */
  requestId?: string
  effort?: string
  message: {
    id: string
    model: string
    role: 'assistant'
    content: ContentBlock[]
    stop_reason?: string | null
    usage: TokenUsage
  }
}

export interface RawUserLine extends RawMessageTail {
  type: 'user'
  promptId?: string
  /** True for a system injection (caveat, expanded slash command). Not for the UI. */
  isMeta?: boolean
  message: { role: 'user'; content: string | ContentBlock[] }
  /** Raw, untyped tool result. Its shape depends on the tool. */
  toolUseResult?: unknown
  /** More reliable than parentUuid for linking back to the originating tool_use. */
  sourceToolAssistantUUID?: string
  permissionMode?: PermissionMode
}

export interface RawSystemLine extends RawMessageTail {
  type: 'system'
  subtype: string
  content: string
  level?: string
  isMeta?: boolean
  durationMs?: number
}

/** Meta lines: just `type` + `sessionId`, no uuid or timestamp. Not part of the chain. */
export interface RawAiTitleLine {
  type: 'ai-title'
  aiTitle: string
  sessionId: string
}
export interface RawLastPromptLine {
  type: 'last-prompt'
  lastPrompt: string
  /** UUID of the branch's last message — the resume point. */
  leafUuid: string
  sessionId: string
}
/**
 * Appears when Remote Control is enabled for a session: a bridge to claude.ai.
 * The presence of this line means the session can be driven from outside.
 */
export interface RawBridgeSessionLine {
  type: 'bridge-session'
  sessionId: string
  bridgeSessionId: string
  lastSequenceNum?: number
  ownerAccountUuid?: string
  ownerOrganizationUuid?: string
}

/** Session display name (from `-n/--name`), the same as in ~/.claude/sessions/<pid>.json. */
export interface RawAgentNameLine {
  type: 'agent-name'
  agentName: string
  sessionId: string
}
export interface RawModeLine {
  type: 'mode'
  mode: string
  sessionId: string
}
export interface RawPermissionModeLine {
  type: 'permission-mode'
  permissionMode: PermissionMode
  sessionId: string
}

/** Everything else: attachment, atis-latch, file-history-*, queue-operation, future types. */
export interface UnknownLine {
  type: string
  sessionId?: string
  [k: string]: unknown
}

export type RawLine =
  | RawAssistantLine
  | RawUserLine
  | RawSystemLine
  | RawAiTitleLine
  | RawLastPromptLine
  | RawAgentNameLine
  | RawBridgeSessionLine
  | RawModeLine
  | RawPermissionModeLine
  | UnknownLine

// ─── Normalised model for the UI ─────────────────────────────────────────────

export type PermissionMode =
  | 'acceptEdits'
  | 'auto'
  | 'bypassPermissions'
  | 'manual'
  | 'dontAsk'
  | 'plan'
  | 'default'

export interface ToolCall {
  id: string
  name: string
  input: unknown
  /** The result arrives later as its own user line; until then the tool is running. */
  result?: { content: string; isError: boolean; raw: unknown }
  /** For Agent calls: the subagent branch identifier. */
  agentId?: string
}

export interface ChatMessage {
  uuid: string
  role: 'user' | 'assistant' | 'system'
  timestamp: string
  text: string
  thinking?: string
  toolCalls: ToolCall[]
  model?: string
  /** True for a CLI pseudo-message (model === '<synthetic>'), e.g. an API error. */
  isSynthetic: boolean
  usage?: TokenUsage
  requestId?: string
}

export interface SessionMeta {
  sessionId: string
  /** Raw project path. Never reconstructed from the directory name — that is irreversible. */
  projectPath: string
  /** Directory name under ~/.claude/projects/. */
  encodedDir: string
  filePath: string
  title: string
  titleSource: 'agent-name' | 'ai-title' | 'last-prompt' | 'first-user' | 'fallback'
  /** Explicit session name, when one was given. */
  name?: string
  /** Set when Remote Control was enabled for the session. */
  bridgeSessionId?: string
  lastPrompt?: string
  leafUuid?: string
  createdAt: string
  updatedAt: string
  messageCount: number
  gitBranch?: string
  version?: string
  permissionMode?: PermissionMode
  /** Filled from ~/.claude/sessions/<pid>.json when the process is running now. */
  live?: LiveSession
  /** Pull requests opened during this session. */
  pullRequests?: SessionPullRequest[]
}

/**
 * A pull request created during a session.
 *
 * The CLI writes this line itself when a turn ends with a PR — the only way to link
 * a session to the result that went out to GitHub.
 */
export interface SessionPullRequest {
  number: number
  url: string
  repository: string
  createdAt?: string
}

export interface LiveSession {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  version: string
  kind: string
  entrypoint: string
  name?: string
  status: string
  waitingFor?: string
  messagingSocketPath?: string
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  thinkingTokens: number
  /** Number of unique API requests, after deduplication by requestId. */
  requests: number
  /** Per-model breakdown — a reply can include service calls to haiku. */
  byModel: Record<string, ModelUsage>
  costUSD?: number
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  requests: number
  costUSD?: number
}

// ─── Attachments ─────────────────────────────────────────────────────────────

/**
 * What the user attached to a message.
 *
 * Images travel inside the message as a base64 block — that is what the CLI
 * accepts. Other files are passed by path: the model has Read and will fetch them
 * itself, whereas stuffing content into the prompt would bloat the context for
 * no reason.
 */
export interface Attachment {
  id: string
  name: string
  kind: 'image' | 'file'
  size: number
  /** Images only. */
  mediaType?: string
  base64?: string
  /** Files only — an absolute path. */
  path?: string
}

/** Per-image limit: anything larger makes no sense in a prompt. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_ATTACHMENTS = 10

// ─── Rate limits ─────────────────────────────────────────────────────────────

/**
 * Plan usage percentages. The source is plan-usage-history.json, written by the
 * Claude desktop app. With that app closed the data goes stale, which is why the
 * sample's age is always shown in the UI.
 */
export interface PlanUsageSample {
  /** Epoch MILLISECONDS. */
  t: number
  /** five_hour, % */
  fh: number
  /** seven_day, % */
  sd: number
}

/** From a rate_limit_event in the stream. Carries no percentages, only status and reset. */
export interface RateLimitEventInfo {
  status: string
  /** Epoch SECONDS, not milliseconds. */
  resetsAt: number
  rateLimitType: 'five_hour' | 'seven_day' | string
  overageStatus?: string
  overageDisabledReason?: string
  isUsingOverage?: boolean
}

/** An individual limit, e.g. a weekly cap on one model. */
export interface UsageBucket {
  label: string
  percent: number
  /** Reset text straight from the CLI output, e.g. "Aug 30 at 12:59am". */
  resetsText?: string
  /** Epoch MILLISECONDS, when the text could be parsed. */
  resetsAt?: number
}

/**
 * Limits snapshot from the `/usage` command.
 *
 * The most accurate source: the CLI reports the same percentages it shows in the
 * TUI and does so for free (zero tokens). `plan-usage-history.json` remains the
 * fallback — it updates rarely and only while the desktop app is running.
 */
export interface UsageSnapshot {
  session?: UsageBucket
  week?: UsageBucket
  /** Extra caps the CLI lists separately, e.g. "Current week (Fable)". */
  extra: UsageBucket[]
  requests24h?: number
  sessions24h?: number
  /** When this was read. */
  fetchedAt: number
}

export interface RateLimitState {
  /** Primary source: a fresh `/usage` snapshot. */
  snapshot?: UsageSnapshot
  /** True while a poll is in flight, so the UI can show an indicator. */
  refreshing?: boolean
  samples: PlanUsageSample[]
  latest?: PlanUsageSample
  /** Age of the newest sample in ms — the UI must warn when the data is stale. */
  latestAgeMs?: number
  fiveHour?: RateLimitEventInfo
  sevenDay?: RateLimitEventInfo
}
