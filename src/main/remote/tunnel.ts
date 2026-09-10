import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { childEnv } from '../claude/resolve-cli'
import { hasCommand } from '../system/platform'
import { splitCommand } from '../system/settings-edit'

/**
 * Reaching the phone server from outside the local network.
 *
 * A tunnel rather than a forwarded port, because the tunnel is an outbound
 * connection: no router configuration, carrier-grade NAT is not an obstacle,
 * and TLS is terminated for us. Port forwarding would publish an unencrypted
 * remote shell on a fixed address and have it found by scanners within the hour.
 *
 * There is deliberately more than one provider. Whichever service is picked
 * becomes a single point of failure — `trycloudflare.com` in particular is
 * filtered outright by a number of ISPs, and an app that hard-codes it simply
 * stops working for those users with no way out. The trade in every case is
 * that traffic passes through somebody's relay, which is why the provider is
 * named in the interface rather than hidden.
 */

export type TunnelStatus = 'off' | 'starting' | 'up' | 'error'

export type TunnelProvider = 'cloudflare' | 'pinggy' | 'custom'

export interface TunnelState {
  status: TunnelStatus
  /** Public https URL, once the provider has assigned one. */
  url?: string
  error?: string
  provider: TunnelProvider
  /** Providers whose command is actually present on this machine. */
  available: TunnelProvider[]
  /** Minutes the provider grants before it drops the tunnel, when it says so. */
  sessionMinutes?: number
}

interface ProviderSpec {
  /** Command that must exist for the provider to be offered at all. */
  command: string
  args(port: number): string[]
  env?: Record<string, string>
  /** Extracts the public address from the provider's own chatter. */
  urlPattern: RegExp
  sessionMinutes?: number
}

/**
 * `ssh` carries its password prompt to a terminal, not to stdin, so a
 * subprocess with piped stdio can never answer it. `SSH_ASKPASS` is the
 * documented way out: OpenSSH runs that program and reads the password from
 * its output. `true` prints nothing, which is exactly the empty password
 * Pinggy's anonymous tunnels expect. `SSH_ASKPASS_REQUIRE=force` is what makes
 * OpenSSH consult it even though no terminal is attached.
 */
const SSH_EMPTY_PASSWORD_ENV = {
  SSH_ASKPASS: '/usr/bin/true',
  SSH_ASKPASS_REQUIRE: 'force'
}

const PROVIDERS: Record<Exclude<TunnelProvider, 'custom'>, ProviderSpec> = {
  cloudflare: {
    command: 'cloudflared',
    args: (port) => [
      'tunnel',
      '--url',
      `http://127.0.0.1:${port}`,
      // The app is not a service manager; an update mid-session would only drop
      // the connection at an unpredictable moment.
      '--no-autoupdate'
    ],
    urlPattern: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
  },
  pinggy: {
    // ssh ships with macOS, every Linux and Windows 10 onwards, so this is the
    // provider that needs nothing installed on either end.
    command: 'ssh',
    args: (port) => [
      // Port 443 rather than 22: plenty of networks filter outbound ssh, and
      // almost none filter 443.
      '-p',
      '443',
      // accept-new records the key the first time and still shouts if it later
      // changes — unlike `no`, which would accept any key forever.
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'NumberOfPasswordPrompts=1',
      // A tunnel that silently goes deaf is worse than one that dies loudly.
      '-o',
      'ServerAliveInterval=30',
      '-o',
      'ExitOnForwardFailure=yes',
      `-R0:localhost:${port}`,
      'a.pinggy.io'
    ],
    env: SSH_EMPTY_PASSWORD_ENV,
    urlPattern: /https:\/\/[a-z0-9-]+\.(?:free\.pinggy\.net|run\.pinggy-free\.link)/i,
    sessionMinutes: 60
  }
}

/** Any https address, for a command whose output we cannot know in advance. */
const ANY_URL = /https:\/\/[^\s"'<>]+/i

export interface ResolvedTunnel {
  command: string
  args: string[]
  env?: Record<string, string>
  /** What to look for in the provider's output. */
  pattern: RegExp
}

/**
 * What to run for a given provider, or a reason it cannot be run.
 *
 * A custom command may use `{port}` wherever the local port belongs. Splitting
 * is quote-aware but deliberately not a shell: anything needing pipes or
 * redirection belongs in a script, not in a settings field.
 */
export function tunnelCommand(
  provider: TunnelProvider,
  port: number,
  custom?: string
): ResolvedTunnel | string {
  if (provider === 'custom') {
    const line = (custom ?? '').trim()
    if (!line) return 'No command set for the custom provider'
    const parts = splitCommand(line.replace(/\{port\}/g, String(port)))
    if (parts.length === 0) return 'The custom command is empty'
    return { command: parts[0], args: parts.slice(1), pattern: ANY_URL }
  }

  const spec = PROVIDERS[provider]
  if (!spec) return `Unknown tunnel provider: ${provider}`
  return { command: spec.command, args: spec.args(port), env: spec.env, pattern: spec.urlPattern }
}

/** Providers usually answer within seconds; past this something is wrong. */
const STARTUP_TIMEOUT_MS = 60_000

/** How much of the provider's output to keep for a failure message. */
const OUTPUT_LINES = 40

export class TunnelRunner extends EventEmitter {
  private child?: ChildProcess
  private state: TunnelState = { status: 'off', provider: 'cloudflare', available: [] }
  private timer?: ReturnType<typeof setTimeout>
  private output: string[] = []
  /** Set while a stop was asked for, so the exit is not read as a crash. */
  private stopping = false

  getState(): TunnelState {
    return this.state
  }

  private set(patch: Partial<TunnelState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  /**
   * Which providers this machine can actually run.
   *
   * Re-checked on every call rather than probed once at startup: `cloudflared`
   * is often installed precisely because the panel just said it was missing.
   */
  async checkAvailable(): Promise<TunnelProvider[]> {
    const found: TunnelProvider[] = []
    for (const [id, spec] of Object.entries(PROVIDERS)) {
      if (await hasCommand(spec.command)) found.push(id as TunnelProvider)
    }
    // A custom command is always on offer; whether it works is the user's business.
    found.push('custom')
    this.set({ available: found })
    return found
  }

  async start(port: number, provider: TunnelProvider, custom?: string): Promise<TunnelState> {
    if (this.child) return this.state

    const resolved = tunnelCommand(provider, port, custom)
    if (typeof resolved === 'string') {
      this.set({ status: 'error', provider, error: resolved, url: undefined })
      return this.state
    }

    if (!(await hasCommand(resolved.command))) {
      this.set({
        status: 'error',
        provider,
        error: `${resolved.command} is not installed`,
        url: undefined
      })
      return this.state
    }

    this.stopping = false
    this.output = []
    this.set({
      status: 'starting',
      provider,
      url: undefined,
      error: undefined,
      sessionMinutes: provider === 'custom' ? undefined : PROVIDERS[provider].sessionMinutes
    })

    const child = spawn(resolved.command, resolved.args, {
      env: { ...(await childEnv()), ...resolved.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child = child

    // Providers scatter the address across stdout and stderr as they please.
    const onOutput = (chunk: Buffer): void => {
      const text = chunk.toString()
      this.remember(text)
      if (this.state.url) return

      const match = resolved.pattern.exec(text)
      if (!match) return
      if (this.timer) clearTimeout(this.timer)
      this.set({ status: 'up', url: match[0], error: undefined })
    }
    child.stderr?.on('data', onOutput)
    child.stdout?.on('data', onOutput)

    child.on('error', (err: Error) => {
      this.child = undefined
      this.set({ status: 'error', error: err.message, url: undefined })
    })

    child.on('exit', (code) => {
      if (this.timer) clearTimeout(this.timer)
      this.child = undefined
      if (this.stopping) return

      this.set({
        status: 'error',
        url: undefined,
        error: code === 0 ? 'the tunnel closed' : this.failureMessage(code)
      })
    })

    this.timer = setTimeout(() => {
      if (this.state.status !== 'starting') return
      const reason = this.failureMessage(null, 'no address came back in time')
      void this.stop().then(() => this.set({ status: 'error', provider, error: reason }))
    }, STARTUP_TIMEOUT_MS)
    this.timer.unref?.()

    return this.state
  }

  /** Keeps the tail of the provider's output so a failure can explain itself. */
  private remember(text: string): void {
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed) this.output.push(trimmed)
    }
    if (this.output.length > OUTPUT_LINES) {
      this.output.splice(0, this.output.length - OUTPUT_LINES)
    }
  }

  /**
   * The message shown in the panel when the tunnel fails.
   *
   * An exit status on its own is useless — "code 1" tells nobody what to do.
   * Every provider explains itself in its output, so its own last words are
   * what gets surfaced, with the code only as a last resort.
   */
  private failureMessage(code: number | null, fallback?: string): string {
    // Startup banners are noise; the failure is on the lines that say so.
    const errors = this.output.filter((line) => /\bERR\b|\berror\b|failed|denied|refused/i.test(line))
    const detail = (errors.length ? errors : this.output)
      .slice(-2)
      // Drop a leading timestamp and level so the panel stays readable.
      .map((line) => line.replace(/^\S+\s+(INF|ERR|WRN|DBG)\s*/, ''))
      .join(' · ')
      .slice(0, 400)

    if (detail) return detail
    if (fallback) return fallback
    return `the tunnel command exited with code ${code}`
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined

    const child = this.child
    this.child = undefined
    // Set before killing, so the exit handler knows this was deliberate and
    // does not report it as a failure.
    this.stopping = true
    this.set({ status: 'off', url: undefined, error: undefined })
    if (!child) return

    await new Promise<void>((resolve) => {
      const done = setTimeout(() => {
        // SIGTERM is normally enough; this is for a wedged process.
        child.kill('SIGKILL')
        resolve()
      }, 5000)
      done.unref?.()
      child.once('exit', () => {
        clearTimeout(done)
        resolve()
      })
      child.kill('SIGTERM')
    })
  }
}
