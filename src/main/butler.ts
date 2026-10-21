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

import { chmodSync, copyFileSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { claudeProjectSlug } from '../shared/claude-project-slug'
import { composeSkills } from './butlerSkills'
import { ownerAllow } from './butlerTools'

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

/** Overwrite the bundled files into the butler folder. Other files are left alone.
 *  .claude/settings.json is the Butler allow-list: every claude run in the folder
 *  (phone / desk chat, routines, answer-for-me) follows it. The owner's additions
 *  (allow-list.json) are merged in, so an upgrade never drops them. */
export function installButlerFiles(srcDir: string, destDir: string): void {
  for (const f of BUTLER_FILES) {
    const dest = join(destDir, f.to)
    mkdirSync(join(dest, '..'), { recursive: true })
    copyFileSync(join(srcDir, f.from), dest)
    if (f.mode) chmodSync(dest, f.mode)
  }
  const extra = ownerAllow(destDir)
  if (extra.length) {
    const settingsPath = join(destDir, '.claude', 'settings.json')
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    s.permissions.allow = Array.from(new Set([...s.permissions.allow, ...extra]))
    writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n')
  }
  composeSkills({ defaultsDir: join(srcDir, 'skills'), butlerDir: destDir })
}

/**
 * How to bring the session up, tried in this order: the session Hive
 * connected last time (by id, so the phone keeps one "Hive Butler" with its
 * history however long Hive was closed), the last one recorded here
 * (`--continue`, only within about 4 hours), a new one.
 */
export type LaunchMode = { sessionId: string } | 'continue' | 'fresh'

/**
 * New sessions refuse anything not allow-listed (`dontAsk`) rather than
 * ask on a phone. `--session-id` takes no spawn flags: a reattached
 * session keeps the name and mode it was created with.
 */
export function butlerArgs(mode: LaunchMode): string[] {
  if (typeof mode === 'object') return ['remote-control', '--session-id', mode.sessionId]
  return [
    'remote-control',
    '--name', BUTLER_SESSION_NAME,
    '--permission-mode', 'dontAsk',
    ...(mode === 'continue' ? ['--continue'] : [])
  ]
}

/**
 * `claude remote-control` records the session it runs for a folder in
 * ~/.claude/projects/<slug>/bridge-pointer.json (what `--continue` reads).
 * Hive only reads it, once connected, and keeps its own copy of the id.
 */
export function bridgeSessionId(claudeHome: string, cwd: string): string | null {
  try {
    // claude keys the folder by its real path (macOS temp dirs are symlinks).
    const real = realpathSync(cwd)
    const p = JSON.parse(readFileSync(join(claudeHome, 'projects', claudeProjectSlug(real), 'bridge-pointer.json'), 'utf8'))
    return typeof p?.sessionId === 'string' && p.sessionId ? p.sessionId : null
  } catch {
    return null
  }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

export type ButlerSignal = { kind: 'connected'; url: string } | { kind: 'trust' } | { kind: 'enable' } | null

/**
 * What the remote-control output so far says. Its two questions, in order:
 * "Trust <folder>? [y/N]" (first run in a folder; the owner answers in
 * Settings) and "Enable Remote Control? (y/n)" (turning the switch on was
 * the yes). Then "Connected" and the claude.ai/code link.
 */
export function readButlerOutput(text: string): ButlerSignal {
  const plain = stripAnsi(text)
  const url = plain.match(/https:\/\/claude\.ai\/code[^\s'"<>]*/)
  if (url) return { kind: 'connected', url: url[0] }
  const enable = plain.search(/Enable Remote Control\?/i)
  const trust = plain.search(/one you trust|Trust \S.*\? \[y\/N\]/i)
  if (enable >= 0 && enable > trust) return { kind: 'enable' }
  if (trust >= 0) return { kind: 'trust' }
  return null
}

/**
 * Claude Code's own trust record for a folder: `hasTrustDialogAccepted` in
 * .claude.json (in CLAUDE_CONFIG_DIR when set, else the home folder). Read
 * fresh on every prompt so a revoked trust is seen; never written by Hive.
 */
export function claudeTrustsFolder(configFile: string, cwd: string): boolean {
  try {
    const real = realpathSync(cwd)
    const projects = JSON.parse(readFileSync(configFile, 'utf8'))?.projects
    return projects?.[real]?.hasTrustDialogAccepted === true
  } catch {
    return false
  }
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
  /** Claude Code still trusts the butler folder (see claudeTrustsFolder), read now. */
  claudeTrusts: () => boolean
  /** The session id remote-control recorded for the butler folder (see bridgeSessionId). */
  recordedSessionId: () => string | null
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
const SESSION_FILE = '.session-id'
/** Restart delays after a connected session exits on its own. */
export const RESTART_DELAYS_MS = [2_000, 10_000, 30_000, 120_000]
/** A session that stayed up this long resets the restart count. */
export const STABLE_AFTER_MS = 10 * 60_000

/**
 * `enabled` is the switch. `trusted` records that the owner answered
 * remote-control's folder-trust question (which it asks on every start)
 * since the switch was last turned on; turning the switch off clears it.
 * Hive answers the question itself only while this is set AND Claude
 * Code's own record still trusts the folder (claudeTrustsFolder).
 */
/**
 * Bumped when Butler's setup changes enough that everyone — upgraded users
 * too — should go through it again. Below this, the first-run card shows
 * and wizard progress starts over; the settings themselves are kept, so
 * the wizard opens on the owner's current values.
 * 2 = Butler assistant (v2.33): skills, email, routines, Feishu, calendar.
 */
export const SETUP_VERSION = 2

export interface ButlerSettings {
  enabled: boolean
  trusted: boolean
  /** Setup version the owner last answered the first-run card for (0 = never). */
  offeredVersion: number
  /** Butler stays at the top of the project list. */
  pinned: boolean
  /** Setup version the wizard marks below belong to. */
  setupVersion: number
  /** Setup wizard: step id → answered how. */
  setup: Record<string, SetupMark>
  /** The "Setup n/m" card in the Butler panel was dismissed. */
  setupCardHidden: boolean
}

export type SetupMark = 'done' | 'skipped'

function readSetup(v: unknown): Record<string, SetupMark> {
  const out: Record<string, SetupMark> = {}
  if (v && typeof v === 'object') {
    for (const [k, m] of Object.entries(v as Record<string, unknown>)) if (m === 'done' || m === 'skipped') out[k] = m
  }
  return out
}

export function readButlerSettings(dataDir: string): ButlerSettings {
  try {
    const j = JSON.parse(readFileSync(join(dataDir, SETTINGS_FILE), 'utf8'))
    return {
      enabled: j?.enabled === true, trusted: j?.trusted === true,
      offeredVersion: Number.isInteger(j?.offeredVersion) ? j.offeredVersion : 0, pinned: j?.pinned === true,
      setupVersion: Number.isInteger(j?.setupVersion) ? j.setupVersion : 0,
      setup: readSetup(j?.setup), setupCardHidden: j?.setupCardHidden === true
    }
  } catch {
    return { enabled: false, trusted: false, offeredVersion: 0, pinned: false, setupVersion: 0, setup: {}, setupCardHidden: false }
  }
}

export function writeButlerSettings(dataDir: string, s: ButlerSettings): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, SETTINGS_FILE), JSON.stringify(s) + '\n')
}

export function createButler(deps: ButlerDeps) {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>))
  const dir = butlerDir(deps.dataDir)

  const saved = readButlerSettings(deps.dataDir)
  let trusted = saved.trusted
  let offeredVersion = saved.offeredVersion
  let pinned = saved.pinned
  let setup = saved.setup
  // Progress from an older setup does not count; the card comes back too.
  const current = saved.setupVersion === SETUP_VERSION
  if (!current) { setup = {} }
  let setupCardHidden = current && saved.setupCardHidden
  let state: ButlerState = { enabled: saved.enabled, status: 'off' }
  const persist = () => writeButlerSettings(deps.dataDir, { enabled: state.enabled, trusted, offeredVersion, pinned, setupVersion: SETUP_VERSION, setup, setupCardHidden })
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
  const sessionPath = join(dir, SESSION_FILE)

  const savedSession = (): string | null => {
    try { return readFileSync(sessionPath, 'utf8').trim() || null } catch { return null }
  }
  /** The best way back to the session, falling through to a new one. */
  const resumeMode = (): LaunchMode => {
    const id = savedSession()
    return id ? { sessionId: id } : 'continue'
  }

  function sweepStale() {
    try {
      const pid = Number(readFileSync(pidPath, 'utf8').trim())
      if (pid > 0) deps.killStale(pid)
    } catch { /* no previous run */ }
  }

  function launch(mode: LaunchMode) {
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
      t = deps.spawn(butlerArgs(mode), dir)
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
        const id = deps.recordedSessionId()
        if (id && id !== savedSession()) { try { writeFileSync(sessionPath, id) } catch { /* best-effort */ } }
        set({ status: 'connected', url: sig.url })
      } else if (sig?.kind === 'trust' && trusted && deps.claudeTrusts()) {
        output = ''
        t.write('y\r')
      } else if (sig?.kind === 'trust' && state.status !== 'needs_trust') {
        set({ status: 'needs_trust' })
      } else if (sig?.kind === 'enable') {
        output = ''
        t.write('y\r')
      }
    })
    t.onExit(({ exitCode }) => {
      if (term !== t) return
      term = null
      if (!state.enabled) return
      const wasConnected = connectedAt > 0
      if (!wasConnected && typeof mode === 'object') {
        // That session is gone: forget it and try the next way back.
        try { unlinkSync(sessionPath) } catch { /* already gone */ }
        launch('continue')
        return
      }
      if (!wasConnected && mode === 'continue') {
        // Nothing recorded here recently: start a new session.
        launch('fresh')
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
      restartTimer = setTimer(() => { if (state.enabled && !term) launch(resumeMode()) }, delay)
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
      launch(resumeMode())
    },
    /** Ask once whether to turn it on: never after an answer or once it was on. */
    /** Once per setup version, whatever was set before (upgraded users too). */
    get shouldOffer() { return offeredVersion < SETUP_VERSION },
    getSetup: () => ({ marks: { ...setup }, cardHidden: setupCardHidden }),
    markSetup(step: string, mark: SetupMark | null) {
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(step)) return
      setup = { ...setup }
      if (mark) setup[step] = mark
      else delete setup[step]
      persist()
    },
    hideSetupCard(hidden: boolean) {
      setupCardHidden = hidden
      persist()
    },
    get pinned() { return pinned },
    setPinned(v: boolean) {
      pinned = v
      persist()
    },
    /** The offer was answered ("Turn on" or "Not now"). */
    offerAnswered() {
      offeredVersion = SETUP_VERSION
      persist()
    },
    setEnabled(enabled: boolean) {
      state.enabled = enabled
      // Turning it off withdraws the OK: the next "on" asks again.
      if (!enabled) trusted = false
      persist()
      restarts = 0
      if (enabled) {
        if (term) return
        sweepStale()
        launch(resumeMode())
      } else {
        stop()
        set({ status: 'off' })
      }
    },
    /** The owner agreed to let Claude Code run in the butler folder. */
    confirmTrust() {
      if (state.status !== 'needs_trust' || !term) return false
      trusted = true
      persist()
      // Forget the prompt text, or the next chunk would read as it again.
      output = ''
      term.write('y\r')
      set({ status: 'starting' })
      return true
    },
    /** Retry after an error, without touching the switch. */
    retry() {
      if (!state.enabled || term) return
      restarts = 0
      launch(resumeMode())
    },
    /** The folder, with the bundled files written — for Hive's own Butler chat. */
    ensureFolder(): string {
      installButlerFiles(deps.resourcesDir, dir)
      return dir
    },
    /** App quit: stop the session but keep the switch as it is. */
    shutdown: stop,
    get folder() { return dir },
    get hasSession() { return term !== null }
  }
}
