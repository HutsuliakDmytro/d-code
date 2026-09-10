import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import type { PermissionReply, PermissionRequest } from '@shared/ipc'
import { mobilePage } from './mobile-page'

/**
 * Driving a running session from a phone.
 *
 * The security model, stated plainly because it is the whole design: this
 * server can make Claude Code run commands on this machine, so it is off by
 * default, bound to the local network only, and reachable exclusively with a
 * token the browser gets by entering a short-lived pairing code. It is not
 * meant to face the internet — there is no TLS here, and forwarding the port
 * through a router would publish a remote shell.
 */

export interface RemoteMessage {
  uuid: string
  role: 'user' | 'assistant'
  text: string
  /** Tool names used in this message; the phone shows them as chips. */
  tools: string[]
  timestamp: string
}

export interface RemoteTab {
  id: string
  title: string
  cwd?: string
  status: string
  model?: string
  sessionId?: string
  /** A tool call is waiting for a decision. */
  pending?: PermissionRequest
}

/** What the server needs from the app. Kept narrow so it can be tested alone. */
export interface RemoteBridge {
  listTabs(): RemoteTab[]
  send(tabId: string, text: string): void
  interrupt(tabId: string): void
  replyPermission(tabId: string, requestId: string, reply: PermissionReply): void
  /** Conversation so far, so a phone joining mid-session sees the context. */
  history(tabId: string): Promise<RemoteMessage[]>
}

/**
 * An address the phone can be pointed at.
 *
 * The kind matters to the person reading it: a tailnet address keeps working
 * from mobile data on the other side of the country, a LAN one stops at the
 * front door. Labelling both "your address" would mislead.
 */
export interface RemoteAddress {
  url: string
  kind: 'lan' | 'tailscale'
}

export interface RemoteServerState {
  running: boolean
  port?: number
  /** Addresses the phone can be pointed at, tailnet ones first. */
  urls: RemoteAddress[]
  /** Present until a device pairs; regenerated after too many wrong guesses. */
  pairingCode?: string
  pairingExpiresAt?: number
  /** Devices holding a valid token right now. */
  clients: number
  error?: string
  /** True once the server is reachable from outside the local network. */
  isPublic: boolean
  /** Set after too many wrong codes overall; a new code has to be issued by hand. */
  pairingLocked: boolean
}

export const DEFAULT_REMOTE_PORT = 8317

/** How long a pairing code stays valid. Long enough to walk to the phone. */
const PAIRING_TTL_MS = 10 * 60 * 1000

/** Wrong codes tolerated from one address before it has to wait. */
const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 60 * 1000

/**
 * Wrong codes tolerated in total before pairing shuts down.
 *
 * The per-address lockout above is useless against someone who can rotate
 * addresses, which is exactly what a public URL exposes the server to. This
 * budget is the one that actually bounds a distributed guess: after it, no code
 * works until a human issues a new one in the app.
 */
const GLOBAL_FAILURE_BUDGET = 20

/** Messages kept per tab. A phone does not need the whole history in memory. */
const HISTORY_LIMIT = 200

const SSE_HEARTBEAT_MS = 25_000

/** Constant-time compare that does not leak length through early return. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) {
    // Still compare something, so a wrong length costs the same as a wrong value.
    timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}

/** Reads a single cookie without pulling in a parser. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

/**
 * Alphabet without the characters people mistype from a screen: no O/0, no I/1.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * A pairing code.
 *
 * Six digits is fine on a home network, where an attacker has to already be on
 * it. A public URL is a different problem: `strong` switches to ten characters
 * of a 32-symbol alphabet — about 50 bits, which no amount of guessing gets
 * through before the global budget above trips.
 */
export function makePairingCode(strong = false): string {
  if (!strong) return String(randomInt(0, 1_000_000)).padStart(6, '0')
  let code = ''
  for (let i = 0; i < 10; i++) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  return code
}

/**
 * Whether an address belongs to a tailnet.
 *
 * Tailscale assigns every node an address out of the carrier-grade NAT block
 * `100.64.0.0/10`, reserved by RFC 6598 and used by nothing else a laptop is
 * likely to hold. That single range is the whole detection: no process to
 * shell out to, nothing to parse, and it stays true whether Tailscale was
 * installed from their package, Homebrew or the App Store.
 */
export function isTailscaleAddress(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  // 100.64.0.0/10 spans the second octet from 64 to 127.
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

/**
 * Addresses this machine can be reached at, tailnet ones first.
 *
 * Loopback is excluded: the entire point is another device, and showing
 * `127.0.0.1` to someone about to type it into a phone wastes their time.
 */
export function localAddresses(): Array<{ ip: string; kind: RemoteAddress['kind'] }> {
  const found: Array<{ ip: string; kind: RemoteAddress['kind'] }> = []
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      found.push({
        ip: address.address,
        kind: isTailscaleAddress(address.address) ? 'tailscale' : 'lan'
      })
    }
  }
  // A tailnet address works from anywhere, so it is the more useful one to
  // offer first — the LAN address is only better when both devices are home.
  return found.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'tailscale' ? -1 : 1))
}

const COOKIE_NAME = 'd_code_remote'

interface Attempt {
  failures: number
  lockedUntil: number
}

export type PairingVerdict = 'ok' | 'locked-out' | 'locked'

/**
 * The two limits that bound guessing, kept apart from the HTTP plumbing so the
 * rules can be read — and tested — without a socket.
 *
 * They protect against different attackers and must not be merged. The
 * per-address lockout stops one client hammering; it deliberately does *not*
 * count toward the global budget, or a single address could lock the owner out
 * of their own machine. The global budget stops someone spreading guesses
 * across many addresses, which is the shape of the attack a public URL invites.
 */
export class PairingGuard {
  private attempts = new Map<string, Attempt>()
  private total = 0
  private locked = false

  constructor(
    private maxPerAddress = MAX_ATTEMPTS,
    private lockoutMs = LOCKOUT_MS,
    private budget = GLOBAL_FAILURE_BUDGET
  ) {}

  get isLocked(): boolean {
    return this.locked
  }

  /** Whether this address may attempt a code right now. */
  check(key: string, now = Date.now()): PairingVerdict {
    if (this.locked) return 'locked'
    const attempt = this.attempts.get(key)
    if (attempt && now < attempt.lockedUntil) return 'locked-out'
    return 'ok'
  }

  /**
   * Records a wrong code. Returns what changed, so the caller knows whether to
   * reissue the code or shut pairing down.
   */
  fail(key: string, now = Date.now()): { locked: boolean; lockedOut: boolean } {
    this.total += 1
    if (this.total >= this.budget) {
      this.locked = true
      return { locked: true, lockedOut: false }
    }

    const attempt = this.attempts.get(key) ?? { failures: 0, lockedUntil: 0 }
    attempt.failures += 1

    let lockedOut = false
    if (attempt.failures >= this.maxPerAddress) {
      attempt.failures = 0
      attempt.lockedUntil = now + this.lockoutMs
      lockedOut = true
    }
    this.attempts.set(key, attempt)
    return { locked: false, lockedOut }
  }

  /** A correct code clears that address and the global tally. */
  succeed(key: string): void {
    this.attempts.delete(key)
    this.total = 0
  }

  /** Called when a human issues a new code: everything starts over. */
  reset(): void {
    this.attempts.clear()
    this.total = 0
    this.locked = false
  }
}

export class RemoteServer extends EventEmitter {
  private server?: Server
  private port = DEFAULT_REMOTE_PORT
  private token?: string
  private pairingCode?: string
  private pairingExpiresAt = 0
  private guard = new PairingGuard()
  private streams = new Set<ServerResponse>()
  private heartbeat?: ReturnType<typeof setInterval>
  private messages = new Map<string, RemoteMessage[]>()
  private seeded = new Set<string>()
  private error?: string
  private isPublic = false
  private pairingLocked = false

  constructor(private bridge: RemoteBridge) {
    super()
  }

  getState(): RemoteServerState {
    return {
      running: Boolean(this.server),
      port: this.server ? this.port : undefined,
      urls: this.server
        ? localAddresses().map(({ ip, kind }) => ({ url: `http://${ip}:${this.port}`, kind }))
        : [],
      pairingCode: this.server ? this.pairingCode : undefined,
      pairingExpiresAt: this.server ? this.pairingExpiresAt : undefined,
      clients: this.streams.size,
      error: this.error,
      isPublic: this.isPublic,
      pairingLocked: this.pairingLocked
    }
  }

  /**
   * Marks the server as reachable from outside.
   *
   * Turning this on reissues the code at the stronger length — a six-digit code
   * that was fine a moment ago is not fine on a public address, and silently
   * leaving it in place would be the whole vulnerability.
   */
  setPublic(isPublic: boolean): void {
    if (this.isPublic === isPublic) return
    this.isPublic = isPublic
    if (isPublic) this.newPairingCode()
    else this.announce()
  }

  private announce(): void {
    this.emit('state', this.getState())
  }

  /** Shuts pairing down until a person issues a new code in the app. */
  private lockPairing(): void {
    if (this.pairingLocked) return
    this.pairingLocked = true
    this.pairingCode = undefined
    this.announce()
  }

  async start(port = DEFAULT_REMOTE_PORT): Promise<RemoteServerState> {
    if (this.server) return this.getState()

    this.port = port
    this.error = undefined
    this.token = randomBytes(32).toString('base64url')
    this.newPairingCode()

    const server = createServer((req, res) => {
      this.handle(req, res).catch((err: Error) => {
        this.json(res, 500, { error: err.message })
      })
    })

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        // 0.0.0.0 rather than a specific interface: a laptop moves between
        // networks and its LAN address changes with it.
        server.listen(port, '0.0.0.0', () => {
          server.off('error', reject)
          resolve()
        })
      })
    } catch (err) {
      this.error = (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `Port ${port} is already taken`
        : (err as Error).message
      this.announce()
      return this.getState()
    }

    // Port 0 means "any free one" — the number only exists after listen, and it
    // is what has to be shown to the user and reported back.
    const address = server.address()
    if (address && typeof address === 'object') this.port = address.port

    this.server = server
    this.heartbeat = setInterval(() => {
      for (const stream of this.streams) stream.write(': ping\n\n')
    }, SSE_HEARTBEAT_MS)
    // Node keeps running for a bare interval; the app's lifetime should not
    // depend on this one.
    this.heartbeat.unref?.()

    this.announce()
    return this.getState()
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined

    for (const stream of this.streams) stream.end()
    this.streams.clear()

    const server = this.server
    this.server = undefined
    this.token = undefined
    this.pairingCode = undefined
    this.guard.reset()
    this.isPublic = false
    this.pairingLocked = false

    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    this.announce()
  }

  /** Issues a fresh code and invalidates the previous one. */
  newPairingCode(): string {
    this.pairingCode = makePairingCode(this.isPublic)
    this.pairingExpiresAt = Date.now() + PAIRING_TTL_MS
    this.pairingLocked = false
    this.guard.reset()
    this.announce()
    return this.pairingCode
  }

  // ─── Event intake ──────────────────────────────────────────────────────────

  /** Records a message and pushes it to every connected phone. */
  addMessage(tabId: string, message: RemoteMessage): void {
    const list = this.messages.get(tabId) ?? []
    if (list.some((m) => m.uuid === message.uuid)) return
    list.push(message)
    if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT)
    this.messages.set(tabId, list)
    this.push({ type: 'message', tabId, message })
  }

  /** Partial assistant text, so the phone shows the turn as it is written. */
  pushDelta(tabId: string, text: string): void {
    this.push({ type: 'delta', tabId, text })
  }

  /** Re-sends the tab list; the phone's header and status dot follow it. */
  pushTabs(): void {
    this.push({ type: 'tabs', tabs: this.bridge.listTabs() })
  }

  pushPermission(tabId: string, request: PermissionRequest): void {
    this.push({ type: 'permission', tabId, request })
  }

  pushTurnEnd(tabId: string): void {
    this.push({ type: 'turn-end', tabId })
  }

  private push(payload: unknown): void {
    if (this.streams.size === 0) return
    const line = `data: ${JSON.stringify(payload)}\n\n`
    for (const stream of this.streams) stream.write(line)
  }

  // ─── HTTP ──────────────────────────────────────────────────────────────────

  private authorised(req: IncomingMessage): boolean {
    const supplied = readCookie(req.headers.cookie, COOKIE_NAME)
    return Boolean(this.token && supplied && safeEqual(supplied, this.token))
  }

  private clientKey(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? 'unknown'
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
      // The page is served from this origin only; nothing else may read it.
      'access-control-allow-origin': 'null',
      'x-content-type-options': 'nosniff'
    })
    res.end(text)
  }

  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      // A phone sends prompts, not uploads. The cap keeps a stray client from
      // filling memory.
      if (size > 256 * 1024) throw new Error('Request too large')
      chunks.push(chunk as Buffer)
    }
    if (chunks.length === 0) return {}
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    if (path === '/' || path === '/index.html') {
      const scanned = url.searchParams.get('c')
      // A failed scan falls through to the page, which asks for the code.
      if (scanned && this.handleScan(req, res, scanned)) return

      const page = mobilePage()
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(page),
        // Everything is inline and same-origin; nothing external may load.
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      })
      res.end(page)
      return
    }

    if (path === '/api/pair' && req.method === 'POST') {
      await this.handlePair(req, res)
      return
    }

    if (!this.authorised(req)) {
      this.json(res, 401, { error: 'not paired' })
      return
    }

    if (path === '/api/events') {
      this.handleEvents(req, res)
      return
    }
    if (path === '/api/tabs' && req.method === 'GET') {
      this.json(res, 200, { tabs: this.bridge.listTabs() })
      return
    }

    const match = /^\/api\/tabs\/([^/]+)\/(messages|send|interrupt|permission)$/.exec(path)
    if (match) {
      await this.handleTab(req, res, decodeURIComponent(match[1]), match[2])
      return
    }

    this.json(res, 404, { error: 'not found' })
  }

  /**
   * Checks a supplied code against the current one.
   *
   * Shared by the form on the page and the `?c=` a scanned QR carries, so a
   * scan is subject to exactly the same expiry, lockout and global budget as
   * typing — the QR is a convenience, not a second door.
   */
  private verifyCode(req: IncomingMessage, supplied: string): { status: number; error?: string } {
    if (this.pairingLocked) {
      return { status: 423, error: 'pairing is locked — issue a new code on the computer' }
    }

    const key = this.clientKey(req)
    const verdict = this.guard.check(key)
    if (verdict === 'locked-out') return { status: 429, error: 'too many attempts, wait a minute' }
    if (verdict === 'locked') {
      this.lockPairing()
      return { status: 423, error: 'pairing is locked — issue a new code on the computer' }
    }
    if (!this.pairingCode || Date.now() > this.pairingExpiresAt) {
      return { status: 410, error: 'the code has expired — generate a new one' }
    }

    if (!safeEqual(supplied.trim().toUpperCase(), this.pairingCode)) {
      const outcome = this.guard.fail(key)
      if (outcome.locked) {
        // Somebody is guessing. Nothing pairs again until a person intervenes.
        this.lockPairing()
        return { status: 423, error: 'pairing is locked — issue a new code on the computer' }
      }
      if (outcome.lockedOut) {
        // A guessed-at code is a burnt code, even if the guesses were wrong.
        this.pairingCode = makePairingCode(this.isPublic)
        this.pairingExpiresAt = Date.now() + PAIRING_TTL_MS
        this.announce()
      }
      return { status: 403, error: 'wrong code' }
    }

    this.guard.succeed(key)
    return { status: 200 }
  }

  /**
   * The Set-Cookie for a paired device.
   *
   * `Secure` only when the request actually arrived over HTTPS — Cloudflare
   * forwards the original scheme — because marking it unconditionally would
   * stop plain-http access on the local network from working at all.
   */
  private sessionCookie(req: IncomingMessage): string {
    const flags = ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=604800']
    if (req.headers['x-forwarded-proto'] === 'https') flags.push('Secure')
    return `${COOKIE_NAME}=${this.token}; ${flags.join('; ')}`
  }

  private async handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.body(req)
    const supplied = typeof body.code === 'string' ? body.code : ''
    const result = this.verifyCode(req, supplied)

    if (result.status !== 200) {
      this.json(res, result.status, { error: result.error })
      return
    }

    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': this.sessionCookie(req)
    })
    res.end(JSON.stringify({ ok: true }))
    this.announce()
  }

  /**
   * Pairing straight from a scanned QR.
   *
   * On success the browser is redirected to `/` without the query, so the code
   * does not linger in the address bar, in history, or in anything the user
   * might later share a screenshot of. On failure the page loads normally and
   * asks for the code by hand.
   */
  private handleScan(req: IncomingMessage, res: ServerResponse, code: string): boolean {
    const result = this.verifyCode(req, code)
    if (result.status !== 200) return false

    res.writeHead(303, {
      location: '/',
      'set-cookie': this.sessionCookie(req),
      'referrer-policy': 'no-referrer'
    })
    res.end()
    this.announce()
    return true
  }

  /** The address a QR should carry: the page, plus the code to pair with. */
  pairingUrl(base: string): string | undefined {
    if (!this.pairingCode) return undefined
    return `${base.replace(/\/$/, '')}/?c=${encodeURIComponent(this.pairingCode)}`
  }

  private handleEvents(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    res.write('retry: 3000\n\n')
    res.write(`data: ${JSON.stringify({ type: 'tabs', tabs: this.bridge.listTabs() })}\n\n`)

    this.streams.add(res)
    this.announce()

    const drop = (): void => {
      this.streams.delete(res)
      this.announce()
    }
    req.on('close', drop)
    req.on('error', drop)
  }

  private async handleTab(
    req: IncomingMessage,
    res: ServerResponse,
    tabId: string,
    action: string
  ): Promise<void> {
    if (action === 'messages') {
      this.json(res, 200, { messages: await this.historyFor(tabId) })
      return
    }
    if (req.method !== 'POST') {
      this.json(res, 405, { error: 'method not allowed' })
      return
    }

    const body = await this.body(req)
    try {
      if (action === 'send') {
        const text = typeof body.text === 'string' ? body.text : ''
        if (!text.trim()) {
          this.json(res, 400, { error: 'empty message' })
          return
        }
        this.bridge.send(tabId, text)
      } else if (action === 'interrupt') {
        this.bridge.interrupt(tabId)
      } else if (action === 'permission') {
        const requestId = typeof body.requestId === 'string' ? body.requestId : ''
        const allow = body.behavior === 'allow'
        if (!requestId) {
          this.json(res, 400, { error: 'no request id' })
          return
        }
        this.bridge.replyPermission(
          tabId,
          requestId,
          allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'Denied from the phone' }
        )
      }
      this.json(res, 200, { ok: true })
    } catch (err) {
      this.json(res, 400, { error: (err as Error).message })
    }
  }

  /**
   * Conversation for a tab.
   *
   * Seeded once from the transcript so a phone joining an hour into a session
   * sees what happened; live events append after that. The seed flag is set
   * before the await, so a message arriving mid-read cannot trigger a second
   * seed and duplicate the history.
   */
  private async historyFor(tabId: string): Promise<RemoteMessage[]> {
    if (!this.seeded.has(tabId)) {
      this.seeded.add(tabId)
      const past = await this.bridge.history(tabId).catch(() => [])
      const live = this.messages.get(tabId) ?? []
      const seen = new Set(live.map((m) => m.uuid))
      this.messages.set(tabId, [...past.filter((m) => !seen.has(m.uuid)), ...live].slice(-HISTORY_LIMIT))
    }
    return this.messages.get(tabId) ?? []
  }

  /** Drops the cached conversation for a tab that was closed. */
  forget(tabId: string): void {
    this.messages.delete(tabId)
    this.seeded.delete(tabId)
  }
}
