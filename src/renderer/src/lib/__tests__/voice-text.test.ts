import { describe, it, expect } from 'vitest'
import { joinVoiceText } from '../voice-text'

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
