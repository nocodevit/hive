import { useEffect, useState } from 'react'

// Voice auto-send: once the speaker has clearly finished (every utterance
// transcribed, then a pause with no new speech) the composer sends what
// was dictated. This file holds the decision logic and the two prefs; the
// timer and the actual send live in HiveChat.

export type VoiceEvent =
  | { kind: 'speaking' }             // an utterance opened
  | { kind: 'final'; text: string }  // an utterance came back (text may be empty)
  | { kind: 'dropped' }              // an opened utterance turned out to be noise
  | { kind: 'typed' }                // the user edited the input by hand
  | { kind: 'sent' }                 // the input was sent (by anyone)
  | { kind: 'stopped' }              // listening ended

export interface AutoSendState {
  /** Utterances opened whose text has not arrived yet. */
  pending: number
  /** Dictated text is sitting in the input, unsent and untouched by hand. */
  dirty: boolean
}

export const AUTO_SEND_IDLE: AutoSendState = { pending: 0, dirty: false }

/**
 * `arm`: start (or restart) the countdown. `cancel`: stop it. `null`: leave
 * it as it is. Never arms while text is still on its way, and never for
 * input the user typed or edited themselves — only for fresh dictation.
 */
export function autoSendStep(state: AutoSendState, ev: VoiceEvent): { state: AutoSendState; action: 'arm' | 'cancel' | null } {
  switch (ev.kind) {
    case 'speaking':
      return { state: { ...state, pending: state.pending + 1 }, action: 'cancel' }
    case 'final':
    case 'dropped': {
      const pending = Math.max(0, state.pending - 1)
      const dirty = state.dirty || (ev.kind === 'final' && ev.text.trim() !== '')
      return { state: { pending, dirty }, action: pending === 0 && dirty ? 'arm' : null }
    }
    case 'typed':
      return { state: { ...state, dirty: false }, action: 'cancel' }
    case 'sent':
      return { state: { ...state, dirty: false }, action: 'cancel' }
    case 'stopped':
      return { state: AUTO_SEND_IDLE, action: 'cancel' }
  }
}

const ENABLED_KEY = 'hive-voice-autosend'
const DELAY_KEY = 'hive-voice-autosend-delay-ms'
const EVENT = 'hive:voice-autosend-prefs'
export const AUTO_SEND_DELAY_DEFAULT_MS = 2500
export const AUTO_SEND_DELAY_MIN_MS = 1000
export const AUTO_SEND_DELAY_MAX_MS = 10000

export function clampDelay(ms: unknown): number {
  const n = typeof ms === 'number' ? ms : Number(ms)
  if (!Number.isFinite(n)) return AUTO_SEND_DELAY_DEFAULT_MS
  return Math.min(AUTO_SEND_DELAY_MAX_MS, Math.max(AUTO_SEND_DELAY_MIN_MS, Math.round(n)))
}

export function getAutoSendPrefs(): { enabled: boolean; delayMs: number } {
  try {
    const raw = localStorage.getItem(DELAY_KEY)
    return {
      enabled: localStorage.getItem(ENABLED_KEY) === '1',
      delayMs: raw === null ? AUTO_SEND_DELAY_DEFAULT_MS : clampDelay(raw)
    }
  } catch {
    return { enabled: false, delayMs: AUTO_SEND_DELAY_DEFAULT_MS }
  }
}

export function setAutoSendPrefs(next: Partial<{ enabled: boolean; delayMs: number }>) {
  try {
    if (next.enabled !== undefined) localStorage.setItem(ENABLED_KEY, next.enabled ? '1' : '0')
    if (next.delayMs !== undefined) localStorage.setItem(DELAY_KEY, String(clampDelay(next.delayMs)))
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT))
}

/** Shared by the composer pill and App Settings; every instance stays in sync. */
export function useAutoSendPrefs() {
  const [prefs, setPrefs] = useState(getAutoSendPrefs)
  useEffect(() => {
    const onChange = () => setPrefs(getAutoSendPrefs())
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])
  return prefs
}
