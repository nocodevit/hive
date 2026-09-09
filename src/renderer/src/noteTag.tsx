// Saturated Crush-palette colors used as note-tag borders. Each agent's note
// tag picks one deterministically from its id, so the color is stable across
// renders but differs between agents.
export const NOTE_TAG_COLORS = [
  '#EB4268', // Sriracha
  '#00FFB2', // Julep
  '#E8FE96', // Zest
  '#00A4FF', // Malibu
  '#FF60FF', // Dolly
  '#68FFD6', // Bok
  '#6B50FF', // Charple
  '#C259FF', // Violet
  '#EB5DFF', // Mochi
  '#FF84FF'  // Blush
] as const

export function noteTagColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  return NOTE_TAG_COLORS[Math.abs(hash) % NOTE_TAG_COLORS.length]
}

// Ink used on a SOLID note-tag background — Pepper (the darkest Crush surface),
// so the bright saturated fills stay legible. Full hex, no alpha (color contract).
export const NOTE_TAG_SOLID_INK = '#201F26'

/**
 * Inline style for a note tag. Pure so both style modes are unit-testable.
 * - translucent (default): saturated border + colored text over a 12%-alpha
 *   tint of the SAME hue (the original look — an explicit, intentional alpha).
 * - solid: the full-saturation hue as the background with dark Pepper ink — the
 *   contract's "when in doubt, ship at full saturation" path, no alpha.
 */
export function noteTagStyle(color: string, solid?: boolean): { color: string; borderColor: string; background: string } {
  return solid
    ? { color: NOTE_TAG_SOLID_INK, borderColor: color, background: color }
    : { color, borderColor: color, background: `${color}1F` }
}

// Note shown as a tag after the agent name. Color: the caller's chosen `color`
// if set, else derived from the agent id (stable per agent). `solid` swaps the
// translucent tint for a full-saturation fill.
export function NoteTag({ id, note, color, solid }: { id: string; note: string; color?: string; solid?: boolean }) {
  const c = color || noteTagColor(id)
  return (
    <span
      // v2.8.0: symmetric padding (px-2) + explicit overflow rules so the
      // truncated text ellipsis leaves visible padding on BOTH edges. The
      // old `truncate` shorthand + px-1.5 inside a parent that itself had
      // `truncate` was clipping the right border. min-w-0 lets flex parents
      // shrink the tag if they must, before the ellipsis kicks in.
      className="inline-flex items-center px-2 py-px rounded text-[11px] leading-none font-medium flex-shrink min-w-0 max-w-[140px] overflow-hidden whitespace-nowrap border"
      style={noteTagStyle(c, solid)}
      title={note}
    >
      <span className="truncate">{note}</span>
    </span>
  )
}
