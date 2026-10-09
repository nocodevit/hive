// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { getSpeechLang, setSpeechLang, speechLangLabel, useSpeechLang } from '../speech-lang'

describe('speech-lang', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to zh-CN', () => {
    expect(getSpeechLang()).toBe('zh-CN')
  })

  it('persists en-US and falls back to zh-CN on junk', () => {
    setSpeechLang('en-US')
    expect(getSpeechLang()).toBe('en-US')
    localStorage.setItem('hive-speech-lang', 'fr-FR')
    expect(getSpeechLang()).toBe('zh-CN')
  })

  it('defaults to zh-CN when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(getSpeechLang()).toBe('zh-CN')
    spy.mockRestore()
  })

  it('labels', () => {
    expect(speechLangLabel('zh-CN')).toBe('中')
    expect(speechLangLabel('en-US')).toBe('EN')
  })

  it('toggle syncs every hook instance', () => {
    const a = renderHook(() => useSpeechLang())
    const b = renderHook(() => useSpeechLang())
    act(() => a.result.current[1]())
    expect(a.result.current[0]).toBe('en-US')
    expect(b.result.current[0]).toBe('en-US')
    act(() => b.result.current[1]())
    expect(a.result.current[0]).toBe('zh-CN')
  })
})
