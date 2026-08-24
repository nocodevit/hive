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

// Note shown as a tag after the agent name: translucent light fill + saturated
// border, color derived from the agent id so tags differ between agents.
export function NoteTag({ id, note }: { id: string; note: string }) {
  const color = noteTagColor(id)
  return (
    <span
      // v2.8.0: symmetric padding (px-2) + explicit overflow rules so the
      // truncated text ellipsis leaves visible padding on BOTH edges. The
      // old `truncate` shorthand + px-1.5 inside a parent that itself had
      // `truncate` was clipping the right border. min-w-0 lets flex parents
      // shrink the tag if they must, before the ellipsis kicks in.
      className="inline-flex items-center px-2 py-px rounded text-[11px] leading-none font-medium flex-shrink min-w-0 max-w-[140px] overflow-hidden whitespace-nowrap border"
      style={{ color, borderColor: color, background: `${color}1F` }}
      title={note}
    >
      <span className="truncate">{note}</span>
    </span>
  )
}
