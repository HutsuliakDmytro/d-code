/**
 * Logging that cannot bring the app down.
 *
 * In dev mode stdout is attached to a pipe that can close before the process does
 * — when the terminal or the parent shell exits, for instance. Writing to such a
 * stream throws EPIPE, and as an uncaught exception that kills the Electron window.
 */
export function log(...args: unknown[]): void {
  try {
    console.log(...args)
  } catch {
    // Nowhere to write; diagnostics are not worth a crash.
  }
}

export function warn(...args: unknown[]): void {
  try {
    console.warn(...args)
  } catch {
    // same reason
  }
}
