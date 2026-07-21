import { describe, it, expect } from 'vitest'
import { readdirSync, fstatSync, statSync } from 'node:fs'
import { spawnPty, releasePty, __resetRegistryForTests } from '../ptyRegistry'

/**
 * The regression test that v1.7.152 lacked.
 *
 * That fix relied on node-pty's `destroy()` to release the master fd; it did
 * not, and no test spawned a real pty to check, so a leak shipped and was
 * installed. This spawns real ptys through the registry and asserts the
 * process's open `/dev/ptmx` fd count returns to baseline — the ONLY check
 * that actually exercises the leak. If it ever fails, real fds are leaking.
 */

const PTMX_MAJOR = (() => {
  try {
    return (statSync('/dev/ptmx').rdev >>> 24) & 0xff
  } catch {
    return -1
  }
})()

function ptmxFdCount(): number {
  let n = 0
  for (const entry of readdirSync('/dev/fd')) {
    const fd = Number(entry)
    if (!Number.isInteger(fd)) continue
    try {
      if (((fstatSync(fd).rdev >>> 24) & 0xff) === PTMX_MAJOR) n++
    } catch {
      /* fd raced closed */
    }
  }
  return n
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ConPTY on Windows has no unix fds; /dev/ptmx probing is unix-only.
const runsHere = process.platform !== 'win32' && PTMX_MAJOR >= 0
const maybe = runsHere ? describe : describe.skip

maybe('pty master fd does not leak across spawn/release', () => {
  it('stays flat over many spawn+release cycles', async () => {
    __resetRegistryForTests()
    // Warm up one cycle so any one-time allocation is already counted.
    releasePty(spawnPty('warmup', '/bin/echo', ['x'], {}))
    await sleep(150)

    const baseline = ptmxFdCount()
    const CYCLES = 25
    for (let i = 0; i < CYCLES; i++) {
      const term = spawnPty('leak-test', '/bin/echo', ['x'], {})
      await sleep(10)
      releasePty(term)
      await sleep(10)
    }
    await sleep(500)

    const after = ptmxFdCount()
    // Allow tiny slack for an in-flight teardown, but nothing close to the
    // pre-fix behaviour of +1 per cycle (+25). Pre-fix this was baseline+25.
    expect(after).toBeLessThanOrEqual(baseline + 2)
  }, 20000)
})
