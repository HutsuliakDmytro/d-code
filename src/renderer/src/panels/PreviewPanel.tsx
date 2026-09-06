import { useEffect, useRef, useState } from 'react'
import { Globe, RefreshCw, ExternalLink, X, ArrowLeft, ArrowRight } from 'lucide-react'
import { useTranslate } from '../i18n'

const STORAGE_KEY = 'ccui-preview-url'
const PRESETS = ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080']

/**
 * Preview of a locally running app.
 *
 * Uses `webview` rather than an iframe: dev servers almost always send headers
 * that forbid embedding, which would leave an iframe blank.
 */
export default function PreviewPanel(): React.JSX.Element {
  const t = useTranslate()
  const [url, setUrl] = useState(() => localStorage.getItem(STORAGE_KEY) ?? PRESETS[1])
  const [input, setInput] = useState(url)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const viewRef = useRef<HTMLElement & {
    reload: () => void
    goBack: () => void
    goForward: () => void
    canGoBack: () => boolean
    canGoForward: () => boolean
  }>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, url)
  }, [url])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const onStart = (): void => {
      setLoading(true)
      setError(undefined)
    }
    const onStop = (): void => setLoading(false)
    const onFail = (e: Event): void => {
      setLoading(false)
      const detail = e as Event & { errorDescription?: string }
      // Most often the server simply is not up yet.
      setError(detail.errorDescription ?? t('Failed to load'))
    }

    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-fail-load', onFail)
    return () => {
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-fail-load', onFail)
    }
  }, [])

  function go(next: string): void {
    const normalized = next.startsWith('http') ? next : `http://${next}`
    setUrl(normalized)
    setInput(normalized)
  }

  return (
    <div className="h-full flex flex-col bg-[var(--color-bg)]">
      <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
        <button
          onClick={() => viewRef.current?.goBack()}
          title={t('Back')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
        >
          <ArrowLeft size={11} />
        </button>
        <button
          onClick={() => viewRef.current?.goForward()}
          title={t('Forward')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
        >
          <ArrowRight size={11} />
        </button>
        <button
          onClick={() => viewRef.current?.reload()}
          title={t('Reload')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>

        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go(input)}
          className="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)]
                     rounded px-2 py-0.5 text-[11px] font-mono outline-none
                     focus:border-[var(--color-accent)]"
        />

        <button
          onClick={() => void window.claudeUI.openFolder(url)}
          title={t('Open in browser')}
          className="p-0.5 rounded hover:bg-[var(--color-surface-2)]"
        >
          <ExternalLink size={11} />
        </button>
      </div>

      <div className="shrink-0 flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)]">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            onClick={() => go(preset)}
            className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono transition-colors ${
              url === preset
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]'
            }`}
          >
            {preset.replace('http://localhost:', ':')}
          </button>
        ))}
      </div>

      {error && (
        <div className="shrink-0 flex items-center gap-1.5 px-2 py-1 border-b border-[var(--color-border)]">
          <Globe size={11} className="text-amber-400 shrink-0" />
          <span className="text-[10.5px] text-amber-400 flex-1 truncate">{error}</span>
          <button
            onClick={() => setError(undefined)}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            <X size={10} />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 bg-white">
        {/* `webview` is an Electron tag — React has no typing for it. */}
        <webview ref={viewRef as never} src={url} className="w-full h-full" />
      </div>
    </div>
  )
}
