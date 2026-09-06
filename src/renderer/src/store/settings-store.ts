import { create } from 'zustand'
import type { PermissionMode } from '@shared/types'

/** Aliases accepted by `--model`. A full model name works too. */
export const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'opus', label: 'Opus 5' },
  { value: 'sonnet', label: 'Sonnet 5' },
  { value: 'fable', label: 'Fable 5' },
  { value: 'haiku', label: 'Haiku 4.5' }
] as const

/** Values accepted by `--permission-mode`. */
export const PERMISSION_OPTIONS: Array<{ value: PermissionMode; label: string; hint: string }> = [
  { value: 'acceptEdits', label: 'Accept edits', hint: 'File edits without asking' },
  {
    value: 'manual',
    label: 'Ask every time',
    hint: 'Every tool goes through a dialog; file edits are shown as a diff first'
  },
  { value: 'plan', label: 'Plan mode', hint: 'Read-only, no changes' },
  { value: 'bypassPermissions', label: 'Unrestricted', hint: 'Dangerous: everything is allowed' }
]

export const EFFORT_OPTIONS = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const

interface SettingsState {
  model: string
  permissionMode: PermissionMode
  effort: string
  setModel: (v: string) => void
  setPermissionMode: (v: PermissionMode) => void
  setEffort: (v: string) => void
}

const STORAGE_KEY = 'claude-ui-settings'

function load(): Pick<SettingsState, 'model' | 'permissionMode' | 'effort'> {
  const fallback = { model: '', permissionMode: 'acceptEdits' as PermissionMode, effort: '' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...fallback, ...(JSON.parse(raw) as object) } : fallback
  } catch {
    return fallback
  }
}

/**
 * Settings live separately from `~/.claude/settings.json` — the app must not
 * quietly change how the CLI behaves in a terminal.
 */
export const useSettingsStore = create<SettingsState>((set, get) => {
  const persist = (): void => {
    const { model, permissionMode, effort } = get()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ model, permissionMode, effort }))
  }
  return {
    ...load(),
    setModel: (model) => {
      set({ model })
      persist()
    },
    setPermissionMode: (permissionMode) => {
      set({ permissionMode })
      persist()
    },
    setEffort: (effort) => {
      set({ effort })
      persist()
    }
  }
})
