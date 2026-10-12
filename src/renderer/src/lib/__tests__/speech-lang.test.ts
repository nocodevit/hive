// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { getSpeechLang, setSpeechLang, speechLangLabel, useSpeechLang, joinVoiceText } from '../speech-lang'

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

describe('joinVoiceText', () => {
  it('starts from an empty input', () => {
    expect(joinVoiceText('', '我现在想说 project')).toBe('我现在想说 project')
  })
  it('does not put a space between Chinese chunks', () => {
    expect(joinVoiceText('我现在想说', '明天完成')).toBe('我现在想说明天完成')
    expect(joinVoiceText('完成。', '然后部署')).toBe('完成。然后部署')
  })
  it('separates two Latin words that would otherwise run together', () => {
    expect(joinVoiceText('run the build', 'then deploy')).toBe('run the build then deploy')
    expect(joinVoiceText('跑一下 e2e', 'test')).toBe('跑一下 e2e test')
    expect(joinVoiceText('v2', '3 个')).toBe('v2 3 个')
  })
  it('adds nothing at a Chinese/Latin boundary or after punctuation', () => {
    expect(joinVoiceText('我想说', 'project')).toBe('我想说project')
    expect(joinVoiceText('merge', '掉')).toBe('merge掉')
    expect(joinVoiceText('done.', 'next')).toBe('done.next')
    expect(joinVoiceText('done. ', 'next')).toBe('done. next')
  })
})
