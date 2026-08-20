import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v2.5.1 regression: user reported "handoff x 因为和 bottom 的箭头重合
 * 了，所以按不到". Root cause: the input-area scroll-to-bottom ↓ button
 * is `position:absolute; right:16; top:-42; width:32` which floats
 * upward 42px into the banner-strip region. Handoff banner's ✕
 * dismiss button lived on the right edge, right under where ↓ hovers,
 * so ↓ intercepted clicks meant for ✕.
 *
 * Fix: runningStripStyle padding-right = 56px (32 arrow width + 16
 * right offset + 8 safe gap) — reserves a strip on the right where
 * the ✕ never sits under ↓. Source-file assertion locks this in so
 * a future style edit can't quietly re-introduce the overlap.
 */

const BANNER_PATH = join(__dirname, '..', 'HandoffBanner.tsx')
const src = readFileSync(BANNER_PATH, 'utf-8')

describe('HandoffBanner ↓ vs ✕ clearance (v2.5.1)', () => {
  it('runningStripStyle reserves ≥48px of right padding to clear the ↓ arrow zone', () => {
    // Scope the search to the runningStripStyle declaration block only.
    // File has many `padding: '...'` declarations for different button
    // styles; we care specifically about the strip container's padding.
    const blockMatch = src.match(/runningStripStyle:\s*CSSProperties\s*=\s*\{[\s\S]*?padding:\s*'([^']+)'/)
    expect(blockMatch, 'runningStripStyle declaration or its padding not found').not.toBeNull()
    const parts = blockMatch![1].trim().split(/\s+/)
    // shorthand: t, r, b, l  OR  t/b, l/r  OR  all
    let rightPx = 0
    if (parts.length === 4) rightPx = parseInt(parts[1], 10)
    else if (parts.length === 2) rightPx = parseInt(parts[1], 10)
    else if (parts.length === 1) rightPx = parseInt(parts[0], 10)
    expect(rightPx, `runningStripStyle right-padding (${rightPx}px) too small — must be ≥48 to clear ↓ button`).toBeGreaterThanOrEqual(48)
  })
})
