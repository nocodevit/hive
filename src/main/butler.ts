// Built-in Butler: a Claude Code session in ~/.hive/butler/, run by Hive
// under `claude remote-control`, so it shows up as "Hive Butler" in the
// Claude app's Code list on the owner's phone. Through the bundled
// `./hive` CLI (which calls the butler API in butlerApi.ts) it lists
// agents, reads their chats and types into the one the owner names.
//
// The Settings switch is the only thing the owner touches. Hive writes the
// rules, the CLI and the permission settings into the folder every time it
// starts the session, so an upgrade ships new rules and local edits do not
// last. Everything here takes its side effects as deps so it can be tested
// without a real pty or a real `claude`.

import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export const BUTLER_SESSION_NAME = 'Hive Butler'

/** Bundled file → path inside the butler folder. */
export const BUTLER_FILES: ReadonlyArray<{ from: string; to: string; mode?: number }> = [
  { from: 'CLAUDE.md', to: 'CLAUDE.md' },
  { from: 'hive', to: 'hive', mode: 0o755 },
  { from: 'settings.json', to: join('.claude', 'settings.json') }
]

export function butlerDir(dataDir: string): string {
  return join(dataDir, 'butler')
}

/** Overwrite the bundled files into the butler folder. Other files are left alone. */
export function installButlerFiles(srcDir: string, destDir: string): void {
  for (const f of BUTLER_FILES) {
    const dest = join(destDir, f.to)
    mkdirSync(join(dest, '..'), { recursive: true })
    copyFileSync(join(srcDir, f.from), dest)
    if (f.mode) chmodSync(dest, f.mode)
  }
}

/**
 * Only allow-listed `./hive` commands run; anything else is refused
 * without a prompt nobody on the phone could answer.
 */
export function butlerArgs(opts: { resume: boolean }): string[] {
  return [
    'remote-control',
    '--name', BUTLER_SESSION_NAME,
    '--permission-mode', 'dontAsk',
    ...(opts.resume ? ['--continue'] : [])
  ]
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

export type ButlerSignal = { kind: 'connected'; url: string } | { kind: 'trust' } | null

/** What the remote-control output so far says about the session. */
export function readButlerOutput(text: string): ButlerSignal {
  const plain = stripAnsi(text)
  const url = plain.match(/https:\/\/claude\.ai\/code[^\s'"<>]*/)
  if (url) return { kind: 'connected', url: url[0] }
  if (/trust (this|the files in this) folder|one you trust/i.test(plain)) return { kind: 'trust' }
  return null
}

/** Last few readable lines, for an error the owner can act on (e.g. "not logged in"). */
export function outputTail(text: string, lines = 6): string {
  return stripAnsi(text)
    .split(/\r?\n|\r/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(-lines)
    .join('\n')
}

export type ButlerStatus = 'off' | 'starting' | 'needs_trust' | 'connected' | 'error'

export interface ButlerState {
  enabled: boolean
  status: ButlerStatus
  url?: string
  error?: string
}

export interface PtyLike {
  pid: number
  write(data: string): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
}

export interface ButlerDeps {
  dataDir: string
  resourcesDir: string
  spawn: (args: string[], cwd: string) => PtyLike
  kill: (term: PtyLike) => void
  /** Kill a butler left running by a Hive that crashed (pid from the last run). */
  killStale: (pid: number) => void
  onState: (s: ButlerState) => void
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
}

const SETTINGS_FILE = 'butler.json'
const PID_FILE = '.pid'
/** Restart delays after a connected session exits on its own. */
export const RESTART_DELAYS_MS = [2_000, 10_000, 30_000, 120_000]
/** A session that stayed up this long resets the restart count. */
export const STABLE_AFTER_MS = 10 * 60_000

export function readButlerEnabled(dataDir: string): boolean {
  try {
    return JSON.parse(readFileSync(join(dataDir, SETTINGS_FILE), 'utf8'))?.enabled === true
  } catch {
    return false
  }
}

export function writeButlerEnabled(dataDir: string, enabled: boolean): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, SETTINGS_FILE), JSON.stringify({ enabled }) + '\n')
}

export function createButler(deps: ButlerDeps) {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>))
  const dir = butlerDir(deps.dataDir)

  let state: ButlerState = { enabled: readButlerEnabled(deps.dataDir), status: 'off' }
  let term: PtyLike | null = null
  let output = ''
  let connectedAt = 0
  let restarts = 0
  let restartTimer: unknown = null

  const set = (next: Partial<ButlerState>) => {
    state = { ...state, ...next }
    if (state.status !== 'connected') delete state.url
    if (state.status !== 'error') delete state.error
    deps.onState({ ...state })
  }

  const pidPath = join(dir, PID_FILE)

  function sweepStale() {
    try {
      const pid = Number(readFileSync(pidPath, 'utf8').trim())
      if (pid > 0) deps.killStale(pid)
    } catch { /* no previous run */ }
  }

  function launch(resume: boolean) {
    restartTimer = null
    try {
      installButlerFiles(deps.resourcesDir, dir)
    } catch (e) {
      set({ status: 'error', error: `Could not write ${dir}: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    output = ''
    connectedAt = 0
    set({ status: 'starting' })
    let t: PtyLike
    try {
      t = deps.spawn(butlerArgs({ resume }), dir)
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
      return
    }
    term = t
    try { writeFileSync(pidPath, String(t.pid)) } catch { /* best-effort */ }
    t.onData(data => {
      if (term !== t) return
      output = (output + data).slice(-20_000)
      if (state.status === 'connected') return
      const sig = readButlerOutput(output)
      if (sig?.kind === 'connected') {
        connectedAt = now()
        set({ status: 'connected', url: sig.url })
      } else if (sig?.kind === 'trust' && state.status !== 'needs_trust') {
        set({ status: 'needs_trust' })
      }
    })
    t.onExit(({ exitCode }) => {
      if (term !== t) return
      term = null
      if (!state.enabled) return
      const wasConnected = connectedAt > 0
      if (!wasConnected && resume) {
        // `--continue` fails when nothing was recorded here recently:
        // start a fresh session instead.
        launch(false)
        return
      }
      if (!wasConnected) {
        set({ status: 'error', error: outputTail(output) || `claude remote-control exited (${exitCode})` })
        return
      }
      if (now() - connectedAt >= STABLE_AFTER_MS) restarts = 0
      if (restarts >= RESTART_DELAYS_MS.length) {
        set({ status: 'error', error: outputTail(output) || `claude remote-control keeps exiting (${exitCode})` })
        return
      }
      const delay = RESTART_DELAYS_MS[restarts++]
      set({ status: 'starting' })
      restartTimer = setTimer(() => { if (state.enabled && !term) launch(true) }, delay)
    })
  }

  function stop() {
    if (restartTimer) { clearTimer(restartTimer); restartTimer = null }
    const t = term
    term = null
    if (t) { try { deps.kill(t) } catch { /* already gone */ } }
  }

  return {
    getState: (): ButlerState => ({ ...state }),
    /** At app start: bring the session back if the switch was left on. */
    restore() {
      if (!state.enabled || term) return
      sweepStale()
      launch(true)
    },
    setEnabled(enabled: boolean) {
      writeButlerEnabled(deps.dataDir, enabled)
      state.enabled = enabled
      restarts = 0
      if (enabled) {
        if (term) return
        sweepStale()
        launch(true)
      } else {
        stop()
        set({ status: 'off' })
      }
    },
    /** The owner agreed to let Claude Code run in the butler folder. */
    confirmTrust() {
      if (state.status !== 'needs_trust' || !term) return false
      // Forget the prompt text, or the next chunk would read as it again.
      output = ''
      term.write('\r')
      set({ status: 'starting' })
      return true
    },
    /** Retry after an error, without touching the switch. */
    retry() {
      if (!state.enabled || term) return
      restarts = 0
      launch(true)
    },
    /** App quit: stop the session but keep the switch as it is. */
    shutdown: stop,
    get folder() { return dir },
    get hasSession() { return term !== null }
  }
}
