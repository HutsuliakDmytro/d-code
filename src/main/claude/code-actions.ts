import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cleanLine, extractCode, quickAsk, type QuickAskResult } from './quick-ask'
import { childEnv } from './resolve-cli'

const execFileAsync = promisify(execFile)

export interface EditSelectionOptions {
  cwd: string
  path: string
  language: string
  /** The selected fragment to rewrite. */
  selection: string
  /** What to do with the fragment. */
  instruction: string
  /** Lines around the selection — the model needs to see where the code sits. */
  context?: string
  model?: string
}

export interface EditSelectionResult extends QuickAskResult {
  /** Replacement code for the selection. */
  code?: string
}

/**
 * Rewrites the selected fragment according to an instruction.
 *
 * The request is for code and nothing else: the result goes into the file as a
 * diff, so any "here is your code:" would have to be cut out. That did not stop
 * `extractCode` from being necessary — the model still likes to wrap replies in a
 * fenced block.
 */
export async function editSelection(opts: EditSelectionOptions): Promise<EditSelectionResult> {
  const prompt = [
    `You are editing ${opts.path} (${opts.language}).`,
    '',
    opts.context ? `Context around the fragment:\n\`\`\`\n${opts.context}\n\`\`\`\n` : '',
    'The fragment to change:',
    '```',
    opts.selection,
    '```',
    '',
    `Task: ${opts.instruction}`,
    '',
    'Return ONLY the new code for this fragment, with no explanation and no notes about the changes.',
    'Preserve the existing indentation so the code drops into place unedited.'
  ]
    .filter(Boolean)
    .join('\n')

  const result = await quickAsk({ prompt, cwd: opts.cwd, model: opts.model })
  if (!result.ok || !result.text) return result

  return { ...result, code: extractCode(result.text) }
}

export interface ExplainOptions {
  cwd: string
  path: string
  language: string
  selection: string
  model?: string
}

/** A short explanation of a fragment, with no code changes. */
export async function explainSelection(opts: ExplainOptions): Promise<QuickAskResult> {
  const prompt = [
    `Explain this fragment from ${opts.path} (${opts.language}).`,
    'Briefly: what it does, why it exists and what to watch out for.',
    'Do not narrate the code line by line.',
    "Reply in the same language as the surrounding comments and identifiers.",
    '',
    '```',
    opts.selection,
    '```'
  ].join('\n')

  return quickAsk({ prompt, cwd: opts.cwd, model: opts.model })
}

/**
 * Drafts a commit message from what is already staged.
 *
 * `--cached` is deliberate: only staged changes get committed, and the message
 * must describe those rather than everything in the working tree.
 */
export async function suggestCommitMessage(
  root: string,
  model?: string
): Promise<QuickAskResult> {
  const env = await childEnv()
  let diff = ''
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'diff', '--cached'], {
      maxBuffer: 8 * 1024 * 1024,
      env
    })
    diff = stdout
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  if (!diff.trim()) {
    return { ok: false, error: 'Nothing staged' }
  }

  // Sending a huge diff whole is pointless — the gist is visible up front.
  const trimmed = diff.length > 60_000 ? `${diff.slice(0, 60_000)}\n… diff truncated` : diff

  const result = await quickAsk({
    prompt: [
      'Write a commit message for these changes.',
      'One line, at most 72 characters, in the imperative mood.',
      'No trailing period, and no "feat:"-style prefix unless the project already uses one.',
      "Match the language of the repository's recent commit messages.",
      'Return ONLY that line.',
      '',
      '```diff',
      trimmed,
      '```'
    ].join('\n'),
    cwd: root,
    model
  })

  if (!result.ok || !result.text) return result
  return { ...result, text: cleanLine(result.text) }
}

/** Review of staged changes: what breaks, what is worth fixing. */
export async function reviewStagedDiff(root: string, model?: string): Promise<QuickAskResult> {
  const env = await childEnv()
  let diff = ''
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'diff', '--cached'], {
      maxBuffer: 8 * 1024 * 1024,
      env
    })
    diff = stdout
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }

  if (!diff.trim()) return { ok: false, error: 'Nothing staged' }
  const trimmed = diff.length > 80_000 ? `${diff.slice(0, 80_000)}\n… diff truncated` : diff

  return quickAsk({
    prompt: [
      'Review these changes before they are committed.',
      'Name only what genuinely deserves attention: bugs, regressions, missed cases.',
      'If everything is fine, say so in one sentence.',
      'Do not narrate the diff and do not praise it. Be brief.',
      "Match the language of the repository's recent commit messages.",
      '',
      '```diff',
      trimmed,
      '```'
    ].join('\n'),
    cwd: root,
    model,
    timeoutMs: 180_000
  })
}
