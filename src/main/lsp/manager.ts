import { access, constants } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { LspClient } from './client'
import { log, warn } from '../log'
import { IS_WIN } from '../system/platform'

export interface CompletionItem {
  label: string
  detail?: string
  kind?: number
  insertText?: string
}

export interface Location {
  path: string
  line: number
  column: number
}

export interface HoverInfo {
  contents: string
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
  language?: string
  error?: string
}

/** Languages served by the same TypeScript server. */
const TS_LANGUAGES = new Set(['typescript', 'tsx', 'javascript', 'jsx'])

function languageId(language: string): string {
  switch (language) {
    case 'tsx':
      return 'typescriptreact'
    case 'jsx':
      return 'javascriptreact'
    default:
      return language
  }
}

/**
 * Keeps one language server per project.
 *
 * A server starts only when actually asked for: `tsserver` eats hundreds of
 * megabytes, and running it for a session where nobody opened code is pointless.
 */
export class LspManager {
  private clients = new Map<string, LspClient>()
  private opened = new Map<string, number>()
  private lastError?: string

  /**
   * Finds the language server and a TypeScript library for it.
   *
   * `typescript-language-server` needs the classic `tsserver.js`. Projects on
   * TypeScript 7 do not have one: the native compiler has no server mode, so a
   * private copy of TypeScript 5, installed for exactly this, is supplied instead.
   */
  private async serverFor(root: string): Promise<
    { command: string; args: string[]; options?: Record<string, unknown> } | undefined
  > {
    const own = process.cwd()
    const bases = [
      join(root, 'node_modules/.bin/typescript-language-server'),
      join(own, 'node_modules/.bin/typescript-language-server')
    ]
    // On Windows `.bin` holds a `.cmd` wrapper rather than the file itself, and
    // there is no executable bit at all, so only existence is checked.
    const candidates = IS_WIN ? bases.flatMap((b) => [`${b}.cmd`, `${b}.exe`, b]) : bases

    let command: string | undefined
    for (const candidate of candidates) {
      try {
        await access(candidate, IS_WIN ? constants.F_OK : constants.X_OK)
        command = candidate
        break
      } catch {
        continue
      }
    }
    if (!command) return undefined

    // Try the project's own tsserver first: it knows the project's language version.
    const libs = [
      join(root, 'node_modules/typescript/lib'),
      join(own, 'node_modules/lsp-typescript/lib')
    ]
    for (const lib of libs) {
      try {
        await access(join(lib, 'tsserver.js'), constants.R_OK)
        // The path goes through initialization options; the command-line flag for
        // this was removed from the server.
        return { command, args: ['--stdio'], options: { tsserver: { path: lib } } }
      } catch {
        continue
      }
    }

    this.lastError = 'no tsserver found for the language server'
    return undefined
  }

  /** Client for a root, starting the server when needed. */
  private async clientFor(root: string, language: string): Promise<LspClient | undefined> {
    if (!TS_LANGUAGES.has(language)) return undefined

    const existing = this.clients.get(root)
    if (existing?.ready) return existing
    if (existing) return undefined // still starting up

    const server = await this.serverFor(root)
    if (!server) {
      this.lastError = 'typescript-language-server not found'
      return undefined
    }

    const client = new LspClient(
      server.command,
      server.args,
      pathToFileURL(root).toString(),
      server.options
    )
    this.clients.set(root, client)
    client.on('stderr', (text: string) => warn('[lsp]', text.slice(0, 200)))
    client.on('exit', () => this.clients.delete(root))

    try {
      await client.start()
      log('[lsp] server started for', root)
      return client
    } catch (err) {
      this.lastError = (err as Error).message
      this.clients.delete(root)
      return undefined
    }
  }

  status(root: string): LspStatus {
    const client = this.clients.get(root)
    return {
      available: Boolean(client),
      ready: Boolean(client?.ready),
      error: client ? undefined : this.lastError
    }
  }

  /**
   * Tells the server the current contents of a file.
   *
   * LSP works in document versions: without a `didOpen` first the server simply
   * does not know the file, and without a version bump it ignores changes.
   */
  private async sync(
    root: string,
    path: string,
    language: string,
    content: string
  ): Promise<LspClient | undefined> {
    const client = await this.clientFor(root, language)
    if (!client) return undefined

    const uri = pathToFileURL(path).toString()
    const version = (this.opened.get(uri) ?? 0) + 1
    this.opened.set(uri, version)

    if (version === 1) {
      client.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: languageId(language), version, text: content }
      })
    } else {
      client.notify('textDocument/didChange', {
        textDocument: { uri, version },
        contentChanges: [{ text: content }]
      })
    }
    return client
  }

  async complete(opts: {
    root: string
    path: string
    language: string
    content: string
    line: number
    column: number
  }): Promise<CompletionItem[]> {
    const client = await this.sync(opts.root, opts.path, opts.language, opts.content)
    if (!client) return []

    try {
      const result = await client.request<{
        items?: CompletionItem[]
      } | CompletionItem[]>('textDocument/completion', {
        textDocument: { uri: pathToFileURL(opts.path).toString() },
        position: { line: opts.line - 1, character: opts.column - 1 }
      })

      const items = Array.isArray(result) ? result : (result?.items ?? [])
      // The server will happily return thousands of items; nobody needs that many.
      return items.slice(0, 200)
    } catch {
      return []
    }
  }

  async definition(opts: {
    root: string
    path: string
    language: string
    content: string
    line: number
    column: number
  }): Promise<Location | undefined> {
    const client = await this.sync(opts.root, opts.path, opts.language, opts.content)
    if (!client) return undefined

    try {
      const result = await client.request<
        | Array<{ uri: string; range: { start: { line: number; character: number } } }>
        | { uri: string; range: { start: { line: number; character: number } } }
        | null
      >('textDocument/definition', {
        textDocument: { uri: pathToFileURL(opts.path).toString() },
        position: { line: opts.line - 1, character: opts.column - 1 }
      })

      const first = Array.isArray(result) ? result[0] : result
      if (!first) return undefined
      return {
        path: fileURLToPath(first.uri),
        line: first.range.start.line + 1,
        column: first.range.start.character + 1
      }
    } catch {
      return undefined
    }
  }

  async hover(opts: {
    root: string
    path: string
    language: string
    content: string
    line: number
    column: number
  }): Promise<HoverInfo | undefined> {
    const client = await this.sync(opts.root, opts.path, opts.language, opts.content)
    if (!client) return undefined

    try {
      const result = await client.request<{
        contents?: string | { value?: string } | Array<string | { value?: string }>
      } | null>('textDocument/hover', {
        textDocument: { uri: pathToFileURL(opts.path).toString() },
        position: { line: opts.line - 1, character: opts.column - 1 }
      })

      const raw = result?.contents
      if (!raw) return undefined

      // The `contents` shape changed between protocol versions — accept all three.
      const text = Array.isArray(raw)
        ? raw.map((part) => (typeof part === 'string' ? part : (part.value ?? ''))).join('\n')
        : typeof raw === 'string'
          ? raw
          : (raw.value ?? '')

      const cleaned = text.replace(/```[a-z]*\n?/g, '').trim()
      return cleaned ? { contents: cleaned } : undefined
    } catch {
      return undefined
    }
  }

  async rename(opts: {
    root: string
    path: string
    language: string
    content: string
    line: number
    column: number
    newName: string
  }): Promise<RenameEdit[]> {
    const client = await this.sync(opts.root, opts.path, opts.language, opts.content)
    if (!client) return []

    try {
      const result = await client.request<{
        changes?: Record<string, Array<{ range: Range; newText: string }>>
        documentChanges?: Array<{
          textDocument: { uri: string }
          edits: Array<{ range: Range; newText: string }>
        }>
      } | null>(
        'textDocument/rename',
        {
          textDocument: { uri: pathToFileURL(opts.path).toString() },
          position: { line: opts.line - 1, character: opts.column - 1 },
          newName: opts.newName
        },
        30_000
      )

      if (!result) return []
      const edits: RenameEdit[] = []

      // The server may answer with either of the two workspace-edit shapes.
      const collect = (uri: string, list: Array<{ range: Range; newText: string }>): void => {
        for (const edit of list) {
          edits.push({
            path: fileURLToPath(uri),
            line: edit.range.start.line + 1,
            column: edit.range.start.character + 1,
            endLine: edit.range.end.line + 1,
            endColumn: edit.range.end.character + 1,
            newText: edit.newText
          })
        }
      }

      for (const [uri, list] of Object.entries(result.changes ?? {})) collect(uri, list)
      for (const change of result.documentChanges ?? []) {
        collect(change.textDocument.uri, change.edits)
      }
      return edits
    } catch (err) {
      warn('[lsp] rename:', (err as Error).message)
      return []
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.stop()))
    this.clients.clear()
    this.opened.clear()
  }
}

interface Range {
  start: { line: number; character: number }
  end: { line: number; character: number }
}
