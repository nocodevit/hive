// palette.ts — accent-palette overlay. Independent of light/dark theme;
// the palette only shifts accent tokens (--accent, --accent-hover, etc.)
// and the sidebar-active tint. Base bg/text tokens stay stable so
// switching palettes doesn't reflow the layout or muddy the type contrast.
//
// v2.6.0: three palettes shipped — neon-purple (default, historic Hive
// look), tech-blue, future-pink. Extend by:
//   1) adding a new entry to PALETTES + PALETTE_META
//   2) adding matching CSS overrides in assets/index.css
// No renderer code has to know about the specific hue values — everything
// downstream reads through the semantic CSS vars.

export const PALETTES = ['neon-purple', 'tech-blue', 'future-pink', 'halloween'] as const
export type Palette = (typeof PALETTES)[number]

// v2.9.0: Style is orthogonal to Palette. Accent = the calm shipping look
// (Inter Tight, rounded surfaces, soft borders). Prime = HUD/CRT visual
// language (JetBrains Mono everywhere, hex avatars, glow shadows,
// scanlines). Pink is Accent-only — warm hues fight the Prime vocabulary.
export const STYLES = ['accent', 'prime'] as const
export type Style = (typeof STYLES)[number]

export interface StyleMeta {
  id: Style
  name: string
  tagline: string
  compatiblePalettes: readonly Palette[]
}

export const STYLE_META: Record<Style, StyleMeta> = {
  accent: {
    id: 'accent',
    name: 'Accent',
    tagline: 'Calm, editorial · Inter Tight · rounded surfaces',
    compatiblePalettes: PALETTES,   // all 3
  },
  prime: {
    id: 'prime',
    name: 'Prime',
    tagline: 'HUD / CRT · JetBrains Mono · glow · hex avatars',
    compatiblePalettes: PALETTES,   // all 3 — pink was excluded until v2.25.0
  },
}

export interface PaletteMeta {
  id: Palette
  name: string      // display label
  swatch: string    // representative hex for the settings preview chip
  tagline: string   // one-line explanation shown under the swatch
}

const PALETTE_STORAGE_KEY = 'hive:palette'

/// Read the persisted palette from localStorage; falls back to the default
/// if none saved or the saved value is stale (e.g. an old build shipped a
/// palette id we no longer recognize).
export function loadPalette(now = new Date()): Palette {
  const saved = localStorage.getItem(PALETTE_STORAGE_KEY)
  const p = isPalette(saved) ? saved : 'neon-purple'
  // Out of season the limited skin hands back what the owner had before it.
  if (p === 'halloween' && !isHalloweenSeason(now)) {
    const before = localStorage.getItem(HALLOWEEN_BEFORE_KEY)
    const back = isPalette(before) && before !== 'halloween' ? before : 'neon-purple'
    localStorage.setItem(PALETTE_STORAGE_KEY, back)
    return back
  }
  return p
}

// ── 🎃 Halloween: a limited skin, Oct 24 – Nov 2 ─────────────────────
const HALLOWEEN_BEFORE_KEY = 'hive:palette-before-halloween'

export function isHalloweenSeason(now = new Date()): boolean {
  const m = now.getMonth(), d = now.getDate()
  return (m === 9 && d >= 24) || (m === 10 && d <= 2)
}

/** Palettes the picker offers today (the limited skin only in season). */
export function availablePalettes(now = new Date()): Palette[] {
  return PALETTES.filter(p => p !== 'halloween' || isHalloweenSeason(now))
}

/**
 * Once per season, the first launch in season switches to Halloween and
 * remembers the palette it replaced. After that the owner's choice stands —
 * Settings › Theme palette switches back to anything.
 */
export function halloweenTakeover(current: Palette, now = new Date()): Palette {
  if (!isHalloweenSeason(now)) return current
  const key = `hive:halloween-${now.getFullYear()}`
  if (localStorage.getItem(key)) return current
  localStorage.setItem(key, '1')
  if (current === 'halloween') return current
  localStorage.setItem(HALLOWEEN_BEFORE_KEY, current)
  return 'halloween'
}

/// Persist + apply a palette to the DOM. Removing the attribute for the
/// default palette lets base CSS variables win (no override layer needed).
export function applyPalette(p: Palette): void {
  const root = document.documentElement
  if (p === 'neon-purple') root.removeAttribute('data-palette')
  else root.setAttribute('data-palette', p)
  localStorage.setItem(PALETTE_STORAGE_KEY, p)
}

function isPalette(v: unknown): v is Palette {
  return typeof v === 'string' && (PALETTES as readonly string[]).includes(v)
}

// v2.9.0 · Style persistence + apply (mirrors palette pair).
const STYLE_STORAGE_KEY = 'hive:style'

export function loadStyle(): Style {
  const saved = localStorage.getItem(STYLE_STORAGE_KEY)
  return isStyle(saved) ? saved : 'accent'
}

/**
 * Apply a style to the DOM. If the current palette isn't compatible with
 * the new style, coerce to the style's first compatible palette (which
 * also means writing localStorage so a reload doesn't flap back).
 * Removing the data-style attribute for the default style keeps the
 * un-attributed baseline as pure Accent.
 */
export function applyStyle(s: Style, currentPalette: Palette): Palette {
  const root = document.documentElement
  if (s === 'accent') root.removeAttribute('data-style')
  else root.setAttribute('data-style', s)
  localStorage.setItem(STYLE_STORAGE_KEY, s)

  // Reconcile palette if the style narrowed the compatible set.
  const compat = STYLE_META[s].compatiblePalettes
  if (!compat.includes(currentPalette)) {
    const next = compat[0]
    applyPalette(next)
    return next
  }
  return currentPalette
}

function isStyle(v: unknown): v is Style {
  return typeof v === 'string' && (STYLES as readonly string[]).includes(v)
}

export const PALETTE_META: Record<Palette, PaletteMeta> = {
  'neon-purple': {
    id: 'neon-purple',
    name: 'Neon Purple',
    swatch: '#c4a0ff',
    tagline: 'Signature Hive · calm violet',
  },
  'tech-blue': {
    id: 'tech-blue',
    name: 'Tech Blue',
    swatch: '#38bdf8',
    tagline: 'Cool cyan · terminal / IDE energy',
  },
  'future-pink': {
    id: 'future-pink',
    name: 'Future Pink',
    swatch: '#ff2eaa',
    tagline: 'Neon fuchsia · vaporwave forward',
  },
  halloween: {
    id: 'halloween',
    name: '🎃 Halloween',
    swatch: '#ffb020',
    tagline: 'Limited · gold pumpkin + night violet · ghosts & spiders · until Nov 2',
  },
}
