// Watchdog tests for runCompactViaPrint's chat:compactStuck signal
// (v1.7.117 — Pink-1050s loading-UX fix).
//
// The full runCompactViaPrint spawns `claude` which we can't (and shouldn't)
// invoke from a unit test. We export the pure `isCompactStuck` predicate
// + the threshold constants so the trigger contract is testable directly.

import { describe, it, expect } from 'vitest'
import {
  isCompactStuck,
  COMPACT_STUCK_ELAPSED_MS,
  COMPACT_STUCK_IDLE_MS
} from '../chat'

describe('isCompactStuck (chat:compactStuck watchdog)', () => {
  it('exports the 5 min / 60 s thresholds', () => {
    // If these regress to lower values the user could see spurious
    // Cancel prompts during a perfectly normal /compact on a big
    // session. If they regress higher we re-introduce Pink-1050s.
    expect(COMPACT_STUCK_ELAPSED_MS).toBe(300_000)
    expect(COMPACT_STUCK_IDLE_MS).toBe(60_000)
  })

  it('does NOT fire before 5 min elapsed', () => {
    // 4 min in, 90s of silence: still under elapsed threshold → no signal.
    expect(isCompactStuck(240_000, 90_000)).toBe(false)
  })

  it('does NOT fire if claude is still emitting output', () => {
    // 8 min in but bytes 30s ago: claude is alive, don't panic.
    expect(isCompactStuck(480_000, 30_000)).toBe(false)
  })

  it('does NOT fire on boundary (exactly 5 min, exactly 60s silent)', () => {
    // The check is strict `>`, not `>=`, so a /compact that takes
    // exactly 5min is OK provided we just got a byte.
    expect(isCompactStuck(300_000, 60_000)).toBe(false)
  })

  it('FIRES when elapsed > 5 min AND silent > 60 s', () => {
    // 6 min in, 90 s of silence — Pink's exact wedge.
    expect(isCompactStuck(360_000, 90_000)).toBe(true)
  })

  it('FIRES at extreme stuck case (Pink-1050s scenario)', () => {
    // 1050 s in, no output for 800 s — what actually shipped.
    expect(isCompactStuck(1_050_000, 800_000)).toBe(true)
  })
})
