import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Той самий аліас, що в electron.vite.config.ts. Потрібен, щойно з @shared
    // імпортується не лише тип, а й значення.
    alias: {
      '@shared': resolve('src/shared'),
      '@': resolve('src/renderer/src')
    }
  },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000
  }
})
