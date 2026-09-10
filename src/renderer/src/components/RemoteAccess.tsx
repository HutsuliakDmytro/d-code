import { useEffect, useState } from 'react'
import { Copy, Globe, Loader2, QrCode, RefreshCw, Smartphone, TriangleAlert } from 'lucide-react'
import type { RemoteQr, RemoteState, TunnelProvider } from '@shared/ipc'
import { useTranslate } from '../i18n'

/** Minutes and seconds left on the pairing code, or undefined once it lapses. */
function remaining(expiresAt: number | undefined, now: number): string | undefined {
  if (!expiresAt) return undefined
  const left = Math.max(0, expiresAt - now)
  if (left === 0) return undefined
  const minutes = Math.floor(left / 60_000)
  const seconds = Math.floor((left % 60_000) / 1000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/**
 * Driving a session from a phone.
 *
 * Deliberately blunt about what it opens: the server lets whoever holds the
 * code make Claude Code run commands on this machine, so the warning sits next
 * to the switch rather than in the documentation.
 */
export default function RemoteAccess(): React.JSX.Element {
  const t = useTranslate()
  const [state, setState] = useState<RemoteState>({
    running: false,
    urls: [],
    clients: 0,
    isPublic: false,
    pairingLocked: false,
    tunnel: { status: 'off', provider: 'cloudflare', available: [] }
  })
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string>()
  const [now, setNow] = useState(Date.now())
  const [codes, setCodes] = useState<RemoteQr[]>([])
  const [shown, setShown] = useState(0)
  const [provider, setProvider] = useState<TunnelProvider>('cloudflare')
  const [customCommand, setCustomCommand] = useState('')
  /** A refusal returned by an action, which never reaches the event stream. */
  const [actionError, setActionError] = useState<string>()

  useEffect(() => {
    void window.claudeUI.remoteStatus().then(setState)
    return window.claudeUI.onRemoteState(setState)
  }, [])

  // Only ticks while a code is live, so an idle app is not waking every second.
  useEffect(() => {
    if (!state.running || !state.pairingExpiresAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [state.running, state.pairingExpiresAt])

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(undefined), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  // Regenerated whenever the code or an address changes, since the QR carries
  // the code and a stale one would simply fail to pair.
  useEffect(() => {
    if (!state.running || state.pairingLocked) {
      setCodes([])
      return
    }
    void window.claudeUI.remoteQrCodes().then((next) => {
      setCodes(next)
      setShown((index) => (index < next.length ? index : 0))
    })
  }, [
    state.running,
    state.pairingCode,
    state.pairingLocked,
    state.urls.map((a) => a.url).join(','),
    state.tunnel.url
  ])

  /**
   * Runs an action and keeps only what the event stream cannot tell us.
   *
   * The returned snapshot is taken the moment the call returns, which for the
   * tunnel is while it is still starting. Assigning it would overwrite the
   * later state that already arrived over `onRemoteState` — the address would
   * vanish from the panel and the QR for it would never be built. So the
   * stream stays the single source of truth, and only a refusal that never
   * reaches the stream is kept.
   */
  async function act(run: () => Promise<RemoteState>): Promise<void> {
    setBusy(true)
    setActionError(undefined)
    try {
      const result = await run()
      if (result.error) setActionError(result.error)
    } finally {
      setBusy(false)
    }
  }

  async function toggle(): Promise<void> {
    await act(() => (state.running ? window.claudeUI.remoteStop() : window.claudeUI.remoteStart()))
  }

  async function toggleTunnel(): Promise<void> {
    const up = state.tunnel.status === 'up' || state.tunnel.status === 'starting'
    await act(() =>
      up
        ? window.claudeUI.remoteTunnelStop()
        : window.claudeUI.remoteTunnelStart(provider, customCommand)
    )
  }

  function copy(text: string): void {
    void navigator.clipboard.writeText(text)
    setCopied(text)
  }

  const countdown = remaining(state.pairingExpiresAt, now)
  const tunnelUp = state.tunnel.status === 'up'
  const tunnelStarting = state.tunnel.status === 'starting'
  const active = codes[shown]
  // A tailnet address already reaches the phone from anywhere, so the tunnel —
  // with its public URL and everything that implies — has nothing left to add.
  const hasTailnet = state.urls.some((address) => address.kind === 'tailscale')

  const installed = (id: TunnelProvider): boolean => state.tunnel.available.includes(id)
  const providerReady = provider === 'custom' ? customCommand.trim().length > 0 : installed(provider)

  const providerNote =
    provider === 'cloudflare'
      ? installed('cloudflare')
        ? t('Nothing to install on the phone — a browser is enough. Traffic passes through Cloudflare, and some ISPs block this one outright.')
        : t('Needs cloudflared: brew install cloudflared, then reopen these settings.')
      : provider === 'pinggy'
        ? t('Rides plain ssh over port 443, which almost nothing blocks — nothing to install on either end. Free tunnels last 60 minutes and the address changes each time.')
        : t('Any command that prints an https address. Use {port} where the local port belongs.')

  return (
    <section className="pt-1 border-t border-[var(--color-border)] space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide
                     text-[var(--color-muted)]">
        <Smartphone size={10} />
        {t('Phone access')}
        {state.running && state.clients > 0 && (
          <span className="text-[9.5px] text-emerald-400 normal-case tracking-normal">
            {t('{count} connected', { count: state.clients })}
          </span>
        )}
      </h3>

      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={state.running}
          disabled={busy}
          onChange={() => void toggle()}
          className="accent-[var(--color-accent)]"
        />
        <span className="text-[10.5px]">{t('Let a phone drive this session')}</span>
      </label>

      {!state.running && (
        <p className="text-[10px] text-[var(--color-muted)] leading-snug">
          {t('Starts a small server on your local network. Off by default.')}
        </p>
      )}

      {(state.error || actionError) && (
        <p className="flex items-start gap-1 text-[10px] text-red-400 leading-snug">
          <TriangleAlert size={10} className="mt-[1px] shrink-0" />
          {state.error ?? actionError}
        </p>
      )}

      {state.running && (
        <>
          {active && (
            <div className="rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]
                            p-2 flex flex-col items-center gap-1">
              <div
                className="w-[150px] h-[150px] rounded bg-white p-1"
                // The SVG is built in the main process from our own encoder;
                // there is no untrusted input anywhere in this string.
                dangerouslySetInnerHTML={{ __html: active.svg }}
              />
              <p className="text-[9.5px] text-[var(--color-muted)] text-center leading-snug">
                {t('Scan to open the session — no code needed.')}
              </p>
              {/* Which address this symbol carries, spelled out: with several
                  on offer, an unlabelled QR is a guess. */}
              <p className="text-[9px] font-mono text-[var(--color-muted)] max-w-[150px] truncate text-center">
                {active.plainUrl}
              </p>
              {codes.length > 1 && (
                <div className="flex gap-1">
                  {codes.map((entry, index) => (
                    <button
                      key={entry.url}
                      title={entry.plainUrl}
                      onClick={() => setShown(index)}
                      className={`px-1.5 py-0.5 rounded text-[9.5px] transition-colors ${
                        index === shown
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                          : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                      }`}
                    >
                      {entry.label === 'lan'
                        ? t('this network')
                        : entry.label === 'tailscale'
                          ? t('tailnet')
                          : t('anywhere')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]
                          px-2 py-1.5 space-y-1">
            <p className="flex items-center gap-1 text-[9.5px] uppercase tracking-wide
                          text-[var(--color-muted)]">
              <QrCode size={9} />
              {t('Or open by hand')}
            </p>
            {state.urls.length === 0 && (
              <p className="text-[10px] text-amber-400">{t('No network address — is Wi-Fi on?')}</p>
            )}
            {state.urls.map((address) => (
              <button
                key={address.url}
                onClick={() => copy(address.url)}
                title={t('Copy')}
                className="w-full flex items-center gap-1 text-[10.5px] font-mono
                           hover:text-[var(--color-accent)] transition-colors"
              >
                {address.kind === 'tailscale' && (
                  <Globe size={9} className="shrink-0 text-emerald-400" />
                )}
                <span className="truncate">{address.url}</span>
                <Copy size={9} className="shrink-0 opacity-60" />
                {copied === address.url && (
                  <span className="text-[9px] text-emerald-400 shrink-0">{t('copied')}</span>
                )}
              </button>
            ))}
            {hasTailnet && (
              <p className="text-[9.5px] text-emerald-400 leading-snug">
                {t('The address marked with a globe is on your tailnet — it works from mobile data too, without exposing anything to the internet.')}
              </p>
            )}

            <p className="pt-1 text-[9.5px] uppercase tracking-wide text-[var(--color-muted)]">
              {t('…then enter this code')}
            </p>
            <div className="flex items-center gap-2">
              {state.pairingLocked ? (
                <span className="text-[10.5px] text-red-400 leading-snug">
                  {t('Too many wrong codes — pairing is off until you issue a new one.')}
                </span>
              ) : (
                <>
                  <button
                    onClick={() => copy(state.pairingCode ?? '')}
                    title={t('Copy')}
                    className="text-[17px] font-mono tracking-[0.18em] hover:text-[var(--color-accent)]"
                  >
                    {state.pairingCode}
                  </button>
                  {countdown ? (
                    <span className="text-[9.5px] text-[var(--color-muted)] tabular-nums">
                      {countdown}
                    </span>
                  ) : (
                    <span className="text-[9.5px] text-amber-400">{t('expired')}</span>
                  )}
                </>
              )}
              <button
                onClick={() => void window.claudeUI.remoteNewCode()}
                title={t('New code')}
                className="ml-auto p-0.5 rounded hover:bg-[var(--color-surface)]"
              >
                <RefreshCw size={10} />
              </button>
            </div>
          </div>

          <div className="rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)]
                          px-2 py-1.5 space-y-1">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={tunnelUp || tunnelStarting}
                disabled={busy || !providerReady}
                onChange={() => void toggleTunnel()}
                className="accent-[var(--color-accent)]"
              />
              <Globe size={10} className="text-[var(--color-muted)]" />
              <span className="text-[10.5px]">{t('Reachable from anywhere')}</span>
              {tunnelStarting && <Loader2 size={10} className="animate-spin" />}
            </label>

            {/* The relay is a choice about who sees the traffic, so it is made
                explicitly rather than picked for the user behind their back. */}
            <select
              value={provider}
              disabled={busy || tunnelUp || tunnelStarting}
              onChange={(e) => setProvider(e.target.value as TunnelProvider)}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)]
                         rounded px-1.5 py-0.5 text-[10.5px] outline-none
                         focus:border-[var(--color-accent)] disabled:opacity-50"
            >
              <option value="cloudflare">
                Cloudflare{installed('cloudflare') ? '' : ` — ${t('not installed')}`}
              </option>
              <option value="pinggy">
                Pinggy (ssh){installed('pinggy') ? '' : ` — ${t('not installed')}`}
              </option>
              <option value="custom">{t('own command')}</option>
            </select>

            {provider === 'custom' && (
              <input
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                disabled={tunnelUp || tunnelStarting}
                placeholder="ssh -R 80:localhost:{port} example.com"
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)]
                           rounded px-1.5 py-0.5 text-[10px] font-mono outline-none
                           focus:border-[var(--color-accent)]
                           placeholder:text-[var(--color-muted)]"
              />
            )}

            {hasTailnet ? (
              <p className="text-[10px] text-[var(--color-muted)] leading-snug">
                {t('Not needed — your tailnet address above already reaches this machine from anywhere, and keeps it off the open internet.')}
              </p>
            ) : (
              <p className="text-[10px] text-[var(--color-muted)] leading-snug">
                {providerNote}
              </p>
            )}

            {tunnelUp && state.tunnel.url && (
              <button
                onClick={() => copy(state.tunnel.url as string)}
                title={t('Copy')}
                className="w-full flex items-center gap-1 text-[10.5px] font-mono
                           hover:text-[var(--color-accent)] transition-colors"
              >
                <span className="truncate">{state.tunnel.url}</span>
                <Copy size={9} className="shrink-0 opacity-60" />
                {copied === state.tunnel.url && (
                  <span className="text-[9px] text-emerald-400 shrink-0">{t('copied')}</span>
                )}
              </button>
            )}

            {state.tunnel.error && (
              <p className="text-[10px] text-red-400 leading-snug">{state.tunnel.error}</p>
            )}
          </div>

          {/* The warning is scaled to what is actually exposed: a public URL
              deserves alarm, a tailnet does not, and saying the same thing in
              both cases would teach the user to stop reading it. */}
          <p
            className={`flex items-start gap-1 text-[10px] leading-snug ${
              tunnelUp || !hasTailnet ? 'text-amber-400' : 'text-[var(--color-muted)]'
            }`}
          >
            <TriangleAlert size={10} className="mt-[1px] shrink-0" />
            {tunnelUp
              ? t('This address is on the open internet. The code is the only thing between a stranger and a shell on this machine — turn the tunnel off when you are done.')
              : hasTailnet
                ? t('Only devices signed into your tailnet can reach this, over an encrypted link. Anyone with the code can still make Claude run commands here.')
                : t('Anyone on this network who has the code can make Claude run commands here. The connection is not encrypted — keep it to networks you trust, and never forward the port.')}
          </p>
        </>
      )}
    </section>
  )
}
