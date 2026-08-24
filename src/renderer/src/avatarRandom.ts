// avatarRandom.ts — v2.7.0: pick a fresh look every time a new agent is
// created, instead of every agent starting life as the same purple-tee
// short-brown-hair default. Users called out that a screen full of
// identical defaults defeats the point of the pixel-avatar identity.
//
// Every field draws from the same option pools AvatarEditor already uses;
// the intent is a *representative* sample of the design system, not a
// crazy random combinator that might produce clown outfits. Accessories
// stay off by default so the avatar reads clean — user can add one from
// the editor if they want.

import type { AvatarConfig } from './types'

const SKIN_TONES  = ['#fde0c4', '#f5d0a9', '#dba97a', '#c68642', '#8d5524', '#5c3317']
const HAIR_COLORS = ['#2c1810', '#4a3728', '#8b6914', '#c4a35a', '#d4a76a', '#e8c07a', '#7c3aed', '#06b6d4', '#f43f5e']
const HAIR_STYLES = ['short', 'parted', 'spiky', 'bun', 'long']  // omit 'none' — bald default feels random-broken
const TOP_STYLES  = ['tee', 'hoodie', 'jacket', 'tank']
const TOP_COLORS  = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#1e293b', '#f8fafc']
const BOTTOM_STYLES = ['pants', 'shorts', 'skirt']
const BOTTOM_COLORS = ['#1e293b', '#3b82f6', '#6b7280', '#7c3aed', '#0f172a', '#ec4899']

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Fresh randomized AvatarConfig for a new agent. */
export function randomAvatar(): AvatarConfig {
  return {
    skinTone:    pick(SKIN_TONES),
    hairStyle:   pick(HAIR_STYLES),
    hairColor:   pick(HAIR_COLORS),
    topStyle:    pick(TOP_STYLES),
    topColor:    pick(TOP_COLORS),
    bottomStyle: pick(BOTTOM_STYLES),
    bottomColor: pick(BOTTOM_COLORS),
    hat: 'none',
    accessories: [],
  }
}
