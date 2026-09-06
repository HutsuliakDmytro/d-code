import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock, Cpu, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { useChatStore } from '../store/chat-store'
import { compactNumber, fullNumber, relativeTime, untilReset } from '../lib/format'
import SettingsSection from '../components/SettingsSection'
import SessionControls from '../components/SessionControls'
import ChangedFiles from '../components/ChangedFiles'
import ActivityStats from '../components/ActivityStats'
import EnvironmentPanel from '../components/EnvironmentPanel'
import SessionNotes from '../components/SessionNotes'
import Checkpoints from '../components/Checkpoints'
import PullRequests from '../components/PullRequests'
import type { AppInfo } from '@shared/ipc'
import type { UsageTotals } from '@shared/types'
import { useTranslate } from '../i18n'

/** Past this age a limits sample is stale — the Claude desktop app is not running. */
const STALE_AFTER_MS = 45 * 60 * 1000

function Gauge({
  label,
  percent,
  resetsAt,
  resetsText
}: {
  label: string
  percent: number
  /** Epoch SECONDS — that is how rate_limit_event reports them. */
  resetsAt?: number
  /** Ready-made text from `/usage` when no exact timestamp is available. */
  resetsText?: string
}): React.JSX.Element {
  const t = useTranslate()
  const clamped = Math.max(0, Math.min(100, percent))
  const tone =
    clamped >= 90 ? 'bg-red-500' : clamped >= 70 ? 'bg-amber-500' : 'bg-[var(--color-accent)]'

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] text-[var(--color-muted)]">{label}</span>
        <span className="text-[12px] tabular-nums">{clamped}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        <div
          className={`h-full ${tone} transition-[width] duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {(resetsAt !== undefined || resetsText) && (
        <div className="flex items-center gap-1 mt-1 text-[10px] text-[var(--color-muted)]">
          <Clock size={9} />
          {resetsAt !== undefined
            ? t('resets in {time}', { time: untilReset(resetsAt) })
            : t('resets {when}', { when: resetsText ?? '' })}
        </div>
      )}
    </div>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between py-0.5" title={hint}>
      <span className="text-[11px] text-[var(--color-muted)]">{label}</span>
      <span className="text-[11.5px] tabular-nums">{value}</span>
    </div>
  )
}

function UsageBlock({ title, usage }: { title: string; usage: UsageTotals }): React.JSX.Element {
  const t = useTranslate()
  const models = Object.entries(usage.byModel).sort((a, b) => b[1].outputTokens - a[1].outputTokens)
  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1.5">{title}</h3>
      <Row label={t('Output')} value={compactNumber(usage.outputTokens)} hint={fullNumber(usage.outputTokens)} />
      <Row label={t('Input')} value={compactNumber(usage.inputTokens)} hint={fullNumber(usage.inputTokens)} />
      <Row
        label={t('Cache written')}
        value={compactNumber(usage.cacheCreationTokens)}
        hint={fullNumber(usage.cacheCreationTokens)}
      />
      <Row
        label={t('Cache read')}
        value={compactNumber(usage.cacheReadTokens)}
        hint={fullNumber(usage.cacheReadTokens)}
      />
      {usage.thinkingTokens > 0 && (
        <Row label={t('Thinking')} value={compactNumber(usage.thinkingTokens)} hint={fullNumber(usage.thinkingTokens)} />
      )}
      <Row label={t('API requests')} value={String(usage.requests)} />

      {models.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {models.map(([model, u]) => (
            <div key={model} className="flex items-baseline justify-between">
              <span className="text-[10.5px] text-[var(--color-muted)] truncate flex items-center gap-1">
                <Cpu size={9} className="shrink-0" />
                {model}
              </span>
              <span className="text-[10.5px] tabular-nums shrink-0 ml-2">
                {compactNumber(u.outputTokens)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Sparkline of limit history from whatever samples exist. */
function Sparkline({ values, color }: { values: number[]; color: string }): React.JSX.Element | null {
  if (values.length < 2) return null
  const w = 100
  const h = 22
  const max = Math.max(100, ...values)
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[22px]" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function MetricsPanel({
  /** In the right panel the container draws the header. */
  embedded = false
}: {
  embedded?: boolean
} = {}): React.JSX.Element {
  const t = useTranslate()
  const { groups, selected, rateLimits, setRateLimits } = useAppStore()
  const [info, setInfo] = useState<AppInfo>()

  useEffect(() => {
    void window.claudeUI.getAppInfo().then(setInfo)
    void window.claudeUI.getRateLimits().then(setRateLimits)
    return window.claudeUI.onRateLimits(setRateLimits)
  }, [setRateLimits])

  const snapshot = rateLimits?.snapshot
  const context = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId)?.state.context)

  async function refresh(): Promise<void> {
    setRateLimits(await window.claudeUI.refreshRateLimits())
  }

  const totals = useMemo(() => {
    const acc: UsageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      thinkingTokens: 0,
      requests: 0,
      byModel: {}
    }
    for (const g of groups) {
      acc.inputTokens += g.usage.inputTokens
      acc.outputTokens += g.usage.outputTokens
      acc.cacheCreationTokens += g.usage.cacheCreationTokens
      acc.cacheReadTokens += g.usage.cacheReadTokens
      acc.thinkingTokens += g.usage.thinkingTokens
      acc.requests += g.usage.requests
      for (const [m, u] of Object.entries(g.usage.byModel)) {
        const per = (acc.byModel[m] ??= {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          requests: 0
        })
        per.inputTokens += u.inputTokens
        per.outputTokens += u.outputTokens
        per.cacheCreationTokens += u.cacheCreationTokens
        per.cacheReadTokens += u.cacheReadTokens
        per.requests += u.requests
      }
    }
    return acc
  }, [groups])

  const latest = rateLimits?.latest
  const stale = (rateLimits?.latestAgeMs ?? Infinity) > STALE_AFTER_MS
  const sessionCount = groups.reduce((n, g) => n + g.sessions.length, 0)

  return (
    <div
      className={`h-full flex flex-col bg-[var(--color-surface)] ${
        embedded ? '' : 'border-l border-[var(--color-border)]'
      }`}
    >
      {!embedded && (
        <div className="titlebar-drag h-[38px] shrink-0 flex items-center px-3 border-b border-[var(--color-border)]">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            {t('Metrics')}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        <section>
          <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide
                         text-[var(--color-muted)] mb-2">
            {t('Plan limits')}
            <button
              onClick={() => void refresh()}
              disabled={rateLimits?.refreshing}
              title={t('Ask the CLI again (free)')}
              className="p-0.5 rounded hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]
                         disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={10} className={rateLimits?.refreshing ? 'animate-spin' : ''} />
            </button>
            {snapshot && (
              <span className="ml-auto normal-case tracking-normal">
                {relativeTime(snapshot.fetchedAt)}
              </span>
            )}
          </h3>

          {snapshot ? (
            <div className="space-y-3">
              {snapshot.session && (
                <div>
                  <Gauge
                    label={snapshot.session.label}
                    percent={snapshot.session.percent}
                    resetsAt={rateLimits?.fiveHour?.resetsAt}
                    resetsText={snapshot.session.resetsText}
                  />
                  <Sparkline
                    values={(rateLimits?.samples ?? []).slice(-40).map((s) => s.fh)}
                    color="var(--color-accent)"
                  />
                </div>
              )}

              {snapshot.week && (
                <div>
                  <Gauge
                    label={snapshot.week.label}
                    percent={snapshot.week.percent}
                    resetsAt={rateLimits?.sevenDay?.resetsAt}
                    resetsText={snapshot.week.resetsText}
                  />
                  <Sparkline
                    values={(rateLimits?.samples ?? []).slice(-40).map((s) => s.sd)}
                    color="#6b8afd"
                  />
                </div>
              )}

              {/* The CLI lists per-model caps only when they exist. */}
              {snapshot.extra.map((bucket) => (
                <Gauge
                  key={bucket.label}
                  label={`${t('7 days')} · ${bucket.label}`}
                  percent={bucket.percent}
                  resetsText={bucket.resetsText}
                />
              ))}

              {snapshot.requests24h !== undefined && (
                <p className="text-[10px] text-[var(--color-muted)]">
                  {t('Last 24h')}: {snapshot.requests24h} {t('requests')}
                  {snapshot.sessions24h !== undefined &&
                    `, ${snapshot.sessions24h} ${t('sessions')}`}
                </p>
              )}
            </div>
          ) : latest ? (
            // Fallback: the CLI did not answer, so show the last known history sample.
            <div className="space-y-3">
              <Gauge label={t('5 hours')} percent={latest.fh} resetsAt={rateLimits?.fiveHour?.resetsAt} />
              <Gauge label={t('7 days')} percent={latest.sd} resetsAt={rateLimits?.sevenDay?.resetsAt} />
              <div
                className={`flex items-start gap-1 text-[10px] ${
                  stale ? 'text-amber-400' : 'text-[var(--color-muted)]'
                }`}
              >
                {stale && <AlertTriangle size={10} className="mt-0.5 shrink-0" />}
                <span>
                  {t('From the history file')}, {relativeTime(latest.t)}
                  {stale && ` — ${t('stale')}`}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-[10.5px] text-[var(--color-muted)] leading-relaxed">
              {rateLimits?.refreshing
                ? t('Asking the CLI…')
                : t('Could not read the limits. Try refreshing.')}
            </p>
          )}
        </section>

        {context && (
          <section>
            <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
              {t('Context window')}
            </h3>
            <Gauge label={context.model} percent={context.percent} />
            <p className="mt-1 text-[10px] text-[var(--color-muted)]">
              {t('{used} of {total} tokens', { used: compactNumber(context.used), total: compactNumber(context.total) })}
            </p>
          </section>
        )}

        {selected && <UsageBlock title={t('Current session')} usage={selected.usage} />}

        <UsageBlock title={`${t('Total')} · ${sessionCount} ${t('sessions')}`} usage={totals} />

        <EnvironmentPanel />

        <ActivityStats />

        <SessionNotes />

        <PullRequests />

        <Checkpoints />

        <ChangedFiles />

        <SessionControls />

        <SettingsSection />

        <section className="pt-1 border-t border-[var(--color-border)]">
          <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] mb-1.5">
            {t('Environment')}
          </h3>
          <Row label="CLI" value={info?.claudeVersion?.split(' ')[0] ?? '—'} />
          <Row label={t('Default model')} value={info?.defaultModel ?? '—'} />
          <Row label={t('Projects')} value={String(groups.length)} />
        </section>
      </div>
    </div>
  )
}
