import { describe, it, expect, vi, beforeEach } from 'vitest'

const spawnMock = vi.fn()
vi.mock('node-pty', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }))

import { spawnPty, releasePty, livePtyHandles, livePtyCount, __resetRegistryForTests } from '../ptyRegistry'

function fakeTerm() {
  return {
    destroy: vi.fn(),
    kill: vi.fn(),
    onExit: vi.fn(),
    _fireExit(this: { onExit: { mock: { calls: [() => void][] } } }) {
      this.onExit.mock.calls[0]?.[0]()
    }
  }
}

beforeEach(() => {
  __resetRegistryForTests()
  spawnMock.mockReset()
})

describe('spawnPty', () => {
  it('forwards to pty.spawn and registers the handle', () => {
    const term = fakeTerm()
    spawnMock.mockReturnValue(term)

    const out = spawnPty('terminal', '/bin/zsh', ['-l'], { cols: 80 } as never, () => 1_000)

    expect(out).toBe(term)
    expect(spawnMock).toHaveBeenCalledWith('/bin/zsh', ['-l'], { cols: 80 })
    expect(livePtyCount()).toBe(1)
    expect(livePtyHandles()[0]).toMatchObject({ label: 'terminal', spawnedAt: 1_000 })
  })

  it('drops the handle when the child exits on its own', () => {
    const term = fakeTerm()
    spawnMock.mockReturnValue(term)
    spawnPty('usage-scrape', 'claude', [], {} as never)
    expect(livePtyCount()).toBe(1)

    term._fireExit()

    expect(livePtyCount()).toBe(0)
  })

  it('still registers when the pty has no onExit (test stubs)', () => {
    spawnMock.mockReturnValue({ kill: vi.fn() })
    expect(() => spawnPty('chat-rc', 'claude', [], {} as never)).not.toThrow()
    expect(livePtyCount()).toBe(1)
  })

  it('tracks concurrent spawns independently', () => {
    spawnMock.mockReturnValueOnce(fakeTerm()).mockReturnValueOnce(fakeTerm())
    spawnPty('terminal', 'a', [], {} as never)
    spawnPty('chat-rc', 'b', [], {} as never)
    expect(livePtyHandles().map(h => h.label)).toEqual(['terminal', 'chat-rc'])
  })
})

describe('releasePty', () => {
  it('destroys the pty — the only call that frees the master fd', () => {
    const term = fakeTerm()
    spawnMock.mockReturnValue(term)
    spawnPty('terminal', '/bin/zsh', ['-l'], {} as never)

    releasePty(term as never)

    expect(term.destroy).toHaveBeenCalledOnce()
    expect(livePtyCount()).toBe(0)
  })

  it('is a no-op for null/undefined', () => {
    expect(() => releasePty(null)).not.toThrow()
    expect(() => releasePty(undefined)).not.toThrow()
  })

  it('is idempotent', () => {
    const term = fakeTerm()
    spawnMock.mockReturnValue(term)
    spawnPty('terminal', 'a', [], {} as never)
    releasePty(term as never)
    releasePty(term as never)
    expect(livePtyCount()).toBe(0)
  })

  it('releases a pty it never registered without corrupting the registry', () => {
    const registered = fakeTerm()
    spawnMock.mockReturnValue(registered)
    spawnPty('terminal', 'a', [], {} as never)

    const stranger = fakeTerm()
    releasePty(stranger as never)

    expect(stranger.destroy).toHaveBeenCalledOnce()
    expect(livePtyCount()).toBe(1)
  })
})
