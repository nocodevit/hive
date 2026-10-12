// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  autoSendStep, AUTO_SEND_IDLE, clampDelay, getAutoSendPrefs, setAutoSendPrefs, useAutoSendPrefs,
  AUTO_SEND_DELAY_DEFAULT_MS, type VoiceEvent, type AutoSendState
} from '../voice-autosend'

/** Run events from idle; return the action each produced and the end state. */
function play(events: VoiceEvent[], from: AutoSendState = AUTO_SEND_IDLE) {
  let state = from
  const actions = events.map(ev => { const r = autoSendStep(state, ev); state = r.state; return r.action })
  return { actions, state }
}
const speaking: VoiceEvent = { kind: 'speaking' }
const final = (text: string): VoiceEvent => ({ kind: 'final', text })
const dropped: VoiceEvent = { kind: 'dropped' }

describe('autoSendStep', () => {
  it('arms once a spoken sentence has come back', () => {
    expect(play([speaking, final('继续做 e2e')]).actions).toEqual(['cancel', 'arm'])
  })
  it('speaking again cancels the countdown, and it re-arms after that sentence', () => {
    expect(play([speaking, final('第一句'), speaking, final('第二句')]).actions).toEqual(['cancel', 'arm', 'cancel', 'arm'])
  })
  it('waits for every sentence still being transcribed', () => {
    // Two sentences spoken back to back; the first text arrives while the
    // second is still on its way.
    expect(play([speaking, speaking, final('第一句'), final('第二句')]).actions).toEqual(['cancel', 'cancel', null, 'arm'])
  })
  it('a cough after a sentence cancels, then re-arms when it is dropped', () => {
    expect(play([speaking, final('第一句'), speaking, dropped]).actions).toEqual(['cancel', 'arm', 'cancel', 'arm'])
  })
  it('noise alone never sends', () => {
    expect(play([speaking, dropped, speaking, final('')]).actions).toEqual(['cancel', null, 'cancel', null])
  })
  it('never sends text the user typed themselves just because of a noise', () => {
    expect(play([{ kind: 'typed' }, speaking, dropped]).actions).toEqual(['cancel', 'cancel', null])
  })
  it('editing by hand takes over: cancels, and stays quiet until new speech', () => {
    const r = play([speaking, final('第一句'), { kind: 'typed' }, speaking, dropped])
    expect(r.actions).toEqual(['cancel', 'arm', 'cancel', 'cancel', null])
    expect(play([speaking, final('补一句')], r.state).actions).toEqual(['cancel', 'arm'])
  })
  it('after a send, the next sentence arms again', () => {
    expect(play([speaking, final('第一条'), { kind: 'sent' }, speaking, final('第二条')]).actions)
      .toEqual(['cancel', 'arm', 'cancel', 'cancel', 'arm'])
  })
  it('a send (manual Enter) clears the pending dictation', () => {
    const r = play([speaking, final('第一条'), { kind: 'sent' }, speaking, dropped])
    expect(r.actions.at(-1)).toBeNull()
  })
  it('stopping the mic cancels and forgets everything', () => {
    const r = play([speaking, speaking, final('第一句'), { kind: 'stopped' }])
    expect(r.actions.at(-1)).toBe('cancel')
    expect(r.state).toEqual(AUTO_SEND_IDLE)
  })
  it('tolerates a stray final with nothing pending', () => {
    expect(play([final('迟到的一句')]).state).toEqual({ pending: 0, dirty: true })
  })
})

describe('auto-send prefs', () => {
  beforeEach(() => localStorage.clear())

  it('is off by default with a 2.5s pause', () => {
    expect(getAutoSendPrefs()).toEqual({ enabled: false, delayMs: AUTO_SEND_DELAY_DEFAULT_MS })
    expect(AUTO_SEND_DELAY_DEFAULT_MS).toBe(2500)
  })
  it('persists both settings', () => {
    setAutoSendPrefs({ enabled: true, delayMs: 4000 })
    expect(getAutoSendPrefs()).toEqual({ enabled: true, delayMs: 4000 })
    setAutoSendPrefs({ enabled: false })
    expect(getAutoSendPrefs()).toEqual({ enabled: false, delayMs: 4000 })
  })
  it('clamps the pause to 1–10s and ignores junk', () => {
    expect(clampDelay(200)).toBe(1000)
    expect(clampDelay(60000)).toBe(10000)
    expect(clampDelay('3000')).toBe(3000)
    expect(clampDelay('abc')).toBe(AUTO_SEND_DELAY_DEFAULT_MS)
    localStorage.setItem('hive-voice-autosend-delay-ms', 'nope')
    expect(getAutoSendPrefs().delayMs).toBe(AUTO_SEND_DELAY_DEFAULT_MS)
  })
  it('falls back to off when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getAutoSendPrefs()).toEqual({ enabled: false, delayMs: AUTO_SEND_DELAY_DEFAULT_MS })
    spy.mockRestore()
  })
  it('keeps every hook instance in sync', () => {
    const a = renderHook(() => useAutoSendPrefs())
    const b = renderHook(() => useAutoSendPrefs())
    act(() => setAutoSendPrefs({ enabled: true }))
    expect(a.result.current.enabled).toBe(true)
    expect(b.result.current.enabled).toBe(true)
  })
})
