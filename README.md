<h1 align="center">D-code</h1>

<p align="center">
  An unofficial desktop client for the Claude Code CLI.<br>
  Sessions on the left, the conversation in the middle, usage and limits on the right —
  plus an editor, git, terminals and a debugger when you need them.
</p>

<p align="center">
  <img src="build/icon.png" width="96" alt="">
</p>

> **Not affiliated with Anthropic.** "Claude" and "Claude Code" are their trademarks.
> This is a personal project that drives the official CLI as a subprocess; it ships
> no Anthropic code, bundles no credentials and requires your own subscription.

---

## What it is

The Claude Code CLI is excellent and lives in a terminal. This wraps it in a window:
every session you have ever run, searchable; token and cost accounting that is
actually correct; your 5-hour and weekly limits; and enough of an IDE that you rarely
need to leave.

It reads the same files the CLI writes and speaks the same headless stream-json
protocol. Nothing is intercepted or reimplemented — when the app is closed, the CLI
behaves exactly as before.

## Install

Grab a build from [Releases](../../releases). You still need the
[Claude Code CLI](https://claude.com/claude-code) installed and signed in — this app
stores no credentials of its own.

| Platform | File | Notes |
|---|---|---|
| **macOS** | `.dmg` (Apple Silicon, Intel) | Unsigned: first launch needs right-click → Open |
| **Linux** | `.AppImage`, `.deb` (x64, arm64) | AppImage may need `--appimage-extract-and-run` on newer distros |
| **Windows** | `.exe` installer, `.zip` (x64, arm64) | Unsigned: SmartScreen → More info → Run anyway |

Or build it yourself:

```bash
npm install
npm run dev        # development
npm run dist       # package for the current platform
```

## Feature support

Everything works on every platform unless noted. The gaps are honest ones — each has
a reason, listed below the table.

| | macOS | Linux | Windows |
|---|:---:|:---:|:---:|
| Live chat, streaming, interrupt | ✅ | ✅ | ✅ |
| Session history, search, forking | ✅ | ✅ | ✅ |
| Token and cost accounting | ✅ | ✅ | ✅ |
| Editor, LSP, rename, debugger | ✅ | ✅ | ✅ |
| Git, diffs, conflicts, pull requests | ✅ | ✅ | ✅ |
| Images, attachments, checkpoints | ✅ | ✅ | ✅ |
| Tasks (`npm run` with live output) | ✅ | ✅ | ✅ |
| **Embedded terminal** | ✅ | ✅ | ✅ |
| **Open in external terminal** | Terminal.app | 7 emulators¹ | Windows Terminal / cmd |
| **Open in IDE** | `/Applications` | `.desktop` files | Program Files |
| **Limits history graph** | ✅ | ➖² | ✅³ |
| **Desktop notifications** | ✅ | ✅ | ✅ |

¹ `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal`, `alacritty`,
`kitty`, `xterm` — the first one found wins.

² The graph reads `plan-usage-history.json`, written by the Claude desktop app, which
does not exist on Linux. Current percentages are unaffected — they come from polling
the CLI directly.

³ Only if the Claude desktop app is installed and has run recently.

> **A note on prebuilt packages.** The Linux and Windows builds in `release/` that
> were cross-built from macOS ship **without** the embedded terminal: `node-pty` is a
> native module and has to be compiled on the platform it runs on. The Terminal tab
> says so plainly. Builds from CI (see `.github/workflows/release.yml`) run on each
> native OS and have no such gap.

## Features

| | |
|---|---|
| **Sessions** | Every project the CLI has touched, grouped, searchable, with live-process indicators |
| **Full-text search** (`⌘F`) | Across all transcripts, optionally inside tool arguments and results |
| **Chat tabs** | Each tab is its own CLI process, so one can think while you type in another |
| **Interrupt** | Stops the turn and **returns your text to the composer** for editing |
| **Images and files** | Paste, drag or attach; images go as base64, files by path |
| **Editor** | CodeMirror with 20+ languages, split view, breadcrumbs, blame gutter |
| **Language server** | Completion, hover, go-to-definition (`F12`), project-wide rename (`F2`) |
| **Debugger** | Breakpoints, call stack, variables, expression evaluation |
| **Git** | Stage, commit, push/pull, stashes, branch diffs, conflict resolution |
| **Pull requests** | List, create and follow check status through `gh` |
| **Checkpoints** | Roll files back to their state before any message — the CLI snapshots them |
| **Activity** | Tokens per day, top tools with error counts, per-project breakdown, cache coverage |
| **Live model switching** | Model and permission mode change in a running conversation |
| **Two languages** | English and Ukrainian, switchable in settings |

## Architecture

```
src/main/claude/     CLI subprocess, stream-json protocol, conversation manager
src/main/store/      path encoding, transcript parser, session scanner
src/main/metrics/    plan limits
src/main/system/     workspaces, editors, git, terminals, platform differences
src/main/lsp/        JSON-RPC client and language server manager
src/main/debug/      Node debugging over CDP
src/renderer/        React interface
src/shared/          domain types and the IPC contract
```

Everything platform-specific lives in `src/main/system/platform.ts` — the rest of the
code does not know which OS it is on.

## What the CLI format actually looks like

The transcript format in CLI 2.1.x differs from most public write-ups. These are the
findings that make the difference between a correct client and a plausible-looking one:

1. **There is no `summary` line type.** Session titles come from, in order:
   `agent-name` → `ai-title` → `last-prompt` → the first user message.
2. **Tokens must be deduplicated by `requestId`.** One API reply is written as several
   lines with identical `usage`. Without dedup, output tokens inflate **2.6–3.1×** on
   real transcripts. The `usage.iterations[]` field is a breakdown of the same usage,
   not extra calls.
3. **Subagents are not in the main file.** They live in
   `<session-id>/subagents/agent-<id>.jsonl` and their tokens are not counted in the
   parent transcript. Their `sessionId` is identical to the parent's — only the file
   tells them apart.
4. **Project directory names are irreversible.** Every character outside `[a-zA-Z0-9]`
   becomes `-`, so `foo.bar`, `foo_bar` and `foo bar` collapse into one directory. The
   real path comes from the `cwd` field inside the transcript.
5. **Slash commands arrive as `user` lines without `isMeta`.** Content is the only way
   to tell them from a human message (`<command-name>`, `<local-command-stdout>`).
6. **`costUSD` is absent from transcripts.** For live sessions the CLI reports cost
   itself in `result.total_cost_usd` and `result.modelUsage[].costUSD`.
7. **`system/init` only arrives after the first message.** Waiting for it before
   allowing input is a deadlock.
8. **`statusLine` is never invoked in headless mode**, so limit percentages cannot
   come from there.
9. **`--remote-control` only works interactively.** In headless the flag is accepted
   and does nothing.
10. **Interrupt with a control request, not a signal:**
    `{"type":"control_request","request":{"subtype":"interrupt"}}` on stdin. SIGINT
    would end the process. An interrupted turn returns as a `result` with
    `is_error: true` — that is normal, not a failure.
11. **Images go in as `{"type":"image","source":{"type":"base64",…}}`** plus an
    `[Image #N]` marker in the text — exactly the shape the CLI writes into transcripts.
12. **Model and permission mode change live** via `set_model` and
    `set_permission_mode` control requests. After a mode change the CLI sends a fresh
    `system/init` **without a `model` field** — it must not overwrite the stored model.
13. **`/usage` works headless and costs nothing.** It is the most accurate limits
    source. The output is prose (`Current session: 56% used · resets Aug 23 at 3:19pm`),
    so the parser has to be forgiving.
14. **`fs.watch` does not work on `plan-usage-history.json`**: it is replaced
    atomically via rename, after which the watcher holds a dead inode. `watchFile`
    survives that.
15. **`trackingPath` in file history can be relative** — `realParentDir` from the same
    record is the base. `backupFileName: null` means the session created the file.
16. **The set of service line types grows with versions.** September 2026 added
    `pr-link`, linking a session to a pull request. It is written *every time* the
    session returns to that PR: 915 lines for 83 distinct PRs in one real session, so
    deduplication by `prNumber` is not optional.

## Language server and debugger

Completion, hover, go-to-definition and rename run through
`typescript-language-server`. Two traps cost real time:

- **A TypeScript 7 project has no `tsserver.js`.** The native compiler has no server
  mode at all, so a private copy of TypeScript 5 is kept alongside and pointed at.
- **The `--tsserver-path` flag is gone.** The path goes in `initializationOptions` as
  `{ tsserver: { path } }`.

Debugging deliberately does **not** use DAP: Node speaks the Chrome DevTools Protocol
natively, so `--inspect-brk` plus a WebSocket is enough. Four things had to be handled:

- **The first pause is an artefact.** `--inspect-brk` stops on line one before anything
  runs; skipping it is what makes user breakpoints work.
- **Stack frames carry no path**, only a `scriptId` — resolved through
  `Debugger.scriptParsed`.
- **The engine knows files by resolved paths.** A `/var/…` directory is `/private/var/…`
  to it, and a breakpoint set in a tab would silently never fire.
- **The script never exits while a debugger is attached** ("Waiting for the debugger to
  disconnect…"). The socket closes on `Runtime.executionContextDestroyed`.

## Terminals

Terminals use `node-pty`, a native module that must be built against Electron's ABI:

```bash
npx electron-rebuild -f -w node-pty
```

Without it the app does not crash — the Terminal tab simply reports the module as
unavailable and shows this command. Tasks (`npm run`) need no pty and always work.

## License

MIT — see [LICENSE](LICENSE).
