import { describe, it, expect } from 'vitest'
import { expectsPasteCode } from '../components/hive-chat/authPrompt'

describe('expectsPasteCode', () => {
  it('fires on the real CLI paste-code prompt', () => {
    expect(expectsPasteCode('Paste code here if prompted > ')).toBe(true)
  })

  it('matches common phrasings', () => {
    expect(expectsPasteCode('Please paste the code from your browser:')).toBe(true)
    expect(expectsPasteCode('Enter the code shown after signing in')).toBe(true)
    expect(expectsPasteCode('Paste the authorization code below')).toBe(true)
  })

  it('does NOT fire on the sign-in URL line or ordinary output', () => {
    expect(expectsPasteCode('Visit https://claude.ai/oauth/authorize?code=... to sign in')).toBe(false)
    expect(expectsPasteCode('Opening your browser…')).toBe(false)
    expect(expectsPasteCode('')).toBe(false)
  })

  it('finds the prompt inside a larger accumulated buffer', () => {
    const buf = 'Opening browser…\nWaiting for authorization…\nPaste code here if prompted >'
    expect(expectsPasteCode(buf)).toBe(true)
  })
})
