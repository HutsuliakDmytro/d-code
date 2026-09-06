import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, delimiter } from 'node:path'
import { warn } from '../log'

const execFileAsync = promisify(execFile)

export const IS_MAC = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'
export const IS_WIN = process.platform === 'win32'

/** Quotes an argument for the shell. */
export function shellQuote(value: string): string {
  if (IS_WIN) {
    // cmd.exe does not understand single-quoted strings at all — it has its own rules.
    return `"${value.replace(/"/g, '""')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Shell used to run commands the way the user's own shell would.
 *
 * A login shell is not a convenience here: a GUI process on macOS inherits a
 * trimmed PATH with neither `~/.local/bin` nor nvm on it — which is exactly where
 * `claude` usually lives. Windows does not have this problem: Explorer hands
 * processes the full PATH, so plain `cmd` is enough.
 */
export function loginShell(): string {
  if (IS_WIN) return process.env.ComSpec || 'cmd.exe'
  if (IS_MAC) return '/bin/zsh'
  return process.env.SHELL || '/bin/bash'
}

/**
 * Shell arguments for running a single command line.
 *
 * Unix shells take `-lc`, cmd.exe takes `/d /s /c`. The cmd flags are not
 * cosmetic: `/d` disables registry autorun scripts, which would otherwise mix
 * their own output into stdout and break result parsing.
 */
export function shellArgs(command: string): string[] {
  return IS_WIN ? ['/d', '/s', '/c', command] : ['-lc', command]
}

/** Command that prints the path to an executable. */
export function whichCommand(name: string): string {
  return IS_WIN ? `where ${name}` : `command -v ${name}`
}

/**
 * Plan usage history file, written by the Claude desktop app.
 *
 * On Linux that app does not exist at all, so this path deliberately points
 * nowhere: the reader survives it and simply has no history, while current
 * percentages come from polling the CLI anyway.
 */
export function planUsageHistoryPath(): string {
  if (IS_MAC) {
    return join(homedir(), 'Library', 'Application Support', 'Claude', 'plan-usage-history.json')
  }
  if (IS_WIN) {
    const base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    return join(base, 'Claude', 'plan-usage-history.json')
  }
  // Where Electron apps put their data on Linux, per XDG.
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'Claude', 'plan-usage-history.json')
}

/** Linux terminal emulators, in order of how common they are. */
const LINUX_TERMINALS = [
  { command: 'x-terminal-emulator', args: (cmd: string) => ['-e', 'sh', '-c', cmd] },
  { command: 'gnome-terminal', args: (cmd: string) => ['--', 'sh', '-c', cmd] },
  { command: 'konsole', args: (cmd: string) => ['-e', 'sh', '-c', cmd] },
  { command: 'xfce4-terminal', args: (cmd: string) => ['-e', `sh -c ${shellQuote(cmd)}`] },
  { command: 'alacritty', args: (cmd: string) => ['-e', 'sh', '-c', cmd] },
  { command: 'kitty', args: (cmd: string) => ['sh', '-c', cmd] },
  { command: 'xterm', args: (cmd: string) => ['-e', 'sh', '-c', cmd] }
]

/** Whether a command exists on PATH. */
export async function hasCommand(command: string): Promise<boolean> {
  if (!command) return false
  try {
    await execFileAsync(loginShell(), shellArgs(whichCommand(command)), { timeout: 4000 })
    return true
  } catch {
    return false
  }
}

/** Escapes a string for an AppleScript literal. */
function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Runs a command in a new terminal window.
 *
 * The CLI's interactive modes (TUI, Remote Control) need a real terminal, which
 * Electron cannot render, so they are handed to the system. Linux has no single
 * way to do this, hence walking a list of emulators until one is found.
 */
export async function runInTerminal(command: string): Promise<void> {
  if (IS_MAC) {
    const script = `tell application "Terminal"
  activate
  do script "${escapeAppleScript(command)}"
end tell`
    await execFileAsync('osascript', ['-e', script], { timeout: 10_000 })
    return
  }

  if (IS_WIN) {
    // Windows Terminal is nicer, but it is not on every machine.
    if (await hasCommand('wt')) {
      await execFileAsync('wt.exe', ['cmd', '/k', command], { timeout: 10_000 })
      return
    }
    // `start` is a cmd builtin with no executable of its own, so it goes through
    // the shell. The empty string after it is the window title: without it cmd
    // treats the first quoted argument as the title and launches nothing.
    await execFileAsync(loginShell(), ['/d', '/s', '/c', `start "" cmd /k ${command}`], {
      timeout: 10_000
    })
    return
  }

  for (const terminal of LINUX_TERMINALS) {
    if (!(await hasCommand(terminal.command))) continue
    // No need to keep the window open after the CLI exits: the session ends there,
    // and an empty window would only be in the way.
    await execFileAsync(terminal.command, terminal.args(command), { timeout: 10_000 })
    return
  }

  throw new Error('no terminal emulator found (try installing xterm)')
}

/** Editor candidates: a command on PATH or an installed application. */
export interface EditorProbe {
  /** Command to look for on PATH. */
  command: string
  /** Bundle name on macOS. */
  macApp?: string
  /** .desktop file name on Linux. */
  desktopFile?: string
  /** Path relative to the Windows program directories. */
  winPath?: string
}

/** Directories Windows installs programs into. */
function windowsProgramDirs(): string[] {
  return [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : undefined,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramW6432
  ].filter((dir): dir is string => Boolean(dir))
}

/** Locates an application that cannot be found through PATH. */
export async function hasApplication(probe: EditorProbe): Promise<string | undefined> {
  if (IS_MAC) {
    if (!probe.macApp) return undefined
    const path = `/Applications/${probe.macApp}.app`
    try {
      await access(path, constants.F_OK)
      return path
    } catch {
      return undefined
    }
  }

  if (IS_WIN) {
    if (!probe.winPath) return undefined
    for (const dir of windowsProgramDirs()) {
      const path = join(dir, probe.winPath)
      try {
        await access(path, constants.F_OK)
        return path
      } catch {
        continue
      }
    }
    return undefined
  }

  if (!probe.desktopFile) return undefined
  const dirs = [
    join(homedir(), '.local/share/applications'),
    '/usr/share/applications',
    '/var/lib/flatpak/exports/share/applications'
  ]
  for (const dir of dirs) {
    const path = join(dir, `${probe.desktopFile}.desktop`)
    try {
      await access(path, constants.F_OK)
      return path
    } catch {
      continue
    }
  }
  return undefined
}

/** Opens a path with an application found outside PATH. */
export async function openWithApplication(appPath: string, target: string): Promise<void> {
  if (IS_MAC) {
    await execFileAsync('open', ['-a', appPath, target], { timeout: 10_000 })
    return
  }
  if (IS_WIN) {
    // Here appPath is the .exe itself, so it runs directly.
    await execFileAsync(appPath, [target], { timeout: 10_000 })
    return
  }
  try {
    await execFileAsync('gio', ['launch', appPath, target], { timeout: 10_000 })
  } catch {
    // gio is not everywhere; xdg-open picks no specific app but opens something.
    warn('[platform] gio unavailable, falling back to xdg-open')
    await execFileAsync('xdg-open', [target], { timeout: 10_000 })
  }
}

/**
 * Usual locations of `claude` outside PATH.
 *
 * On Windows the CLI is installed either by global npm or by the native
 * installer, and Explorer does not always put either directory on PATH.
 */
export function claudeFallbackPaths(): string[] {
  if (IS_WIN) {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return [
      join(appData, 'npm', 'claude.cmd'),
      join(appData, 'npm', 'claude.exe'),
      join(localAppData, 'Programs', 'claude', 'claude.exe'),
      join(homedir(), '.local', 'bin', 'claude.exe'),
      join(homedir(), '.bun', 'bin', 'claude.exe')
    ]
  }
  return [
    join(homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(homedir(), '.bun/bin/claude'),
    join(homedir(), '.volta/bin/claude')
  ]
}

/** Directories worth appending to a child process PATH. */
export function extraPathDirs(): string[] {
  if (IS_WIN) {
    const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    return [join(appData, 'npm'), join(localAppData, 'Programs', 'claude')]
  }
  return [
    join(homedir(), '.local/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ]
}

/** PATH separator: a colon everywhere, a semicolon on Windows. */
export const PATH_DELIMITER = delimiter

/**
 * Whether this file has to be run through a shell.
 *
 * Windows cannot launch `.cmd`/`.bat` directly — they are not executables but
 * scripts for cmd.exe, and Node fails with EINVAL. `.cmd` is exactly the form npm
 * uses for global packages, so without this neither the language server nor the
 * CLI itself would start when installed through npm.
 */
export function needsShell(command: string): boolean {
  return IS_WIN && /\.(cmd|bat)$/i.test(command)
}

/** Default shell for the embedded terminal. */
export function defaultTerminalShell(): string {
  if (IS_WIN) return process.env.ComSpec || 'cmd.exe'
  return process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash')
}
