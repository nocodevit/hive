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

      it('does NOT override --bg-terminal (v2.15.1 — Crush Pepper lock restored)', () => {
        // v2.15.0 briefly tinted chat bg per palette. User rejected:
        // pink chat bg + pink agent column bg went muddy and no longer
        // matched. Restored to Crush Pepper #201F26 across every palette
        // so agent column (which stays neutral dark grey) and chat pane
        // match perfectly. Only accents / borders carry the hue.
        expect(darkBody).not.toContain('--bg-terminal:')
        expect(lightBody).not.toContain('--bg-terminal:')
      })
    })
  }
})
