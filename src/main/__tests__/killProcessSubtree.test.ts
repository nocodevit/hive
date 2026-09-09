import { describe, it, expect, vi } from 'vitest'
import { killProcessSubtree } from '../killProcessSubtree'

// A process tree: root 100 → 200 (tsc) → 300 (esbuild); 400 is an unrelated
// tree that must NOT be touched (proves pid-scoping, not a global pgrep).
const PS = [
  '  100     1 claude --print',
  '  200   100 node tsc',
  '  300   200 node esbuild',
  '  400     1 some unrelated process'
].join('\n')

describe('killProcessSubtree', () => {
  it('SIGTERMs the whole descendant subtree (not just the root), then SIGKILLs survivors', () => {
    const killed: Array<[number, string]> = []
    let escalate: (() => void) | null = null
    const killRoot = vi.fn()

    killProcessSubtree(100, killRoot, 2000, {
      snapshotPs: () => PS,
      kill: (pid, sig) => killed.push([pid, sig]),
      schedule: (fn) => { escalate = fn; return { unref() {} } }
    })

    // Root is signalled ONLY via the caller-supplied killRoot (node-pty destroy
    // / ChildProcess.kill), never double-signalled through kill().
    expect(killRoot).toHaveBeenCalledTimes(1)
    // Both descendants get SIGTERM; the unrelated tree (400) and the root (100)
    // are left alone.
    expect(killed).toEqual([[200, 'SIGTERM'], [300, 'SIGTERM']])

    // Escalation pass SIGKILLs whatever ignored SIGTERM.
    expect(escalate).toBeTypeOf('function')
    escalate!()
    expect(killed).toContainEqual([200, 'SIGKILL'])
    expect(killed).toContainEqual([300, 'SIGKILL'])
    expect(killed).not.toContainEqual([400, 'SIGKILL'])
  })

  it('still signals the root and schedules nothing when ps fails', () => {
    const killRoot = vi.fn()
    const kill = vi.fn()
    const schedule = vi.fn(() => ({ unref() {} }))

    killProcessSubtree(100, killRoot, 2000, {
      snapshotPs: () => { throw new Error('ps blew up') },
      kill,
      schedule
    })

    expect(killRoot).toHaveBeenCalledTimes(1)
    expect(kill).not.toHaveBeenCalled()
    expect(schedule).not.toHaveBeenCalled()
  })

  it('skips the descendant walk when rootPid is undefined but still runs killRoot', () => {
    const killRoot = vi.fn()
    const kill = vi.fn()

    killProcessSubtree(undefined, killRoot, 2000, {
      snapshotPs: () => PS,
      kill,
      schedule: (fn) => ({ unref() {} })
    })

    expect(killRoot).toHaveBeenCalledTimes(1)
    expect(kill).not.toHaveBeenCalled()
  })
})
