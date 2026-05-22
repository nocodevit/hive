import { describe, it, expect } from 'vitest'
import { isHeadlessMode } from '../headless'

describe('isHeadlessMode', () => {
  it('returns true when HEADLESS=1', () => {
    expect(isHeadlessMode({ HEADLESS: '1' })).toBe(true)
  })

  it('returns false when HEADLESS is unset', () => {
    expect(isHeadlessMode({})).toBe(false)
  })

  it('returns false for non-"1" truthy values (only "1" opts in)', () => {
    expect(isHeadlessMode({ HEADLESS: 'true' })).toBe(false)
    expect(isHeadlessMode({ HEADLESS: 'yes' })).toBe(false)
    expect(isHeadlessMode({ HEADLESS: '0' })).toBe(false)
    expect(isHeadlessMode({ HEADLESS: '' })).toBe(false)
  })
})
