import bamboo from '../assets/botanic/sounds/bamboo.mp3'
import forest from '../assets/botanic/sounds/forest.mp3'

/** 🌿 Botanic ambience. Credits: assets/botanic/CREDITS.md. */
export const SOUNDS = [
  { id: 'bamboo', label: 'Bamboo', url: bamboo },
  { id: 'forest', label: 'Forest', url: forest }
] as const
export type SoundId = (typeof SOUNDS)[number]['id']

/** Seconds two copies of a sound overlap at the loop seam. */
export const XFADE = 2
/** Seconds to fade in on start, out on stop, and across when switching sounds. */
export const FADE = 1

/** The next copy starts while the current one is fading out. */
export const nextStart = (start: number, duration: number, xf: number) => start + duration - xf

/** The seam overlap for a sound: shorter sounds get a shorter one. */
export const seam = (duration: number) => Math.min(XFADE, duration / 4)

/** Equal-power fade (sin / cos): the sum stays as loud through the seam. */
export function fadeCurve(n: number, dir: 'in' | 'out'): Float32Array {
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (Math.PI / 2)
    c[i] = dir === 'in' ? Math.sin(t) : Math.cos(t)
  }
  return c
}

export const nextSound = (id: SoundId): SoundId => SOUNDS[(SOUNDS.findIndex(s => s.id === id) + 1) % SOUNDS.length].id
export const soundLabel = (id: SoundId) => SOUNDS.find(s => s.id === id)!.label

export interface SoundPrefs { sound: SoundId; volume: number }
const KEY = 'hive:botanic-sound'
const DEFAULT: SoundPrefs = { sound: 'bamboo', volume: 0.5 }

/** Which sound and how loud. Never whether it plays: it starts only on a click. */
export function loadSoundPrefs(): SoundPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}')
    const sound = SOUNDS.some(s => s.id === p.sound) ? p.sound : DEFAULT.sound
    const volume = typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : DEFAULT.volume
    return { sound, volume }
  } catch { return { ...DEFAULT } }
}
export const saveSoundPrefs = (p: SoundPrefs) => localStorage.setItem(KEY, JSON.stringify(p))
