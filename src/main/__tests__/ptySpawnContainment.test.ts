import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Structural guard, not a behaviour test.
 *
 * The pty fd leak recurred because three call sites each hand-rolled spawn +
 * teardown, so a fix to one left the others silently broken. ptyRegistry.ts is
 * now the single owner. This test fails the build the moment a fourth call
 * site appears, which is the only mechanism that doesn't depend on the next
 * author knowing the history.
 */

const MAIN_DIR = join(__dirname, '..')
const ALLOWED = new Set(['ptyRegistry.ts'])

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      sourceFiles(full, acc)
    } else if (entry.endsWith('.ts')) {
      acc.push(full)
    }
  }
  return acc
}

/** Strip line and block comments so prose about `pty.spawn(` doesn't trip us. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('pty spawn containment', () => {
  it('only ptyRegistry.ts calls pty.spawn()', () => {
    const offenders = sourceFiles(MAIN_DIR)
      .filter(f => !ALLOWED.has(relative(MAIN_DIR, f)))
      .filter(f => /\bpty\s*\.\s*spawn\s*\(/.test(stripComments(readFileSync(f, 'utf8'))))
      .map(f => relative(MAIN_DIR, f))

    expect(
      offenders,
      `These files call pty.spawn() directly. Use spawnPty()/releasePty() from ` +
        `ptyRegistry.ts instead — a raw spawn torn down with kill() leaks its ` +
        `master fd and exhausts kern.tty.ptmx_max after days of uptime.`
    ).toEqual([])
  })

  it('no file outside ptyRegistry tears a pty down with a bare kill()', () => {
    const src = stripComments(readFileSync(join(MAIN_DIR, 'chat.ts'), 'utf8'))
    // session.child is a ChildProcess (kill() is correct there); rcPty is a
    // pty and must go through releasePty().
    expect(src).not.toMatch(/rcPty\s*\??\.\s*kill\s*\(/)
  })

  it('the guard actually detects a violation', () => {
    expect(/\bpty\s*\.\s*spawn\s*\(/.test(stripComments('const t = pty.spawn(sh, [])'))).toBe(true)
    expect(/\bpty\s*\.\s*spawn\s*\(/.test(stripComments('// we used to call pty.spawn(x)'))).toBe(false)
  })
})
