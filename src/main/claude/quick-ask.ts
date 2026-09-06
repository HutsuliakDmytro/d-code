import { execFile } from 'node:child_process'
import { childEnv, resolveClaudePath } from './resolve-cli'

export interface QuickAskOptions {
  prompt: string
  cwd: string
  model?: string
  timeoutMs?: number
}

export interface QuickAskResult {
  ok: boolean
  text?: string
  costUsd?: number
  durationMs?: number
  error?: string
}

/**
 * A one-shot question to the model, with no session created.
 *
 * Used wherever a short answer about a specific fragment is needed: rewrite the
 * selection, draft a commit message, look over a diff.
 *
 * `--no-session-persistence` keeps session history free of these service requests,
 * and `--permission-mode plan` guarantees the model writes nothing to disk: the
 * result must come back as text and be applied only after confirmation.
 */
export async function quickAsk(opts: QuickAskOptions): Promise<QuickAskResult> {
  const command = await resolveClaudePath()
  const env = await childEnv()

  const args = [
    '-p',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--permission-mode',
    'plan'
  ]
  if (opts.model) args.push('--model', opts.model)
  // The prompt goes last: otherwise the preceding flag swallows it as its value.
  args.push(opts.prompt)

  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: opts.cwd,
        env,
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 16 * 1024 * 1024
      },
      (err, stdout) => {
        if (!stdout) {
          resolve({ ok: false, error: err?.message ?? 'the CLI returned no answer' })
          return
        }
        try {
          const parsed = JSON.parse(stdout) as {
            result?: string
            is_error?: boolean
            total_cost_usd?: number
            duration_ms?: number
          }
          if (parsed.is_error || typeof parsed.result !== 'string') {
            resolve({ ok: false, error: parsed.result ?? 'the model returned an error' })
            return
          }
          resolve({
            ok: true,
            text: parsed.result,
            costUsd: parsed.total_cost_usd,
            durationMs: parsed.duration_ms
          })
        } catch {
          resolve({ ok: false, error: 'could not parse the CLI response' })
        }
      }
    )
  })
}

/**
 * Extracts code from a reply.
 *
 * The model almost always wraps the result in a fenced block and adds prose; only
 * the code is needed to replace a fragment. With no block, the text is returned as is.
 */
export function extractCode(answer: string): string {
  const fenced = /```[a-zA-Z0-9+-]*\n([\s\S]*?)```/.exec(answer)
  if (fenced?.[1] !== undefined) return fenced[1].replace(/\n$/, '')
  return answer.trim()
}

/** Strips quotes and boilerplate prefixes from a single-line reply. */
export function cleanLine(answer: string): string {
  return answer
    .trim()
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/```$/, '')
    .split('\n')[0]
    .replace(/^["'`]|["'`]$/g, '')
    .trim()
}
