/**
 * Claude Code emits 24-bit truecolor SGR sequences (`\x1b[38;2;R;G;Bm`)
 * that bypass xterm's 16-color palette — so our Crush theme has no effect
 * on them. This module rewrites those RGB values to the closest saturated
 * entry in the Crush palette, producing a consistently Crush-flavored
 * look regardless of what pale grays Claude picks.
 *
 * Grayscale values (low chroma) are left alone so neutrals and dimmed text
 * don't get surprise hue shifts.
 */

export const CRUSH_ACCENTS: Array<{ rgb: [number, number, number]; name: string }> = [
  { rgb: [235, 66, 104], name: 'Sriracha' },   // red
  { rgb: [0, 255, 178], name: 'Julep' },        // green
  { rgb: [232, 254, 150], name: 'Zest' },       // yellow
  { rgb: [0, 164, 255], name: 'Malibu' },       // blue
  { rgb: [255, 96, 255], name: 'Dolly' },       // magenta
  { rgb: [104, 255, 214], name: 'Bok' },        // cyan
  { rgb: [107, 80, 255], name: 'Charple' },     // indigo
  { rgb: [194, 89, 255], name: 'Violet' },      // bright purple
  { rgb: [235, 93, 255], name: 'Mochi' },       // lilac
  { rgb: [255, 132, 255], name: 'Blush' },      // soft pink
  { rgb: [255, 87, 125], name: 'Bright-Red' },
  { rgb: [79, 190, 254], name: 'Bright-Blue' },
  { rgb: [255, 250, 241], name: 'Bright-White' }
]

const RGB_SGR_RE = /\x1b\[38;2;(\d+);(\d+);(\d+)m/g
const RGB_BG_SGR_RE = /\x1b\[48;2;(\d+);(\d+);(\d+)m/g

function chroma(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function lightness(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255
}

/** Perceptual-ish distance (weighted Euclidean) between two RGB points. */
function dist(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]
  // Human eye is most sensitive to green.
  return 0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db
}

/**
 * Snap an incoming truecolor to the nearest Crush accent. Returns the
 * original color unchanged if it's near-grayscale (low chroma) or very
 * dark/very light — those are usually dim text, separators, or frames
 * that should not be recolored.
 */
export function crushifyRgb(r: number, g: number, b: number): [number, number, number] {
  const c = chroma(r, g, b)
  const l = lightness(r, g, b)
  if (c < 0.22) return [r, g, b]       // grays / near-grays unchanged
  if (l < 0.12) return [r, g, b]       // near-black unchanged
  let best = CRUSH_ACCENTS[0].rgb
  let bestD = dist([r, g, b], best)
  for (let i = 1; i < CRUSH_ACCENTS.length; i++) {
    const d = dist([r, g, b], CRUSH_ACCENTS[i].rgb)
    if (d < bestD) { bestD = d; best = CRUSH_ACCENTS[i].rgb }
  }
  return best
}

/** Rewrite every truecolor SGR sequence in `data` to its Crush equivalent. */
export function crushifyColors(data: string): string {
  if (!data.includes('\x1b[')) return data
  return data
    .replace(RGB_SGR_RE, (_, r, g, b) => {
      const [R, G, B] = crushifyRgb(+r, +g, +b)
      return `\x1b[38;2;${R};${G};${B}m`
    })
    .replace(RGB_BG_SGR_RE, (_, r, g, b) => {
      const [R, G, B] = crushifyRgb(+r, +g, +b)
      return `\x1b[48;2;${R};${G};${B}m`
    })
}
