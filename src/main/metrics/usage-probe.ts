import { execFile } from 'node:child_process'
import type { UsageBucket, UsageSnapshot } from '@shared/types'
import { childEnv, resolveClaudePath } from '../claude/resolve-cli'

/**
 * Polls the CLI with the `/usage` command.
 *
 * The only source that reports the same percentages as the TUI, and it does so for
 * free: `total_cost_usd: 0`, zero tokens, zero turns — the command is local. It runs
 * as a separate short-lived process with `--no-session-persistence`, so it neither
 * disturbs the active conversation nor litters the history.
 */
export async function probeUsage(timeoutMs = 20_000): Promise<UsageSnapshot | { error: string }> {
  const text = await runUsageCommand(timeoutMs)
  if ('error' in text) return text
  return parseUsageText(text.output)
}

async function runUsageCommand(
  timeoutMs: number
): Promise<{ output: string } | { error: string }> {
  const command = await resolveClaudePath()
  const env = await childEnv()
  return new Promise((resolve) => {
    const child = execFile(
      command,
      [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--no-session-persistence'
      ],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, env },
      (err, stdout) => {
        if (err && !stdout) {
          resolve({ error: err.message })
          return
        }
        const parts: string[] = []
        for (const line of stdout.split('\n')) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line) as {
              type?: string
              message?: { content?: Array<{ type?: string; text?: string }> }
            }
            if (msg.type !== 'assistant') continue
            for (const block of msg.message?.content ?? []) {
              if (block.type === 'text' && block.text) parts.push(block.text)
            }
          } catch {
            // The CLI occasionally writes a non-JSON service line to stdout.
          }
        }
        const output = parts.join('\n')
        resolve(output ? { output } : { error: 'the CLI returned no /usage text' })
      }
    )
    child.stdin?.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content: '/usage' } })}\n`)
  })
}

/** `Aug 30 at 12:59am (Europe/Kiev)` → epoch ms. The CLI omits the year. */
export function parseResetTime(text: string, now = new Date()): number | undefined {
  const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(text.trim())
  if (!m) return undefined

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const month = months.indexOf(m[1].toLowerCase())
  if (month === -1) return undefined

  let hour = Number(m[3]) % 12
  if (m[5].toLowerCase() === 'pm') hour += 12

  const candidate = new Date(now.getFullYear(), month, Number(m[2]), hour, Number(m[4]), 0, 0)
  // A reset is always ahead; a date in the past means it belongs to next year.
  if (candidate.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    candidate.setFullYear(now.getFullYear() + 1)
  }
  return candidate.getTime()
}

function bucketFrom(label: string, percent: string, resets?: string): UsageBucket {
  const resetsText = resets?.replace(/\s*\([^)]*\)\s*$/, '').trim() || undefined
  return {
    label,
    percent: Number(percent),
    resetsText,
    resetsAt: resetsText ? parseResetTime(resetsText) : undefined
  }
}

/**
 * Parses the human-readable `/usage` output.
 *
 * The format is prose, so the parser is deliberately forgiving: unknown lines are
 * ignored and a missing block does not invalidate the snapshot.
 */
export function parseUsageText(text: string, now = new Date()): UsageSnapshot {
  const snapshot: UsageSnapshot = { extra: [], fetchedAt: now.getTime() }

  const session = /Current session:\s*(\d+)%\s*used(?:\s*·\s*resets\s+([^\n]+))?/i.exec(text)
  if (session) snapshot.session = bucketFrom('5 hours', session[1], session[2])

  const week = /Current week\s*\(all models\):\s*(\d+)%\s*used(?:\s*·\s*resets\s+([^\n]+))?/i.exec(text)
  if (week) snapshot.week = bucketFrom('7 days', week[1], week[2])

  // Per-model caps: "Current week (Fable): 8% used · resets …"
  const perModel = /Current week\s*\(([^)]+)\):\s*(\d+)%\s*used(?:\s*·\s*resets\s+([^\n]+))?/gi
  for (const m of text.matchAll(perModel)) {
    if (/all models/i.test(m[1])) continue
    snapshot.extra.push(bucketFrom(m[1].trim(), m[2], m[3]))
  }

  const stats = /Last 24h\s*·\s*([\d,]+)\s*requests?\s*·\s*([\d,]+)\s*sessions?/i.exec(text)
  if (stats) {
    snapshot.requests24h = Number(stats[1].replace(/,/g, ''))
    snapshot.sessions24h = Number(stats[2].replace(/,/g, ''))
  }

  return snapshot
}
