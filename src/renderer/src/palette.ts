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

export const PALETTES = ['neon-purple', 'tech-blue', 'future-pink'] as const
export type Palette = (typeof PALETTES)[number]

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
export function loadPalette(): Palette {
  const saved = localStorage.getItem(PALETTE_STORAGE_KEY)
  return isPalette(saved) ? saved : 'neon-purple'
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
    swatch: '#f472b6',
    tagline: 'Hot magenta · vaporwave forward',
  },
}
