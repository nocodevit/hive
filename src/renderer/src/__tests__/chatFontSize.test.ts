// @vitest-environment jsdom
//
// clampChatFontSize tests — the whole "per-project chat font size"
// feature depends on this clamp accepting sensible values, defaulting
// gracefully, and refusing garbage.

import { describe, it, expect } from 'vitest'
import {
  clampChatFontSize, DEFAULT_CHAT_FONT_SIZE,
  CHAT_FONT_SIZE_MIN, CHAT_FONT_SIZE_MAX,
} from '../types'

describe('clampChatFontSize', () => {
  it('returns the default when the value is undefined', () => {
    expect(clampChatFontSize(undefined)).toBe(DEFAULT_CHAT_FONT_SIZE)
  })

  it('returns the default for NaN / Infinity (garbage from bad JSON)', () => {
    expect(clampChatFontSize(NaN)).toBe(DEFAULT_CHAT_FONT_SIZE)
    expect(clampChatFontSize(Infinity)).toBe(DEFAULT_CHAT_FONT_SIZE)
    expect(clampChatFontSize(-Infinity)).toBe(DEFAULT_CHAT_FONT_SIZE)
  })

  it('clamps values below the minimum', () => {
    expect(clampChatFontSize(5)).toBe(CHAT_FONT_SIZE_MIN)
    expect(clampChatFontSize(-100)).toBe(CHAT_FONT_SIZE_MIN)
  })

  it('clamps values above the maximum', () => {
    expect(clampChatFontSize(50)).toBe(CHAT_FONT_SIZE_MAX)
    expect(clampChatFontSize(999)).toBe(CHAT_FONT_SIZE_MAX)
  })

  it('rounds fractional values to integers', () => {
    expect(clampChatFontSize(13.4)).toBe(13)
    expect(clampChatFontSize(13.7)).toBe(14)
  })

  it('passes through valid whole-number values in range', () => {
    for (let n = CHAT_FONT_SIZE_MIN; n <= CHAT_FONT_SIZE_MAX; n++) {
      expect(clampChatFontSize(n)).toBe(n)
    }
  })
})
