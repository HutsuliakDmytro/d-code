import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  EFFORT_OPTIONS,
  MODEL_OPTIONS,
  PERMISSION_OPTIONS,
  useSettingsStore
} from '../store/settings-store'
import { useChatStore } from '../store/chat-store'
import { useWorkspaceStore } from '../store/workspace-store'
import type { PermissionMode } from '@shared/types'
import { LANGUAGE_NAMES, useLanguageStore, useTranslate, type Language } from '../i18n'
import RemoteAccess from './RemoteAccess'

const selectClass =
  'w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md ' +
  'px-2 py-1 text-[11.5px] outline-none focus:border-[var(--color-accent)]'

export default function SettingsSection(): React.JSX.Element {
  const t = useTranslate()
  const { language, setLanguage } = useLanguageStore()
  const { model, permissionMode, effort, setModel, setPermissionMode, setEffort } =
    useSettingsStore()
  const chatStatus = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId)!.state.status)
  const changePermissionMode = useChatStore((s) => s.changePermissionMode)
  const changeModel = useChatStore((s) => s.changeModel)
  const activeModel = useChatStore((s) => s.tabs.find((t) => t.id === s.activeId)!.state.model)
  const [modeError, setModeError] = useState<string>()
  const [modelError, setModelError] = useState<string>()
  const formatOnSave = useWorkspaceStore((s) => s.formatOnSave)
  const setFormatOnSave = useWorkspaceStore((s) => s.setFormatOnSave)

  // Effort is fixed by a process argument. Model and permission mode are not:
  // both can be switched live through a control request to the running CLI.
  const locked = chatStatus === 'ready' || chatStatus === 'thinking'
  const hint = PERMISSION_OPTIONS.find((o) => o.value === permissionMode)?.hint

  async function applyPermissionMode(mode: PermissionMode): Promise<void> {
    setPermissionMode(mode)
    setModeError(undefined)
    if (!locked) return
    const result = await changePermissionMode(mode)
    if (!result.ok) {
      setModeError(t('could not apply to the active conversation: {error}', { error: result.error ?? t('unknown') }))
    }
  }

  async function applyModel(next: string): Promise<void> {
    setModel(next)
    setModelError(undefined)
    if (!locked) return
    // An empty value means "default", which the CLI will not accept as a model.
    if (!next) {
      setModelError(t('restart the conversation to go back to the default model'))
      return
    }
    const result = await changeModel(next)
    if (!result.ok) {
      setModelError(t('could not apply: {error}', { error: result.error ?? t('unknown') }))
    }
  }

  return (
    <section className="pt-1 border-t border-[var(--color-border)] space-y-2">
      <h3 className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
        {t('Settings')}
      </h3>

      <label className="block">
        <span className="text-[10.5px] text-[var(--color-muted)]">{t('Model')}</span>
        <select
          value={model}
          onChange={(e) => void applyModel(e.target.value)}
          className={selectClass}
        >
          {MODEL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {modelError && <span className="block mt-0.5 text-[10px] text-amber-400">{modelError}</span>}
        {locked && activeModel && (
          <span className="block mt-0.5 text-[10px] text-[var(--color-muted)]">
            {t('in conversation')}: {activeModel}
          </span>
        )}
      </label>

      <label className="block">
        <span className="text-[10.5px] text-[var(--color-muted)]">{t('Permissions')}</span>
        <select
          value={permissionMode}
          onChange={(e) => void applyPermissionMode(e.target.value as PermissionMode)}
          className={selectClass}
        >
          {PERMISSION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hint && <span className="block mt-0.5 text-[10px] text-[var(--color-muted)]">{hint}</span>}
        {modeError && <span className="block mt-0.5 text-[10px] text-red-400">{modeError}</span>}
      </label>

      {permissionMode === 'bypassPermissions' && (
        <div className="flex items-start gap-1 text-[10px] text-amber-400">
          <AlertTriangle size={10} className="mt-0.5 shrink-0" />
          {t('Claude will run any tool without asking.')}
        </div>
      )}

      <label className="block">
        <span className="text-[10.5px] text-[var(--color-muted)]">{t('Reasoning effort')}</span>
        <select
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
          className={selectClass}
        >
          {EFFORT_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o || t('Default')}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] text-[var(--color-muted)]">{t('Language')}</span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as Language)}
          className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded
                     px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--color-accent)]"
        >
          {(Object.keys(LANGUAGE_NAMES) as Language[]).map((code) => (
            <option key={code} value={code}>
              {LANGUAGE_NAMES[code]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          checked={formatOnSave}
          onChange={(e) => setFormatOnSave(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        <span className="text-[10.5px]">{t('Format on save')}</span>
      </label>
      <p className="text-[10px] text-[var(--color-muted)] -mt-1">
        {t('Uses prettier, ruff or dart format from the project itself.')}
      </p>

      {locked && (
        <p className="text-[10px] text-[var(--color-muted)]">
          {t('Model and reasoning effort apply to the next conversation — they are process arguments and are already fixed. Permission mode switches immediately.')}
        </p>
      )}

      <RemoteAccess />
    </section>
  )
}
