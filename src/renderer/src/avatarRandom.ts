// avatarRandom.ts — v2.7.0: pick a fresh look every time a new agent is
// created, instead of every agent starting life as the same purple-tee
// short-brown-hair default.
//
// Pools are re-exported from AvatarEditor so this file never drifts from
// the design system (prior implementation copy-pasted arrays that could
// silently disagree with the editor's swatch grid).

import type { AvatarConfig } from './types'
import {
  SKIN_TONES, HAIR_COLORS, HAIR_STYLES,
  TOP_STYLES, TOP_COLORS,
  BOTTOM_STYLES, BOTTOM_COLORS,
} from './components/AvatarEditor'

// Filter out 'none' hair — a bald default reads as random-broken, not
// as an intentional look. Users who want it can still pick it in the editor.
const RANDOM_HAIR_STYLES = HAIR_STYLES.filter((h) => h !== 'none')

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Fresh randomized AvatarConfig for a new agent. */
export function randomAvatar(): AvatarConfig {
  return {
    skinTone:    pick(SKIN_TONES),
    hairStyle:   pick(RANDOM_HAIR_STYLES),
    hairColor:   pick(HAIR_COLORS),
    topStyle:    pick(TOP_STYLES),
    topColor:    pick(TOP_COLORS),
    bottomStyle: pick(BOTTOM_STYLES),
    bottomColor: pick(BOTTOM_COLORS),
    hat: 'none',
    accessories: [],
  }
}
