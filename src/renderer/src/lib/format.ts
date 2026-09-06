import { tr } from '../i18n'
/** Compact form for large token counts: 1,234,567 → 1.2M */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Math.abs(n) < 1000) return String(Math.round(n))
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
}

export function fullNumber(n: number): string {
  return n.toLocaleString('uk-UA')
}

/** "5m ago", "3h ago" — for session age and limit samples. */
export function relativeTime(iso: string | number): string {
  const ts = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(ts)) return '—'
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return tr('just now')
  if (min < 60) return tr('{n}m ago', { n: min })
  const hours = Math.round(min / 60)
  if (hours < 24) return tr('{n}h ago', { n: hours })
  const days = Math.round(hours / 24)
  if (days < 30) return tr('{n}d ago', { n: days })
  return new Date(ts).toLocaleDateString('uk-UA')
}

/** Countdown to a limit reset. */
export function untilReset(resetsAtSeconds: number): string {
  const ms = resetsAtSeconds * 1000 - Date.now()
  if (ms <= 0) return tr('resetting')
  const min = Math.floor(ms / 60_000)
  if (min < 60) return tr('{n}m', { n: min })
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m ? tr('{h}h {m}m', { h, m }) : tr('{n}h', { n: h })
  return tr('{d}d {h}h', { d: Math.floor(h / 24), h: h % 24 })
}

/** Last path segment — the project title in the list. */
export function projectName(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/')
  return parts.at(-1) || path
}
