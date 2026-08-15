import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// v2.0.0: the Term/Chat toggle inside Terminal.tsx is gone; the outer tab
// label reads "Chat" instead of "Terminal". These are source-file assertions
// (Terminal.tsx wires xterm/PTY refs that don't run cleanly in jsdom, and
// App.tsx is a 3000-line surface that isn't cheaply mountable in isolation),
// so we lock the removed strings + renamed label at the file level. If a
// future refactor re-introduces the toggle or renames the tab back, these
// blow up loudly rather than the change slipping in unreviewed.

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..')
const TERMINAL_TSX = join(REPO_ROOT, 'src', 'renderer', 'src', 'components', 'Terminal.tsx')
const APP_TSX = join(REPO_ROOT, 'src', 'renderer', 'src', 'App.tsx')

describe('v2.0.0 chat-only surface', () => {
  it('Terminal.tsx no longer renders the Term/Chat toggle buttons', () => {
    const src = readFileSync(TERMINAL_TSX, 'utf-8')
    expect(src).not.toMatch(/>Term</)
    expect(src).not.toMatch(/setChatMode\(true\)/)
    expect(src).not.toMatch(/setChatMode\(false\)/)
  })

  it('Terminal.tsx pins chatMode to the constant `true` (no state, no setter)', () => {
    const src = readFileSync(TERMINAL_TSX, 'utf-8')
    expect(src).toMatch(/const\s+chatMode\s*=\s*true/)
    expect(src).not.toMatch(/useState\([^)]*\)\s*\/\/\s*Chat is the default/)
  })

  it('App.tsx main-view tab reads "Chat" (was "Terminal" in v1.x)', () => {
    const src = readFileSync(APP_TSX, 'utf-8')
    // Match the button element whose onClick sets mainView='terminal' and
    // pull out its inner text. This survives arbitrary formatting/className
    // churn — we only care about the visible label.
    const buttonPattern = /onClick=\{\(\)\s*=>\s*setMainView\('terminal'\)\}[\s\S]*?>\s*([^<\s]+)\s*</
    const match = src.match(buttonPattern)
    expect(match, 'no button with onClick=setMainView("terminal") found in App.tsx').not.toBeNull()
    expect(match![1]).toBe('Chat')
  })
})
