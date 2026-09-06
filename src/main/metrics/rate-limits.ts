import { readFile } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import type { PlanUsageSample, RateLimitEventInfo, RateLimitState } from '@shared/types'
import type { UsageSnapshot } from '@shared/types'
import { PLAN_USAGE_HISTORY } from '../store/project-paths'
import { probeUsage } from './usage-probe'
import { warn } from '../log'

/** How often to re-ask the CLI. The command is free, but it is a separate process. */
const PROBE_INTERVAL_MS = 3 * 60 * 1000
/** File polling interval: fs.watch breaks when a file is replaced via rename. */
const FILE_POLL_MS = 30_000

/**
 * Plan usage percentages.
 *
 * The only on-disk source of percentages is `plan-usage-history.json`, written by
 * the Claude desktop app roughly every 15 minutes. The CLI publishes them nowhere:
 * `statusLine` is not invoked in headless mode (verified), and the
 * `rate_limit_event` carries only a status and a reset time.
 *
 * The consequence: with the desktop app closed, the data goes stale. That is why
 * `latestAgeMs` is always handed to the UI — showing a percentage without its age
 * would be a lie.
 */
export class RateLimitTracker {
  private samples: PlanUsageSample[] = []
  private fiveHour?: RateLimitEventInfo
  private sevenDay?: RateLimitEventInfo
  private snapshot?: UsageSnapshot
  private refreshing = false
  /** The in-flight poll: concurrent callers wait for it instead of starting their own. */
  private inFlight?: Promise<RateLimitState>
  private probeTimer?: NodeJS.Timeout
  private watching = false
  private listeners = new Set<(state: RateLimitState) => void>()

  async start(): Promise<void> {
    await this.reload()

    // `fs.watch` is unreliable here: the file is replaced atomically (temp +
    // rename), after which the watcher holds the old inode and goes silent forever.
    // `watchFile` compares stat, so it survives the swap.
    watchFile(PLAN_USAGE_HISTORY, { interval: FILE_POLL_MS }, () => {
      void this.reload().then(() => this.emit())
    })
    this.watching = true

    void this.refresh()
    this.probeTimer = setInterval(() => void this.refresh(), PROBE_INTERVAL_MS)
    this.probeTimer.unref()
  }

  stop(): void {
    if (this.watching) {
      unwatchFile(PLAN_USAGE_HISTORY)
      this.watching = false
    }
    clearInterval(this.probeTimer)
    this.probeTimer = undefined
    this.listeners.clear()
  }

  /**
   * Re-asks the CLI. Called on a timer and by the refresh button.
   *
   * When a poll is already running the same promise is returned: otherwise the
   * button would hand back an empty state while the background poll finishes.
   */
  refresh(): Promise<RateLimitState> {
    if (this.inFlight) return this.inFlight
    this.inFlight = this.runProbe().finally(() => {
      this.inFlight = undefined
    })
    return this.inFlight
  }

  private async runProbe(): Promise<RateLimitState> {
    this.refreshing = true
    this.emit()

    const result = await probeUsage()
    this.refreshing = false
    if ('error' in result) {
      warn('[usage] could not poll the CLI:', result.error)
    } else {
      this.snapshot = result
    }
    this.emit()
    return this.getState()
  }

  onChange(fn: (state: RateLimitState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Accepts a `rate_limit_event` from the stream. It carries no percentages. */
  applyEvent(info: RateLimitEventInfo): void {
    if (info.rateLimitType === 'seven_day') this.sevenDay = info
    else this.fiveHour = info
    this.emit()
  }

  getState(): RateLimitState {
    const latest = this.samples.at(-1)
    return {
      snapshot: this.snapshot,
      refreshing: this.refreshing,
      samples: this.samples,
      latest,
      latestAgeMs: latest ? Date.now() - latest.t : undefined,
      fiveHour: this.fiveHour,
      sevenDay: this.sevenDay
    }
  }

  private async reload(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(PLAN_USAGE_HISTORY, 'utf8')) as {
        samples?: Array<{ t?: number; u?: { fh?: number; sd?: number } }>
      }
      this.samples = (parsed.samples ?? [])
        .filter((s): s is { t: number; u: { fh?: number; sd?: number } } => typeof s?.t === 'number')
        .map((s) => ({ t: s.t, fh: s.u?.fh ?? 0, sd: s.u?.sd ?? 0 }))
        .sort((a, b) => a.t - b.t)
    } catch {
      this.samples = []
    }
  }

  private emit(): void {
    const state = this.getState()
    for (const fn of this.listeners) fn(state)
  }
}

/** Time left until a limit resets. `resetsAt` arrives in SECONDS. */
export function msUntilReset(resetsAtSeconds: number): number {
  return Math.max(0, resetsAtSeconds * 1000 - Date.now())
}
