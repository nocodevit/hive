// @vitest-environment jsdom
//
// randomAvatar tests — the whole point of this module is that new agents
// stop being clones of the default. Tests lock that promise in:
// (a) all fields fall inside their published option pools (no runtime
//     value that AvatarEditor can't render), and (b) across many calls
//     the outputs are actually different (a broken RNG that returns the
//     first element every time would silently regress to "same default
//     for everyone").

import { describe, it, expect } from 'vitest'
import { randomAvatar } from '../avatarRandom'
import { defaultAvatar } from '../types'
import {
  SKIN_TONES, HAIR_COLORS, HAIR_STYLES,
  TOP_STYLES, TOP_COLORS, BOTTOM_STYLES, BOTTOM_COLORS,
} from '../components/AvatarEditor'

// v2.7.0: test asserts against the SAME exported constants both
// avatarRandom.ts and the editor read from — no drifting copy.
const POOLS = {
  skinTone: SKIN_TONES,
  hairColor: HAIR_COLORS,
  // randomAvatar filters 'none' out because bald defaults read as
  // random-broken; hairStyle is checked against the filtered set.
  hairStyle: HAIR_STYLES.filter((h) => h !== 'none'),
  topStyle: TOP_STYLES,
  topColor: TOP_COLORS,
  bottomStyle: BOTTOM_STYLES,
  bottomColor: BOTTOM_COLORS,
}

describe('randomAvatar', () => {
  it('produces values inside the published option pools', () => {
    // 50 samples: guards against a bug like `arr[Math.floor(Math.random())]`
    // silently returning arr[0] every time by making a mis-index eventually
    // land outside the pool.
    for (let i = 0; i < 50; i++) {
      const a = randomAvatar()
      expect(POOLS.skinTone).toContain(a.skinTone)
      expect(POOLS.hairStyle).toContain(a.hairStyle)
      expect(POOLS.hairColor).toContain(a.hairColor)
      expect(POOLS.topStyle).toContain(a.topStyle)
      expect(POOLS.topColor).toContain(a.topColor)
      expect(POOLS.bottomStyle).toContain(a.bottomStyle)
      expect(POOLS.bottomColor).toContain(a.bottomColor)
      expect(a.hat).toBe('none')
      expect(a.accessories).toEqual([])
    }
  })

  it('actually randomizes across calls', () => {
    // The whole point of the feature. If randomAvatar() started returning
    // the default clone again, the new-agent flow would silently regress.
    // With 40 samples and 6+ options per field, the odds of *every*
    // sample matching the default for even one field are astronomical.
    const samples = Array.from({ length: 40 }, () => randomAvatar())
    const uniqueSkinTones = new Set(samples.map((s) => s.skinTone))
    const uniqueTopColors = new Set(samples.map((s) => s.topColor))
    expect(uniqueSkinTones.size).toBeGreaterThan(1)
    expect(uniqueTopColors.size).toBeGreaterThan(1)
  })

  it('does not return the exact defaultAvatar shape', () => {
    // Statistical: across 30 samples, at least one field on at least one
    // sample must differ from the default. Anything else = RNG broken.
    const samples = Array.from({ length: 30 }, () => randomAvatar())
    const allIdenticalToDefault = samples.every((s) =>
      s.skinTone === defaultAvatar.skinTone &&
      s.hairStyle === defaultAvatar.hairStyle &&
      s.topColor === defaultAvatar.topColor
    )
    expect(allIdenticalToDefault).toBe(false)
  })
})
