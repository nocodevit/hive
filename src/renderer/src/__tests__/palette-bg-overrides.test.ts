// @vitest-environment jsdom
//
// v2.7.1 regression: palette switcher must shift the WHOLE hue family
// (bg-*, border-*, sidebar-bg) not just --accent. User flagged that
// switching to Tech Blue still showed the purple background because
// only accent tokens were overridden. Parses index.css and asserts
// each non-default palette overrides the load-bearing tokens.
//
// Read only the file — no DOM computedStyle needed. Cheap + deterministic.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const cssPath = resolve(__dirname, '../assets/index.css')
const css = readFileSync(cssPath, 'utf8')

/** Extract the body of the FIRST `[selector] { ... }` rule.
 *  Simple brace-count parser — good enough for our hand-written CSS. */
function ruleBody(selector: string): string {
  const start = css.indexOf(selector + ' {')
  if (start < 0) throw new Error(`selector not found in CSS: ${selector}`)
  let depth = 0
  let i = css.indexOf('{', start)
  const bodyStart = i + 1
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(bodyStart, i) }
  }
  throw new Error(`unterminated rule: ${selector}`)
}

// Tokens that MUST shift with palette for the visual identity to swap
// cleanly. If any is missing, background stays purple → user complaint.
const HUE_TOKENS = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--bg-hover',
  '--border-default',
  '--sidebar-bg', '--sidebar-active',
  '--accent', '--accent-hover',
]

describe('palette overlays (v2.7.1)', () => {
  for (const palette of ['tech-blue', 'future-pink']) {
    describe(`[data-palette='${palette}']`, () => {
      const darkBody = ruleBody(`[data-palette='${palette}']`)
      const lightBody = ruleBody(`[data-palette='${palette}'][data-theme='light']`)

      it('dark variant overrides every hue-carrying token', () => {
        for (const token of HUE_TOKENS) {
          expect(darkBody, `dark ${palette} must set ${token}`).toContain(`${token}:`)
        }
      })

      it('light variant overrides every hue-carrying token', () => {
        for (const token of HUE_TOKENS) {
          expect(lightBody, `light ${palette} must set ${token}`).toContain(`${token}:`)
        }
      })

      it('DOES override --bg-terminal in dark mode (v2.15.0 palette-aware chat bg)', () => {
        // v2.15.0: user explicitly approved deviating from the Crush
        // Pepper lock for the chat surface so Tech Blue / Future Pink
        // extend into the chat pane instead of stopping at a warm-grey
        // border. Other Crush colors used inside chat (Sriracha bubbles,
        // Julep buttons, Squid/Ash text) still ship at locked hexes.
        expect(darkBody, `dark ${palette} must set --bg-terminal`).toContain('--bg-terminal:')
      })

      it('leaves --bg-terminal untouched in light mode (light Pepper is fine as-is)', () => {
        // Light mode base bg-terminal already leans pale; palette light
        // variants inherit and stay legible. No override needed.
        expect(lightBody, `light ${palette} should not override --bg-terminal`).not.toContain('--bg-terminal:')
      })
    })
  }
})
