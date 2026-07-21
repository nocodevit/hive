import { describe, it, expect, vi } from 'vitest'
import {
  ownPtmxFds,
  reclaimNewOrphans,
  reclaimOrphanPtyFds,
  snapshotPtmxFds,
  FdReclaimDeps
} from '../ptyFdReclaim'

const mk = (major: number, minor: number) => (major << 24) | minor
const PTMX = mk(15, 511)

function deps(over: Partial<FdReclaimDeps> = {}): FdReclaimDeps {
  return {
    ptmxRdev: () => PTMX,
    listFds: () => ['0', '1', '2', '14', '15'],
    // 14 and 15 are ptmx (major 15); others are not.
    fstatRdev: (fd) => (fd === 14 || fd === 15 ? mk(15, fd) : mk(2, fd)),
    close: vi.fn(),
    ...over
  }
}

describe('ownPtmxFds', () => {
  it('returns only fds whose device major matches /dev/ptmx', () => {
    expect(ownPtmxFds(deps())).toEqual([14, 15])
  })

  it('ignores fds that raced closed', () => {
    expect(ownPtmxFds(deps({ fstatRdev: () => null }))).toEqual([])
  })

  it('ignores non-numeric /dev/fd entries', () => {
    expect(ownPtmxFds(deps({ listFds: () => ['.', '..', 'x', '15'] }))).toEqual([15])
  })

  it('returns [] — never throws — when the platform cannot be probed', () => {
    expect(ownPtmxFds(deps({ ptmxRdev: () => { throw new Error('ENOENT') } }))).toEqual([])
    expect(ownPtmxFds(deps({ listFds: () => { throw new Error('ENOENT') } }))).toEqual([])
  })
})

describe('reclaimNewOrphans', () => {
  it('closes the new ptmx fd that is not the pty _fd (the leaked dup)', () => {
    const close = vi.fn()
    // Before spawn only fd 3 (non-ptmx) was around; spawn added 14 and 15.
    // _fd is 15 (node-pty owns it); 14 is the orphan dup to reclaim.
    const closed = reclaimNewOrphans([], 15, deps({ close }))
    expect(closed).toEqual([14])
    expect(close).toHaveBeenCalledExactlyOnceWith(14)
  })

  it('never closes the pty _fd itself', () => {
    const close = vi.fn()
    reclaimNewOrphans([], 15, deps({ close }))
    expect(close).not.toHaveBeenCalledWith(15)
  })

  it('never closes an fd that already existed before the spawn', () => {
    const close = vi.fn()
    // 14 was already open before this spawn — belongs to another pty.
    const closed = reclaimNewOrphans([14], 15, deps({ close }))
    expect(closed).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('closes multiple orphans if node-pty ever leaks more than one', () => {
    const close = vi.fn()
    const d = deps({
      listFds: () => ['13', '14', '15'],
      fstatRdev: (fd) => mk(15, fd) // all three are ptmx
    })
    const closed = reclaimNewOrphans([], 15, d)
    expect(closed.sort()).toEqual([13, 14])
    expect(close).not.toHaveBeenCalledWith(15)
  })

  it('closes nothing when the spawn added no new ptmx fd', () => {
    const close = vi.fn()
    const closed = reclaimNewOrphans([14, 15], 15, deps({ close }))
    expect(closed).toEqual([])
    expect(close).not.toHaveBeenCalled()
  })

  it('reclaims even when _fd is undefined (defensive: close all new orphans)', () => {
    const close = vi.fn()
    const closed = reclaimNewOrphans([], undefined, deps({ close }))
    expect(closed.sort()).toEqual([14, 15])
  })
})

describe('snapshotPtmxFds / reclaimOrphanPtyFds wrappers', () => {
  it('snapshotPtmxFds delegates to ownPtmxFds with the given deps', () => {
    expect(snapshotPtmxFds(deps())).toEqual([14, 15])
  })

  it('reclaimOrphanPtyFds closes the new orphan on a unix platform', () => {
    if (process.platform === 'win32') return
    const close = vi.fn()
    const closed = reclaimOrphanPtyFds([], 15, deps({ close }))
    expect(closed).toEqual([14])
    expect(close).toHaveBeenCalledExactlyOnceWith(14)
  })
})
