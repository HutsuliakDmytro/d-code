import { createHash } from 'node:crypto'
import { parseTranscript } from './parser'
import type { ChatMessage } from '@shared/types'

export interface ComparedMessage {
  role: ChatMessage['role']
  text: string
  timestamp: string
  toolNames: string[]
}

export interface SessionComparison {
  /** How many messages match from the start — shared history before the fork. */
  commonLength: number
  /** The last shared message: where the branches diverged. */
  divergedAt?: ComparedMessage
  left: ComparedMessage[]
  right: ComparedMessage[]
  /** True when one branch is a full prefix of the other. */
  isPrefix: boolean
}

/**
 * Message fingerprint used for comparison.
 *
 * uuid will not do: `--fork-session` mints new identifiers even for inherited
 * messages. Role and text are compared instead — those are what make it the same
 * message.
 */
function fingerprint(message: ChatMessage): string {
  return createHash('sha1')
    .update(`${message.role} ${message.text.trim()}`)
    .digest('hex')
}

function toCompared(message: ChatMessage): ComparedMessage {
  return {
    role: message.role,
    text: message.text.replace(/\s+/g, ' ').trim().slice(0, 400),
    timestamp: message.timestamp,
    toolNames: message.toolCalls.map((c) => c.name)
  }
}

/**
 * Compares two sessions by finding their shared prefix.
 *
 * Exactly what is needed after `--fork-session`: both branches inherited the same
 * history and then went their own ways.
 */
export async function compareSessions(
  left: { filePath: string; projectPath: string; encodedDir: string },
  right: { filePath: string; projectPath: string; encodedDir: string }
): Promise<SessionComparison> {
  const [a, b] = await Promise.all([
    parseTranscript(left.filePath, { projectPath: left.projectPath, encodedDir: left.encodedDir }),
    parseTranscript(right.filePath, { projectPath: right.projectPath, encodedDir: right.encodedDir })
  ])

  // System lines (slash commands, notifications) are not part of the conversation
  // and only create false divergences.
  const leftMessages = a.messages.filter((m) => m.role !== 'system')
  const rightMessages = b.messages.filter((m) => m.role !== 'system')

  let common = 0
  while (
    common < leftMessages.length &&
    common < rightMessages.length &&
    fingerprint(leftMessages[common]) === fingerprint(rightMessages[common])
  ) {
    common++
  }

  return {
    commonLength: common,
    divergedAt: common > 0 ? toCompared(leftMessages[common - 1]) : undefined,
    left: leftMessages.slice(common).map(toCompared),
    right: rightMessages.slice(common).map(toCompared),
    isPrefix: common === leftMessages.length || common === rightMessages.length
  }
}
