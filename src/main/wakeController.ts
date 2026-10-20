// Wake word controller: runs `hive-speech --wake` while the setting is on,
// turns each command recording into text (cloud transcription when a key
// is set, else the helper's local text), decides where it goes
// (wakeWord.ts) and hands the renderer a proposal. Nothing is sent until
// the renderer confirms (countdown or Send) — and then only to the exact
// agent the proposal named, or one of its listed candidates.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { resolveAgent, type AgentRow } from './butlerApi'
import { startSpeechHelper, type AudioLine } from './voiceTranscribe'
import { BUTLER_CHAT_ID, isCancelText, namesOf, parseCommand, parseWakeLine, planForward, type ForwardPlan } from './wakeWord'

export const WAKE_SETTINGS_FILE = 'wake.json'

export function readWakeSettings(dir: string): { enabled: boolean } {
  try {
    return { enabled: JSON.parse(readFileSync(join(dir, WAKE_SETTINGS_FILE), 'utf8'))?.enabled === true }
  } catch {
    return { enabled: false }
  }
}

export function writeWakeSettings(dir: string, s: { enabled: boolean }): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, WAKE_SETTINGS_FILE), JSON.stringify(s) + '\n')
}

export interface WakeState {
  enabled: boolean
  status: 'off' | 'starting' | 'listening' | 'error'
  error?: string
}

export interface WakeProposal { id: string; heard: string; plan: ForwardPlan }

export type WakeEvent =
  | { type: 'state'; state: WakeState }
  | { type: 'wake' }
  | { type: 'proposal'; proposal: WakeProposal }
  | { type: 'cancel' }
  | { type: 'timeout' }

export type WakeSendResult =
  | { ok: true; to: string }
  | { ok: false; error: 'unknown_proposal' | 'not_a_candidate' | 'no_session' | 'nothing_to_send' | string }

type Helper = { stop: (graceMs?: number) => Promise<void>; kill: () => void }

export interface WakeDeps {
  dir: string
  helperPath: () => string | null
  resolveText: (audio: AudioLine) => Promise<string>
  rows: () => AgentRow[]
  isLive: (chatId: string) => boolean
  sendMessage: (chatId: string, text: string) => { ok: boolean; error?: string }
  isDictating: () => boolean
  emit: (ev: WakeEvent) => void
  startHelper?: (bin: string, args: string[], hooks: { onLine: (l: string) => void; onExit: (expected: boolean, lastError: string) => void }) => Helper
  removeFile?: (path: string) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  newId?: () => string
}

// A helper that was listening and then died (mic unplugged, coreaudiod
// restart) is restarted; one that never got to listening (no permission,
// no on-device model) is not — that would loop forever.
const RESTART_DELAYS_MS = [5_000, 30_000, 120_000]

export function createWakeController(deps: WakeDeps) {
  const start = deps.startHelper ?? startSpeechHelper
  const remove = deps.removeFile ?? (p => { try { unlinkSync(p) } catch { /* gone */ } })
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = deps.clearTimer ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>))
  let seq = 0
  const newId = deps.newId ?? (() => `wake-${Date.now()}-${++seq}`)

  let state: WakeState = { enabled: readWakeSettings(deps.dir).enabled, status: 'off' }
  let helper: Helper | null = null
  let reachedListening = false
  let restarts = 0
  let restartTimer: unknown = null
  let queue: Promise<void> = Promise.resolve()
  let pending: WakeProposal | null = null

  const set = (next: Partial<WakeState>) => {
    state = { ...state, ...next }
    if (state.status !== 'error') delete state.error
    deps.emit({ type: 'state', state: { ...state } })
  }

  function launch() {
    const bin = deps.helperPath()
    if (!bin || !existsSync(bin)) { set({ status: 'error', error: 'voice helper not found' }); return }
    reachedListening = false
    set({ status: 'starting' })
    const h = start(bin, ['--wake'], {
      onLine: line => handleLine(line),
      onExit: (expected, lastError) => {
        if (helper !== h) return
        helper = null
        if (expected || !state.enabled) return
        const delay = reachedListening ? RESTART_DELAYS_MS[restarts] : undefined
        set({ status: 'error', error: lastError || 'wake word stopped unexpectedly' })
        if (delay !== undefined) {
          restarts++
          restartTimer = setTimer(() => { restartTimer = null; if (state.enabled && !helper) launch() }, delay)
        }
      }
    })
    helper = h
  }

  function stopHelper() {
    if (restartTimer) { clearTimer(restartTimer); restartTimer = null }
    const h = helper
    helper = null
    if (h) void h.stop()
  }

  function handleLine(line: string) {
    const ev = parseWakeLine(line)
    if (!ev) return
    if (ev.kind === 'listening') { reachedListening = true; set({ status: 'listening' }); return }
    // Dictating into a chat: what is said is for that chat, not a command.
    if (deps.isDictating()) { if (ev.kind === 'command') remove(ev.path); return }
    if (ev.kind === 'wake') { deps.emit({ type: 'wake' }); return }
    if (ev.kind === 'timeout') { deps.emit({ type: 'timeout' }); return }
    if (ev.kind === 'cancel') { pending = null; deps.emit({ type: 'cancel' }); return }
    // Commands resolve one at a time, in the order they were spoken.
    queue = queue.then(async () => {
      const text = await deps.resolveText({ path: ev.path, fallback: ev.fallback }).catch(() => ev.fallback)
      if (isCancelText(text)) { pending = null; deps.emit({ type: 'cancel' }); return }
      const rows = deps.rows()
      const plan = planForward(parseCommand(text, namesOf(rows)), rows, deps.isLive(BUTLER_CHAT_ID))
      pending = { id: newId(), heard: text, plan }
      deps.emit({ type: 'proposal', proposal: pending })
    })
  }

  return {
    getState: (): WakeState => ({ ...state }),
    /** At app start: listen again if the setting was left on. */
    init() { if (state.enabled && !helper) launch() },
    setEnabled(enabled: boolean): WakeState {
      writeWakeSettings(deps.dir, { enabled })
      state = { ...state, enabled }
      restarts = 0
      if (enabled) { if (!helper) launch() } else { stopHelper(); pending = null; set({ status: 'off' }) }
      return { ...state }
    },
    /**
     * Send the pending proposal. `agentId` picks one of its candidates
     * (ambiguous / not_found); anything else is refused. Re-checks that
     * the chat is running at the moment of sending.
     */
    send(id: string, agentId?: string): WakeSendResult {
      const p = pending
      if (!p || p.id !== id) return { ok: false, error: 'unknown_proposal' }
      const plan = p.plan
      if (plan.kind === 'empty') return { ok: false, error: 'nothing_to_send' }
      if (plan.kind === 'butler') {
        if (!deps.isLive(BUTLER_CHAT_ID)) return { ok: false, error: 'no_session' }
        const r = deps.sendMessage(BUTLER_CHAT_ID, plan.text)
        if (r.ok) pending = null
        return r.ok ? { ok: true, to: 'Butler' } : { ok: false, error: r.error || 'send_failed' }
      }
      const allowed = plan.kind === 'ambiguous' || plan.kind === 'not_found' ? plan.candidates.map(c => c.agentId) : [plan.row.agentId]
      const target = agentId ?? (allowed.length === 1 ? allowed[0] : undefined)
      if (!target || !allowed.includes(target)) return { ok: false, error: 'not_a_candidate' }
      const found = resolveAgent(deps.rows(), { agentId: target })
      if (!found.ok) return { ok: false, error: 'not_found' }
      if (!found.row.chatLive) return { ok: false, error: 'no_session' }
      const r = deps.sendMessage(`chat-${found.row.agentId}`, plan.text)
      if (r.ok) pending = null
      return r.ok ? { ok: true, to: found.row.agent } : { ok: false, error: r.error || 'send_failed' }
    },
    dismiss(id: string) { if (pending?.id === id) pending = null },
    /** App quit: never leave the microphone open. */
    kill() {
      if (restartTimer) { clearTimer(restartTimer); restartTimer = null }
      const h = helper
      helper = null
      try { h?.kill() } catch { /* best-effort */ }
    },
    /** Tests: resolves once every command handed over so far is proposed. */
    idle: () => queue
  }
}
