import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename } from 'node:path'
import type {
  ChatMessage,
  ContentBlock,
  PermissionMode,
  RawAssistantLine,
  RawLine,
  RawSystemLine,
  RawUserLine,
  SessionMeta,
  SessionPullRequest,
  ToolCall,
  TokenUsage
} from '@shared/types'

/**
 * Line types the CLI writes for itself, which are not part of the conversation.
 * `attachment` is the noisiest: hundreds of `total_tokens_reminder` in long sessions.
 */
const HIDDEN_LINE_TYPES = new Set([
  'attachment',
  'atis-latch',
  'mode',
  'permission-mode',
  'ai-title',
  'last-prompt',
  'agent-name',
  'bridge-session',
  'file-history-snapshot',
  'file-history-delta',
  'queue-operation'
])

/** The `model` value the CLI uses for its own pseudo-messages, e.g. API errors. */
const SYNTHETIC_MODEL = '<synthetic>'

/**
 * An expanded slash command. The CLI writes it as an ordinary user line WITHOUT
 * `isMeta`, so content is the only way to tell it apart from a real prompt.
 */
const SLASH_COMMAND_RE = /^\s*<command-(?:name|message)>/

/** System injections the CLI mixes into user prompts. They do not belong in the feed. */
const INJECTION_RE = /<(system-reminder|local-command-caveat|command-contents)>[\s\S]*?<\/\1>/g

/** ANSI codes from slash-command stdout, e.g. `[1mOpus 5[22m`. */
const ANSI_RE = /\u001b?\[\d+(?:;\d+)*m/g

function tagContent(text: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.trim()
}

/**
 * Classifies a user line. The CLI puts more than human messages here: expanded
 * slash commands, their stdout and background-agent notifications all land in the
 * same bucket, WITHOUT `isMeta`, so content is the only signal.
 */
function classifyUserText(text: string): { kind: 'user' | 'system' | 'hidden'; text: string } {
  const trimmed = text.trimStart()

  if (SLASH_COMMAND_RE.test(trimmed)) {
    return { kind: 'system', text: formatSlashCommand(text) }
  }

  if (trimmed.startsWith('<local-command-stdout>')) {
    const out = (tagContent(text, 'local-command-stdout') ?? '').replace(ANSI_RE, '')
    // Empty stdout carries nothing — the command simply ran.
    return out ? { kind: 'system', text: out } : { kind: 'hidden', text: '' }
  }

  if (trimmed.startsWith('<task-notification>')) {
    const summary = tagContent(text, 'summary')
    const status = tagContent(text, 'status')
    const label = summary ?? 'Background agent'
    return { kind: 'system', text: status ? `${label} — ${status}` : label }
  }

  const cleaned = stripInjections(text)
  return cleaned ? { kind: 'user', text: cleaned } : { kind: 'hidden', text: '' }
}

/** Pulls "/model opus" out of a slash command's XML wrapper. */
export function formatSlashCommand(text: string): string {
  const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)?.[1]?.trim()
  const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim()
  if (!name) return text.trim()
  return args ? `${name} ${args}` : name
}

/** Strips system injections from a message, leaving what the human actually wrote. */
function stripInjections(text: string): string {
  return text.replace(INJECTION_RE, '').trim()
}

export interface ParsedTranscript {
  meta: SessionMeta
  messages: ChatMessage[]
  /** Line types the parser does not know — a signal the CLI format changed. */
  unknownTypes: Map<string, number>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Flattens tool_result content to text: the CLI writes it as a string or as blocks. */
function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (typeof block === 'string') return block
      if (isRecord(block) && typeof block.text === 'string') return block.text
      if (isRecord(block) && block.type === 'image') return '[image]'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function textOf(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && 'text' in b)
    .map((b) => b.text)
    .join('')
}

function thinkingOf(content: ContentBlock[]): string | undefined {
  const parts = content
    .filter((b): b is ContentBlock & { thinking: string } => b.type === 'thinking' && 'thinking' in b)
    .map((b) => b.thinking)
    .filter(Boolean)
  return parts.length ? parts.join('\n') : undefined
}

/**
 * Streams a transcript and builds the normalised model.
 *
 * Files are append-only and can be large (thousands of lines), so they are read
 * line by line rather than JSON.parse'd whole.
 */
export async function parseTranscript(
  filePath: string,
  opts: { projectPath: string; encodedDir: string }
): Promise<ParsedTranscript> {
  const sessionId = basename(filePath, '.jsonl')
  const unknownTypes = new Map<string, number>()

  const messages: ChatMessage[] = []
  /** tool_use_id → ToolCall, to attach the result when it arrives on its own line. */
  const toolCallsById = new Map<string, ToolCall>()
  /**
   * requestId → uuid of the message that already counted its usage. One API reply
   * is written as several lines sharing a requestId; their usage is identical, so
   * only the first one is counted.
   */
  const usageSeen = new Set<string>()
  /** message.id → index in messages, to merge blocks of one reply into one message. */
  const assistantByMessageId = new Map<string, number>()

  let agentName: string | undefined
  let bridgeSessionId: string | undefined
  let aiTitle: string | undefined
  let lastPrompt: string | undefined
  let leafUuid: string | undefined
  let permissionMode: PermissionMode | undefined
  let firstUserText: string | undefined
  let createdAt: string | undefined
  let updatedAt: string | undefined
  let gitBranch: string | undefined
  let version: string | undefined
  const pullRequests = new Map<number, SessionPullRequest>()

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })

  for await (const rawLine of rl) {
    if (!rawLine.trim()) continue

    let line: RawLine
    try {
      line = JSON.parse(rawLine) as RawLine
    } catch {
      // The last line can be truncated if the CLI is writing right now.
      continue
    }

    // Meta lines are overwritten by appending — the last one wins.
    switch (line.type) {
      case 'agent-name':
        agentName = (line as { agentName?: string }).agentName
        continue
      case 'bridge-session':
        bridgeSessionId = (line as { bridgeSessionId?: string }).bridgeSessionId
        continue
      case 'ai-title':
        aiTitle = (line as { aiTitle?: string }).aiTitle
        continue
      case 'last-prompt': {
        const l = line as { lastPrompt?: string; leafUuid?: string }
        lastPrompt = l.lastPrompt
        leafUuid = l.leafUuid
        continue
      }
      case 'permission-mode':
        permissionMode = (line as { permissionMode?: PermissionMode }).permissionMode
        continue
      case 'pr-link': {
        const l = line as {
          prNumber?: number
          prUrl?: string
          prRepository?: string
          timestamp?: string
        }
        // The same PR is mentioned over and over, so entries are keyed by number;
        // otherwise the UI would show hundreds of identical rows.
        if (typeof l.prNumber === 'number' && l.prUrl) {
          pullRequests.set(l.prNumber, {
            number: l.prNumber,
            url: l.prUrl,
            repository: l.prRepository ?? '',
            createdAt: pullRequests.get(l.prNumber)?.createdAt ?? l.timestamp
          })
        }
        continue
      }
    }

    if (HIDDEN_LINE_TYPES.has(line.type)) continue

    const tail = line as unknown as { timestamp?: string; gitBranch?: string; version?: string }
    if (tail.timestamp) {
      createdAt ??= tail.timestamp
      updatedAt = tail.timestamp
    }
    if (tail.gitBranch) gitBranch = tail.gitBranch
    if (tail.version) version = tail.version

    if (line.type === 'assistant') {
      const l = line as RawAssistantLine
      const model = l.message?.model
      const content = l.message?.content ?? []

      // Several lines sharing a message.id are blocks of one reply; merge them.
      const existingIdx = l.message?.id ? assistantByMessageId.get(l.message.id) : undefined
      const target =
        existingIdx !== undefined
          ? messages[existingIdx]
          : ({
              uuid: l.uuid,
              role: 'assistant' as const,
              timestamp: l.timestamp,
              text: '',
              toolCalls: [],
              model,
              isSynthetic: model === SYNTHETIC_MODEL,
              requestId: l.requestId
            } satisfies ChatMessage)

      target.text += textOf(content)
      const think = thinkingOf(content)
      if (think) target.thinking = (target.thinking ?? '') + think

      for (const block of content) {
        if (block.type !== 'tool_use') continue
        const b = block as Extract<ContentBlock, { type: 'tool_use' }>
        const call: ToolCall = { id: b.id, name: b.name, input: b.input }
        target.toolCalls.push(call)
        toolCallsById.set(b.id, call)
      }

      // Usage counts once per API request; otherwise totals inflate 2–4×.
      const dedupKey = l.requestId ?? l.message?.id
      if (dedupKey && !usageSeen.has(dedupKey) && l.message?.usage) {
        usageSeen.add(dedupKey)
        target.usage = l.message.usage
      }

      if (existingIdx === undefined) {
        if (l.message?.id) assistantByMessageId.set(l.message.id, messages.length)
        messages.push(target)
      }
      continue
    }

    if (line.type === 'user') {
      const l = line as RawUserLine
      const content = l.message?.content ?? ''

      // Tool results arrive as user lines — they are not human messages.
      if (Array.isArray(content)) {
        let handled = false
        for (const block of content) {
          if (block.type !== 'tool_result') continue
          handled = true
          const b = block as Extract<ContentBlock, { type: 'tool_result' }>
          const call = toolCallsById.get(b.tool_use_id)
          if (!call) continue
          call.result = {
            content: flattenToolResultContent(b.content),
            isError: b.is_error === true,
            raw: l.toolUseResult
          }
          // Agent calls return the subagent branch as a separate file.
          if (isRecord(l.toolUseResult) && typeof l.toolUseResult.agentId === 'string') {
            call.agentId = l.toolUseResult.agentId
          }
        }
        if (handled) continue
      }

      if (l.isMeta) continue // caveats and other system injections

      const { kind, text } = classifyUserText(textOf(content))
      if (kind === 'hidden') continue
      if (kind === 'user') firstUserText ??= text

      messages.push({
        uuid: l.uuid,
        role: kind,
        timestamp: l.timestamp,
        text,
        toolCalls: [],
        isSynthetic: false
      })
      continue
    }

    if (line.type === 'system') {
      const l = line as RawSystemLine
      if (l.subtype !== 'local_command') continue // compaction and such are not chat content
      messages.push({
        uuid: l.uuid,
        role: 'system',
        timestamp: l.timestamp,
        text: formatSlashCommand(l.content ?? ''),
        toolCalls: [],
        isSynthetic: false
      })
      continue
    }

    unknownTypes.set(line.type, (unknownTypes.get(line.type) ?? 0) + 1)
  }

  const { title, titleSource } = pickTitle(agentName, aiTitle, lastPrompt, firstUserText)

  return {
    meta: {
      sessionId,
      projectPath: opts.projectPath,
      encodedDir: opts.encodedDir,
      filePath,
      title,
      titleSource,
      name: agentName,
      bridgeSessionId,
      lastPrompt,
      leafUuid,
      createdAt: createdAt ?? new Date(0).toISOString(),
      updatedAt: updatedAt ?? createdAt ?? new Date(0).toISOString(),
      messageCount: messages.length,
      gitBranch,
      version,
      permissionMode,
      pullRequests: pullRequests.size > 0 ? [...pullRequests.values()] : undefined
    },
    messages,
    unknownTypes
  }
}

/**
 * Session title. The `summary` line type is gone in 2.1.x, so the sources are, in
 * order: an explicit name → a generated title → the last prompt → the first message.
 */
function pickTitle(
  agentName: string | undefined,
  aiTitle: string | undefined,
  lastPrompt: string | undefined,
  firstUserText: string | undefined
): { title: string; titleSource: SessionMeta['titleSource'] } {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 120)
  if (agentName?.trim()) return { title: clean(agentName), titleSource: 'agent-name' }
  if (aiTitle?.trim()) return { title: clean(aiTitle), titleSource: 'ai-title' }
  if (lastPrompt?.trim()) return { title: clean(lastPrompt), titleSource: 'last-prompt' }
  if (firstUserText?.trim()) return { title: clean(firstUserText), titleSource: 'first-user' }
  return { title: 'Untitled', titleSource: 'fallback' }
}

/** Empty accumulator for summing usage. */
export function emptyUsage(): TokenUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  }
}
