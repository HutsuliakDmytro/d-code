import { homedir } from 'node:os'
import type { ChatMessage, SessionMeta } from '@shared/types'
import type { SessionNote } from './session-notes'

/**
 * Turning a session into something shareable.
 *
 * A transcript is not a document: it holds absolute paths, the machine's user
 * name and whatever secrets happened to pass through a tool result. Export is
 * therefore two steps — redact, then render — and both are deliberate rather
 * than a side effect of formatting.
 */

export type ExportFormat = 'md' | 'html'

export interface ExportOptions {
  format: ExportFormat
  /** Strip secrets, home paths and addresses. On by default for a reason. */
  redact: boolean
  /** Tool calls make the document honest but long. */
  includeTools: boolean
  includeThinking: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: 'md',
  redact: true,
  includeTools: true,
  includeThinking: false
}

/** How many characters of a tool result to keep in the export. */
const TOOL_RESULT_LIMIT = 2000

// ─── Redaction ───────────────────────────────────────────────────────────────

/**
 * Patterns for values that must never leave the machine.
 *
 * Each entry is anchored on a provider-specific prefix rather than on entropy:
 * a "looks random enough" heuristic mangles hashes, UUIDs and minified code,
 * and a session transcript is full of all three.
 */
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/g, label: 'ANTHROPIC_KEY' },
  { re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, label: 'API_KEY' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/g, label: 'GITHUB_TOKEN' },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g, label: 'GITHUB_TOKEN' },
  { re: /AKIA[0-9A-Z]{16}/g, label: 'AWS_KEY' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g, label: 'SLACK_TOKEN' },
  { re: /AIza[A-Za-z0-9_-]{35}/g, label: 'GOOGLE_KEY' },
  // A JWT: three base64url segments, the first of which decodes to a JSON header.
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: 'JWT' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: 'PRIVATE_KEY' }
]

/**
 * `NAME=value` where the name itself announces a secret.
 *
 * Catches the long tail no prefix rule can: `DATABASE_PASSWORD=hunter2`,
 * `MY_APP_SECRET: abc`. The value stops at whitespace or a quote, so a shell
 * line keeps the rest of its arguments.
 */
const ASSIGNMENT_RE =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS)[A-Z0-9_]*)(\s*[=:]\s*)(['"]?)([^\s'"]{4,})\3/g

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g

/** Escapes a string for literal use inside a RegExp. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Removes secrets and identifying paths from a single string.
 *
 * `home` is a parameter rather than a call to `homedir()` so the behaviour is
 * testable on a machine whose real home is nothing like the fixture's.
 */
export function redact(text: string, home: string = homedir()): string {
  if (!text) return text
  let out = text

  for (const { re, label } of SECRET_PATTERNS) {
    out = out.replace(re, `[redacted:${label}]`)
  }
  out = out.replace(ASSIGNMENT_RE, (_m, name, sep, quote) => `${name}${sep}${quote}[redacted]${quote}`)
  out = out.replace(EMAIL_RE, '[redacted:email]')

  // The home path goes last: earlier rules may have matched text containing it.
  if (home) {
    out = out.replace(new RegExp(escapeRe(home), 'g'), '~')
    // Windows transcripts mix separators; normalise the backslash form too.
    const winHome = home.replace(/\//g, '\\')
    if (winHome !== home) out = out.replace(new RegExp(escapeRe(winHome), 'g'), '~')
  }
  return out
}

/**
 * Redacts a tool input by round-tripping it through JSON.
 *
 * The input is `unknown` and arbitrarily nested, so walking it by hand would
 * miss cases; serialising covers every string at once. `JSON.stringify` yields
 * `undefined` for values it cannot represent, which is why the guard exists.
 */
function redactInput(input: unknown, home: string): unknown {
  const json = JSON.stringify(input)
  if (json === undefined) return input
  try {
    return JSON.parse(redact(json, home))
  } catch {
    // Redaction cannot produce invalid JSON, but a corrupt input should not
    // take the whole export down with it.
    return input
  }
}

/** Applies redaction to every text-carrying field of a message. */
function redactMessage(message: ChatMessage, home: string): ChatMessage {
  return {
    ...message,
    text: redact(message.text, home),
    thinking: message.thinking ? redact(message.thinking, home) : message.thinking,
    toolCalls: message.toolCalls.map((call) => ({
      ...call,
      input: redactInput(call.input, home),
      result: call.result
        ? { ...call.result, content: redact(call.result.content, home) }
        : call.result
    }))
  }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

interface Prepared {
  meta: SessionMeta
  messages: ChatMessage[]
  note?: SessionNote
  opts: ExportOptions
}

function prepare(
  meta: SessionMeta,
  messages: ChatMessage[],
  note: SessionNote | undefined,
  opts: ExportOptions,
  home: string
): Prepared {
  if (!opts.redact) return { meta, messages, note, opts }
  return {
    meta: { ...meta, projectPath: redact(meta.projectPath, home), title: redact(meta.title, home) },
    messages: messages.map((m) => redactMessage(m, home)),
    note: note ? { ...note, text: redact(note.text, home) } : note,
    opts
  }
}

function truncateResult(content: string): string {
  const body = content.slice(0, TOOL_RESULT_LIMIT)
  return content.length > TOOL_RESULT_LIMIT ? `${body}\n… truncated` : body
}

/**
 * Markdown export of a session.
 *
 * Tool calls are folded into `<details>` — otherwise the document turns into one
 * long log and the conversation becomes unreadable.
 */
export function toMarkdown(
  meta: SessionMeta,
  messages: ChatMessage[],
  note?: SessionNote,
  options: Partial<ExportOptions> = {},
  home: string = homedir()
): string {
  const prepared = prepare(meta, messages, note, { ...DEFAULT_EXPORT_OPTIONS, ...options }, home)
  const { opts } = prepared
  const lines: string[] = []
  const date = new Date(prepared.meta.createdAt)

  lines.push(`# ${prepared.meta.title}`, '')
  lines.push(`- **Project:** \`${prepared.meta.projectPath}\``)
  lines.push(`- **Session:** \`${prepared.meta.sessionId}\``)
  if (Number.isFinite(date.getTime())) {
    lines.push(`- **Started:** ${date.toLocaleString()}`)
  }
  if (prepared.meta.gitBranch) lines.push(`- **Branch:** \`${prepared.meta.gitBranch}\``)
  lines.push(`- **Messages:** ${prepared.messages.length}`, '')

  if (prepared.note?.text.trim()) {
    lines.push('## Notes', '', prepared.note.text.trim(), '')
  }

  lines.push('---', '')

  for (const message of prepared.messages) {
    const bookmarked = prepared.note?.bookmarks.includes(message.uuid) ? ' 🔖' : ''

    if (message.role === 'system') {
      lines.push(`> \`${message.text}\`${bookmarked}`, '')
      continue
    }

    lines.push(`### ${message.role === 'user' ? 'User' : 'Claude'}${bookmarked}`, '')

    if (opts.includeThinking && message.thinking?.trim()) {
      lines.push('<details><summary>Thinking</summary>', '', message.thinking.trim(), '', '</details>', '')
    }
    if (message.text.trim()) lines.push(message.text.trim(), '')

    if (!opts.includeTools) continue
    for (const call of message.toolCalls) {
      const summary = `${call.name}${call.result?.isError ? ' (error)' : ''}`
      lines.push(`<details><summary>🔧 ${summary}</summary>`, '')
      lines.push('```json', JSON.stringify(call.input, null, 2), '```', '')
      if (call.result) {
        lines.push('```', truncateResult(call.result.content), '```', '')
      }
      lines.push('</details>', '')
    }
  }

  if (opts.redact) {
    lines.push('---', '', '<sub>Exported from D-code. Secrets and paths redacted.</sub>', '')
  }

  return lines.join('\n')
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

/**
 * The stylesheet is inlined on purpose: an exported file gets dropped into a
 * Slack thread or an email attachment, where a linked stylesheet never loads.
 */
const HTML_STYLE = `
:root { color-scheme: light dark; --bg:#fff; --fg:#1a1a1a; --muted:#6b7280; --line:#e5e7eb;
        --user:#f3f4f6; --code:#f6f8fa; --accent:#c96442; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#1a1a19; --fg:#e8e6e3; --muted:#9b9995; --line:#33322e;
          --user:#26251f; --code:#211f1c; --accent:#d97757; }
}
* { box-sizing: border-box; }
body { margin:0; padding:2.5rem 1rem; background:var(--bg); color:var(--fg);
       font:15px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 46rem; margin: 0 auto; }
h1 { font-size:1.6rem; margin:0 0 .75rem; }
.meta { color:var(--muted); font-size:.82rem; margin-bottom:2rem; }
.meta code { background:none; padding:0; }
.msg { margin:1.5rem 0; }
.who { font-size:.72rem; text-transform:uppercase; letter-spacing:.06em;
       color:var(--muted); margin-bottom:.4rem; }
.user .body { background:var(--user); border-radius:.6rem; padding:.7rem .9rem; }
.system { color:var(--muted); font-size:.85rem; border-left:2px solid var(--line);
          padding-left:.75rem; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
.body { white-space:pre-wrap; overflow-wrap:anywhere; }
details { margin:.5rem 0; border:1px solid var(--line); border-radius:.4rem; padding:.4rem .6rem; }
summary { cursor:pointer; font-size:.8rem; color:var(--muted); }
summary.error { color:var(--accent); }
pre { background:var(--code); padding:.7rem; border-radius:.4rem; overflow-x:auto;
      font-size:.78rem; line-height:1.5; }
code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
footer { margin-top:3rem; padding-top:1rem; border-top:1px solid var(--line);
         color:var(--muted); font-size:.75rem; }
.mark { color:var(--accent); }
`

/**
 * Self-contained HTML export.
 *
 * Message text is escaped and shown as-is rather than rendered as Markdown: a
 * transcript is full of half-formed code fences and angle brackets, and turning
 * those into markup silently loses content.
 */
export function toHtml(
  meta: SessionMeta,
  messages: ChatMessage[],
  note?: SessionNote,
  options: Partial<ExportOptions> = {},
  home: string = homedir()
): string {
  const prepared = prepare(meta, messages, note, { ...DEFAULT_EXPORT_OPTIONS, ...options }, home)
  const { opts } = prepared
  const date = new Date(prepared.meta.createdAt)
  const out: string[] = []

  out.push('<!doctype html>')
  out.push('<html lang="en"><head><meta charset="utf-8">')
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">')
  out.push(`<title>${escapeHtml(prepared.meta.title)}</title>`)
  out.push(`<style>${HTML_STYLE}</style>`)
  out.push('</head><body><main>')
  out.push(`<h1>${escapeHtml(prepared.meta.title)}</h1>`)

  const metaBits = [`<code>${escapeHtml(prepared.meta.projectPath)}</code>`]
  if (Number.isFinite(date.getTime())) metaBits.push(escapeHtml(date.toLocaleString()))
  if (prepared.meta.gitBranch) metaBits.push(escapeHtml(prepared.meta.gitBranch))
  metaBits.push(`${prepared.messages.length} messages`)
  out.push(`<p class="meta">${metaBits.join(' · ')}</p>`)

  if (prepared.note?.text.trim()) {
    out.push(`<div class="msg"><div class="who">Notes</div>`)
    out.push(`<div class="body">${escapeHtml(prepared.note.text.trim())}</div></div>`)
  }

  for (const message of prepared.messages) {
    const bookmarked = prepared.note?.bookmarks.includes(message.uuid)
      ? ' <span class="mark">🔖</span>'
      : ''

    if (message.role === 'system') {
      out.push(`<div class="msg system">${escapeHtml(message.text)}${bookmarked}</div>`)
      continue
    }

    out.push(`<div class="msg ${message.role}">`)
    out.push(`<div class="who">${message.role === 'user' ? 'User' : 'Claude'}${bookmarked}</div>`)

    if (opts.includeThinking && message.thinking?.trim()) {
      out.push('<details><summary>Thinking</summary>')
      out.push(`<div class="body">${escapeHtml(message.thinking.trim())}</div></details>`)
    }
    if (message.text.trim()) {
      out.push(`<div class="body">${escapeHtml(message.text.trim())}</div>`)
    }

    if (opts.includeTools) {
      for (const call of message.toolCalls) {
        const cls = call.result?.isError ? ' class="error"' : ''
        const suffix = call.result?.isError ? ' (error)' : ''
        out.push(`<details><summary${cls}>🔧 ${escapeHtml(call.name)}${suffix}</summary>`)
        out.push(`<pre><code>${escapeHtml(JSON.stringify(call.input, null, 2))}</code></pre>`)
        if (call.result) {
          out.push(`<pre><code>${escapeHtml(truncateResult(call.result.content))}</code></pre>`)
        }
        out.push('</details>')
      }
    }
    out.push('</div>')
  }

  out.push('<footer>Exported from D-code')
  out.push(opts.redact ? ' · secrets and paths redacted' : '')
  out.push('</footer></main></body></html>')
  return out.join('\n')
}

/** Renders in whichever format the options ask for. */
export function renderExport(
  meta: SessionMeta,
  messages: ChatMessage[],
  note: SessionNote | undefined,
  options: Partial<ExportOptions> = {},
  home: string = homedir()
): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options }
  return opts.format === 'html'
    ? toHtml(meta, messages, note, opts, home)
    : toMarkdown(meta, messages, note, opts, home)
}
