import { describe, it, expect, vi } from 'vitest'
import { disposePty } from '../ptyDispose'

type FakePty = { destroy?: () => void; kill: () => void }

const asPty = (t: FakePty) => t as unknown as Parameters<typeof disposePty>[0]

describe('disposePty', () => {
  it('calls destroy() — the only path that closes the master fd', () => {
    const destroy = vi.fn()
    const kill = vi.fn()
    disposePty(asPty({ destroy, kill }))
    expect(destroy).toHaveBeenCalledOnce()
    expect(kill).not.toHaveBeenCalled()
  })

  it('falls back to kill() when destroy() is absent', () => {
    const kill = vi.fn()
    disposePty(asPty({ kill }))
    expect(kill).toHaveBeenCalledOnce()
  })

  it('falls back to kill() when destroy() throws', () => {
    const destroy = vi.fn(() => { throw new Error('EBADF') })
    const kill = vi.fn()
    disposePty(asPty({ destroy, kill }))
    expect(destroy).toHaveBeenCalledOnce()
    expect(kill).toHaveBeenCalledOnce()
  })

  it('swallows a throwing kill() so teardown never aborts', () => {
    const kill = vi.fn(() => { throw new Error('ESRCH') })
    expect(() => disposePty(asPty({ kill }))).not.toThrow()
  })

  it('is a no-op for null/undefined', () => {
    expect(() => disposePty(null)).not.toThrow()
    expect(() => disposePty(undefined)).not.toThrow()
  })
})
