// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { SOUNDS, XFADE, fadeCurve, loadSoundPrefs, nextSound, nextStart, saveSoundPrefs, seam } from '../lib/botanic-sound'

describe('🌿 garden sound loop', () => {
  it('each copy starts while the last fades out, so there is no gap', () => {
    let t = 0
    const starts = [t]
    for (let i = 0; i < 3; i++) starts.push(t = nextStart(t, 60, seam(60)))
    expect(starts).toEqual([0, 58, 116, 174])
  })

  it('short sounds get a shorter seam', () => {
    expect(seam(60)).toBe(XFADE)
    expect(seam(4)).toBe(1)
  })

  it('the crossfade keeps the same loudness (equal power)', () => {
    const up = fadeCurve(65, 'in'), down = fadeCurve(65, 'out')
    expect(up[0]).toBe(0)
    expect(up[64]).toBeCloseTo(1)
    expect(down[0]).toBe(1)
    expect(down[64]).toBeCloseTo(0)
    for (let i = 0; i < 65; i++) expect(up[i] ** 2 + down[i] ** 2).toBeCloseTo(1)
  })

  it('the name button walks through every sound and back', () => {
    let id = SOUNDS[0].id
    const seen = new Set([id])
    for (let i = 0; i < SOUNDS.length; i++) seen.add(id = nextSound(id))
    expect(seen.size).toBe(SOUNDS.length)
    expect(id).toBe(SOUNDS[0].id)
  })
})

describe('garden sound prefs', () => {
  beforeEach(() => localStorage.clear())

  it('defaults to bamboo at half volume', () => {
    expect(loadSoundPrefs()).toEqual({ sound: 'bamboo', volume: 0.5 })
  })

  it('remembers the sound and the volume', () => {
    saveSoundPrefs({ sound: 'forest', volume: 0.2 })
    expect(loadSoundPrefs()).toEqual({ sound: 'forest', volume: 0.2 })
  })

  it('a removed sound or a bad volume falls back', () => {
    localStorage.setItem('hive:botanic-sound', JSON.stringify({ sound: 'thunder', volume: 7 }))
    expect(loadSoundPrefs()).toEqual({ sound: 'bamboo', volume: 0.5 })
    localStorage.setItem('hive:botanic-sound', 'not json')
    expect(loadSoundPrefs()).toEqual({ sound: 'bamboo', volume: 0.5 })
  })
})
