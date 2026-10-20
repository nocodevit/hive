import { describe, it, expect } from 'vitest'
import { chipLabel, cleanOverlay, foldDiff, isIpcError, sameOverlay, sameProfile, skillMeta, toProfile } from '../butler-skills'

describe('butler-skills helpers', () => {
  it('chipLabel: the topic before the dash, without the lock', () => {
    expect(chipLabel('🔒 dates — any date or deadline')).toBe('dates')
    expect(chipLabel('- 🔒 prices — prices, quotes')).toBe('prices')
    expect(chipLabel('hiring')).toBe('hiring')
  })
  it('cleanOverlay drops blanks, de-dupes chips and refuses locked labels', () => {
    expect(cleanOverlay({ tone: 'direct', maxLength: ' ', language: ' zh ', extra: '', extraAskFirst: ['hiring', ' hiring ', '', 'dates'] }, ['🔒 dates — x']))
      .toEqual({ tone: 'direct', language: 'zh', extraAskFirst: ['hiring'] })
    expect(cleanOverlay({ extraAskFirst: [] })).toEqual({})
  })
  it('sameOverlay ignores blanks', () => {
    expect(sameOverlay({ maxLength: '' }, {})).toBe(true)
    expect(sameOverlay({ tone: 'formal' }, {})).toBe(false)
  })
  it('foldDiff keeps changes with one line of context', () => {
    const d = ['a', 'b', 'c', 'd', 'e'].map(t => ({ op: ' ' as const, text: t }))
    d.splice(3, 0, { op: '+' as any, text: 'X' })
    expect(foldDiff(d).map(l => l.op === '…' ? '…' : l.text)).toEqual(['…', 'c', 'X', 'd', '…'])
    expect(foldDiff([])).toEqual([])
  })
  it('isIpcError: errors only, not lint results', () => {
    expect(isIpcError({ ok: false, error: 'bad_id' })).toBe(true)
    expect(isIpcError({ ok: false, error: 'x', problems: [] })).toBe(false)
    expect(isIpcError([])).toBe(false)
    expect(isIpcError(null)).toBe(false)
  })
  it('skillMeta falls back to a readable label', () => {
    expect(skillMeta('reply-email').label).toBe('Reply email')
    expect(skillMeta('weekly-sync')).toEqual({ icon: '📝', label: 'Weekly sync', sample: '' })
  })
  it('toProfile fills every field and fixes the style', () => {
    const p = toProfile({ name: 'Mei', style: 'loud', role: 3 } as any)
    expect(p.name).toBe('Mei')
    expect(p.role).toBe('')
    expect(p.style).toBe('direct')
    expect(sameProfile(p, { ...p, name: ' Mei ' })).toBe(true)
    expect(sameProfile(p, { ...p, team: 'x' })).toBe(false)
  })
})
