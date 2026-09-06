import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { shell } from 'electron'
import { PROJECTS_DIR, listKnownProjectPaths } from '../store/project-paths'
import {
  IS_MAC,
  IS_WIN,
  hasApplication,
  hasCommand,
  loginShell,
  openWithApplication,
  shellArgs,
  shellQuote
} from './platform'

const execFileAsync = promisify(execFile)

export interface WorkspaceEntry {
  path: string
  name: string
  exists: boolean
  gitBranch?: string
  /** How many sessions already exist in this directory. */
  sessionCount: number
  lastUsedAt?: number
}

/** Repository branch, when the directory is under git. */
async function gitBranch(path: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, 'branch', '--show-current'], {
      timeout: 3000
    })
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path)
    .then((s) => s.isDirectory())
    .catch(() => false)
}

async function readCwdFromTranscript(file: string): Promise<string | undefined> {
  try {
    // cwd sits in the first few lines — no need to read the whole file for it.
    const head = (await readFile(file, 'utf8')).slice(0, 20_000)
    for (const line of head.split('\n')) {
      if (!line.trim()) continue
      try {
        const obj = JSON.parse(line) as { cwd?: string }
        if (obj.cwd) return obj.cwd
      } catch {
        continue
      }
    }
  } catch {
    // the file may have been deleted between readdir and readFile
  }
  return undefined
}

async function newestMtime(dir: string, files: string[]): Promise<number> {
  const times = await Promise.all(
    files.map((f) =>
      stat(join(dir, f))
        .then((s) => s.mtimeMs)
        .catch(() => 0)
    )
  )
  return Math.max(0, ...times)
}

/**
 * Directories Claude Code has already worked in. This is the list of
 * "repositories" offered for a new session — the CLI keeps no other registry.
 */
export async function listWorkspaces(): Promise<WorkspaceEntry[]> {
  const paths = await listKnownProjectPaths()
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])

  const sessionInfo = new Map<string, { count: number; mtime: number }>()
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dirPath = join(PROJECTS_DIR, d.name)
    const files = await readdir(dirPath).catch(() => [] as string[])
    const jsonl = files.filter((f) => f.endsWith('.jsonl'))
    if (jsonl.length === 0) continue
    // The directory name is not reversible, so the real path comes from the transcript.
    const cwd = await readCwdFromTranscript(join(dirPath, jsonl[0]))
    if (!cwd) continue
    sessionInfo.set(cwd, { count: jsonl.length, mtime: await newestMtime(dirPath, jsonl) })
  }

  const all = new Set([...paths, ...sessionInfo.keys()])
  const entries = await Promise.all(
    [...all].map(async (path): Promise<WorkspaceEntry> => {
      const info = sessionInfo.get(path)
      const exists = await isDirectory(path)
      return {
        path,
        name: basename(path) || path,
        exists,
        gitBranch: exists ? await gitBranch(path) : undefined,
        sessionCount: info?.count ?? 0,
        lastUsedAt: info?.mtime
      }
    })
  )

  // Recently used first; vanished directories go to the end.
  return entries.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  })
}

// ─── Editors ─────────────────────────────────────────────────────────────────

export interface EditorEntry {
  id: string
  name: string
  /** CLI command, when on PATH — it knows how to open a specific directory. */
  command?: string
  /** Application path, as a fallback. */
  appPath?: string
}

const KNOWN_EDITORS = [
  {
    id: 'vscode',
    name: 'VS Code',
    command: 'code',
    mac: 'Visual Studio Code',
    desktop: 'code',
    win: 'Microsoft VS Code\\Code.exe'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    command: 'cursor',
    mac: 'Cursor',
    desktop: 'cursor',
    win: 'cursor\\Cursor.exe'
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    command: 'windsurf',
    mac: 'Windsurf',
    desktop: 'windsurf',
    win: 'Windsurf\\Windsurf.exe'
  },
  {
    id: 'antigravity',
    name: 'Antigravity IDE',
    command: 'antigravity',
    mac: 'Antigravity IDE',
    desktop: 'antigravity',
    win: 'Antigravity\\Antigravity.exe'
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    command: 'webstorm',
    mac: 'WebStorm',
    desktop: 'webstorm'
  },
  { id: 'idea', name: 'IntelliJ IDEA', command: 'idea', mac: 'IntelliJ IDEA', desktop: 'idea' },
  { id: 'zed', name: 'Zed', command: 'zed', mac: 'Zed', desktop: 'dev.zed.Zed' },
  {
    id: 'sublime',
    name: 'Sublime Text',
    command: 'subl',
    mac: 'Sublime Text',
    desktop: 'sublime_text',
    win: 'Sublime Text\\sublime_text.exe'
  },
  // Xcode exists only on macOS and has no CLI command.
  { id: 'xcode', name: 'Xcode', command: '', mac: 'Xcode' },
  // Editors worth having on Linux that are rarely installed separately on macOS.
  { id: 'gnome-text', name: 'Text Editor', command: 'gnome-text-editor', desktop: 'org.gnome.TextEditor' },
  { id: 'kate', name: 'Kate', command: 'kate', desktop: 'org.kde.kate' },
  // Windows Notepad: the last resort when nothing else is installed.
  { id: 'notepad', name: 'Notepad', command: 'notepad', win: '' }
] as const

/** Editors actually installed on this machine. */
export async function detectEditors(): Promise<EditorEntry[]> {
  const found: EditorEntry[] = []
  for (const e of KNOWN_EDITORS) {
    const [inPath, appPath] = await Promise.all([
      hasCommand(e.command),
      hasApplication({
        command: e.command,
        macApp: 'mac' in e ? e.mac : undefined,
        desktopFile: 'desktop' in e ? e.desktop : undefined,
        winPath: 'win' in e ? e.win : undefined
      })
    ])
    if (!inPath && !appPath) continue
    found.push({
      id: e.id,
      name: e.name,
      command: inPath ? e.command : undefined,
      appPath
    })
  }
  // The file manager is always available — sometimes that is exactly what is wanted.
  found.push({
    id: 'finder',
    name: IS_MAC ? 'Reveal in Finder' : IS_WIN ? 'Reveal in Explorer' : 'Reveal in file manager'
  })
  return found
}

export async function openInEditor(editorId: string, path: string): Promise<void> {
  if (editorId === 'finder') {
    // `shell.showItemInFolder` already knows how to open a folder on each system.
    shell.showItemInFolder(path)
    return
  }

  const editor = (await detectEditors()).find((e) => e.id === editorId)
  if (!editor) throw new Error(`Unknown editor: ${editorId}`)

  // The CLI opens the directory in an existing window; launching the app only raises it.
  if (editor.command) {
    await execFileAsync(loginShell(), shellArgs(`${editor.command} ${shellQuote(path)}`), {
      timeout: 10_000
    })
    return
  }
  if (editor.appPath) {
    await openWithApplication(editor.appPath, path)
    return
  }
  throw new Error(`No way to open ${editor.name}`)
}

// ─── Skills ──────────────────────────────────────────────────────────────────

export interface SkillEntry {
  name: string
  description?: string
}

async function readSkillListing(file: string): Promise<SkillEntry[]> {
  try {
    const text = await readFile(file, 'utf8')
    let result: SkillEntry[] = []
    for (const line of text.split('\n')) {
      // Cheap pre-check: parsing every line of a long transcript is expensive.
      if (!line.includes('"skill_listing"')) continue
      try {
        const obj = JSON.parse(line) as {
          attachment?: { type?: string; names?: string[]; content?: string }
        }
        const att = obj.attachment
        if (att?.type !== 'skill_listing' || !Array.isArray(att.names)) continue

        // `content` is a markdown list of "- name: description".
        const descriptions = new Map<string, string>()
        for (const row of (att.content ?? '').split('\n')) {
          const m = /^-\s+([a-z0-9:_-]+):\s*(.+)$/i.exec(row.trim())
          if (m) descriptions.set(m[1], m[2].trim())
        }
        result = att.names.map((name) => ({ name, description: descriptions.get(name) }))
      } catch {
        continue
      }
    }
    return result
  } catch {
    return []
  }
}

/**
 * The skill list. The CLI publishes it in a `skill_listing` attachment inside the
 * transcript — the only source that matches what the model actually sees, since it
 * already accounts for plugins, project settings and account availability.
 */
export async function listSkills(): Promise<SkillEntry[]> {
  const dirs = await readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])
  let newest: { mtime: number; skills: SkillEntry[] } | undefined

  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dirPath = join(PROJECTS_DIR, d.name)
    const files = await readdir(dirPath).catch(() => [] as string[])
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const filePath = join(dirPath, f)
      const mtime = await stat(filePath)
        .then((s) => s.mtimeMs)
        .catch(() => 0)
      if (newest && mtime <= newest.mtime) continue
      const skills = await readSkillListing(filePath)
      if (skills.length) newest = { mtime, skills }
    }
  }
  return newest?.skills ?? []
}
