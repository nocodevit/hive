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
