import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * v2.5.3 regression guard: Nancy incident 2026-08-22 showed the user
 * typed 15 escalating "停止" / "/goal clear" / "立刻停止" messages
 * while a Handoff was active. Every one was sent via sendUserMessage
 * → became part of the /goal loop's input, encouraging claude to
 * DOUBLE DOWN on the runaway task instead of stopping it.
 *
 * Root cause: no visible warning that "typing into chat during
 * Handoff feeds the loop". Fix: input placeholder changes to a
 * warning when isHandoffActive so the user learns to press Stop
 * instead of typing.
 */

const CHAT_TSX = readFileSync(
  join(__dirname, '..', 'hive-chat', 'index.tsx'),
  'utf-8'
)

describe('HiveChat input warning during active Handoff (v2.5.3)', () => {
  it('input placeholder switches to a Handoff-active warning when isHandoffActive is true', () => {
    // Match the ternary chain in the textarea placeholder — verifies
    // the warning branch is present between compactInProgress and default.
    expect(CHAT_TSX).toMatch(/isHandoffActive[\s\S]*?Handoff active[\s\S]*?press Stop/)
  })

  it('warning explicitly tells user the message will feed the /goal loop', () => {
    // The exact framing matters — "feed the loop" is the causal
    // insight that users didn't have during the Nancy incident.
    expect(CHAT_TSX).toMatch(/feed the \/goal loop/)
  })

  it('warning tells user WHERE to click Stop (in the banner above)', () => {
    // Without pointing at the banner explicitly, users might not
    // spot the Stop button (only appears while running, easy to miss).
    expect(CHAT_TSX).toMatch(/banner above/)
  })
})
