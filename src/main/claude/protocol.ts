import type { ContentBlock, RateLimitEventInfo, TokenUsage } from '@shared/types'

/**
 * The stream-json format the CLI emits in mode
 * `-p --input-format stream-json --output-format stream-json --verbose`.
 *
 * The shape was verified against a real run of CLI 2.1.235 rather than from docs:
 * the stream carries `system/init`, a `user` echo (with `--replay-user-messages`),
 * `assistant`, `rate_limit_event` and a final `result`.
 */

export interface SystemInitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  uuid: string
  cwd: string
  model: string
  permissionMode: string
  tools: string[]
  slash_commands: string[]
  agents: string[]
  skills?: unknown[]
  plugins?: unknown[]
  mcp_servers?: unknown[]
  memory_paths?: string[]
  output_style?: string
  apiKeySource?: string
  claude_code_version?: string
  messaging_socket_path?: string
  fast_mode_state?: string
  fast_mode_disabled_reason?: string
}

export interface AssistantEvent {
  type: 'assistant'
  session_id: string
  uuid: string
  parent_tool_use_id?: string | null
  message: {
    id: string
    model: string
    role: 'assistant'
    content: ContentBlock[]
    stop_reason?: string | null
    usage?: TokenUsage
  }
}

export interface UserEvent {
  type: 'user'
  session_id: string
  uuid: string
  parent_tool_use_id?: string | null
  message: { role: 'user'; content: string | ContentBlock[] }
}

/** Partial chunks from `--include-partial-messages`; they carry text deltas. */
export interface StreamEvent {
  type: 'stream_event'
  session_id: string
  uuid: string
  parent_tool_use_id?: string | null
  event: {
    type: string
    index?: number
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string }
    content_block?: { type: string; id?: string; name?: string }
  }
}

export interface RateLimitEvent {
  type: 'rate_limit_event'
  session_id: string
  uuid: string
  rate_limit_info: RateLimitEventInfo
}

/** Turn summary. The only place the CLI reports cost in dollars itself. */
export interface ResultEvent {
  type: 'result'
  subtype: 'success' | 'error' | string
  session_id: string
  uuid: string
  is_error: boolean
  result?: string
  duration_ms: number
  duration_api_ms?: number
  num_turns: number
  stop_reason?: string
  total_cost_usd?: number
  usage?: TokenUsage
  modelUsage?: Record<string, CliModelUsage>
  permission_denials?: unknown[]
  terminal_reason?: string
  api_error_status?: string | null
  ttft_ms?: number
}

export interface CliModelUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests?: number
  costUSD: number
  contextWindow: number
  maxOutputTokens?: number
  canonicalModel?: string
  provider?: string
}

/**
 * Control channel: the CLI asks for tool permission over it (`can_use_tool`),
 * and we send interrupts and permission-mode changes back.
 */
export interface ControlRequest {
  type: 'control_request'
  request_id: string
  request: {
    subtype: 'can_use_tool' | 'hook_callback' | 'mcp_message' | string
    tool_name?: string
    input?: unknown
    permission_suggestions?: unknown
    [k: string]: unknown
  }
}

export interface ControlResponse {
  type: 'control_response'
  response: {
    subtype: 'success' | 'error'
    request_id: string
    response?: unknown
    error?: string
  }
}

export type StreamMessage =
  | SystemInitEvent
  | AssistantEvent
  | UserEvent
  | StreamEvent
  | RateLimitEvent
  | ResultEvent
  | ControlRequest
  | { type: string; [k: string]: unknown }

/** Decision for a `can_use_tool` request. */
export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: unknown }
  | { behavior: 'deny'; message?: string }

/** Input message block: text, or an image in base64. */
export type InputBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      source: { type: 'base64'; media_type: string; data: string }
    }

/** A message we write to the CLI's stdin. */
export interface UserInputMessage {
  type: 'user'
  message: { role: 'user'; content: string | InputBlock[] }
  parent_tool_use_id?: null
  session_id?: string
}
