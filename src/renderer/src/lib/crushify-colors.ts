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

/**
 * Hue-aware distance between two RGB points. We compare in HSL so muted
 * colors map to their saturated Crush hue cousin (pale purple → Charple,
 * not nearest-by-channel-distance to Malibu blue).
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255
  const max = Math.max(R, G, B), min = Math.min(R, G, B)
  const l = (max + min) / 2
  let h = 0, s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case R: h = ((G - B) / d + (G < B ? 6 : 0)); break
      case G: h = (B - R) / d + 2; break
      case B: h = (R - G) / d + 4; break
    }
    h *= 60
  }
  return [h, s, l]
}

function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  const [h1, s1, l1] = rgbToHsl(a[0], a[1], a[2])
  const [h2, s2, l2] = rgbToHsl(b[0], b[1], b[2])
  const dh = hueDelta(h1, h2) / 180                // 0..1
  const ds = s1 - s2
  const dl = l1 - l2
  // Hue dominates — we want purples to stay purple even when muted.
  return 4 * dh * dh + 0.5 * ds * ds + 0.5 * dl * dl
}

/**
 * Snap every incoming truecolor to the nearest Crush accent — no chroma
 * or lightness filtering. Full saturated Crush palette.
 */
export function crushifyRgb(r: number, g: number, b: number): [number, number, number] {
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
