import type { ClaudeUIApi } from '@shared/ipc'

declare global {
  interface Window {
    claudeUI: ClaudeUIApi
  }
}

export {}
