import { describe, expect, it, vi } from 'vitest'
import { createFrameCoalescer, type FrameScheduler } from '../streamCoalescer'

// A controllable fake rAF: raf() queues a callback and returns an
// incrementing handle; flushFrame() runs the single queued callback (mimics
// the browser firing one frame); caf() cancels by handle.
function makeFakeScheduler() {
  let nextHandle = 1
  const queued = new Map<number, () => void>()
  const sched: FrameScheduler = {
    raf: (cb) => {
      const h = nextHandle++
      queued.set(h, cb)
      return h
    },
    caf: (h) => {
      queued.delete(h)
    }
  }
  return {
    sched,
    /** Fire every callback currently queued (one frame tick). */
    flushFrame() {
      const cbs = [...queued.values()]
      queued.clear()
      cbs.forEach((cb) => cb())
    },
    pendingFrames: () => queued.size
  }
}

describe('createFrameCoalescer', () => {
  it('batches many schedule() calls in one frame into a SINGLE flush', () => {
    const { sched, flushFrame, pendingFrames } = makeFakeScheduler()
    const c = createFrameCoalescer(sched)
    const flush = vi.fn()

    // 100 streaming deltas land before the frame fires...
    for (let i = 0; i < 100; i++) c.schedule(flush)
    // ...but only one rAF is outstanding, and nothing has flushed yet.
    expect(pendingFrames()).toBe(1)
    expect(flush).not.toHaveBeenCalled()

    flushFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('runs the most recently scheduled flush (latest state wins)', () => {
    const { sched, flushFrame } = makeFakeScheduler()
    const c = createFrameCoalescer(sched)
    const first = vi.fn()
    const second = vi.fn()

    c.schedule(first)
    c.schedule(second) // supersedes `first` within the same frame
    flushFrame()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('schedules a fresh frame after the previous one flushed', () => {
    const { sched, flushFrame } = makeFakeScheduler()
    const c = createFrameCoalescer(sched)
    const flush = vi.fn()

    c.schedule(flush)
    flushFrame()
    c.schedule(flush) // new burst → new frame
    flushFrame()

    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('flushNow() runs the pending flush synchronously and cancels the queued frame', () => {
    const { sched, flushFrame, pendingFrames } = makeFakeScheduler()
    const c = createFrameCoalescer(sched)
    const flush = vi.fn()

    c.schedule(flush)
    expect(pendingFrames()).toBe(1)

    c.flushNow()
    expect(flush).toHaveBeenCalledTimes(1)
    expect(pendingFrames()).toBe(0) // queued frame was cancelled

    // The later frame tick must NOT double-flush.
    flushFrame()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('flushNow() with nothing pending is a no-op (no throw, no call)', () => {
    const { sched } = makeFakeScheduler()
    const c = createFrameCoalescer(sched)
    expect(() => c.flushNow()).not.toThrow()
  })

  it('cancel() drops the pending flush without running it', () => {
    const { sched, flushFrame } = makeFakeScheduler()
    const c = createFrameCoalescer(sched)
    const flush = vi.fn()

    c.schedule(flush)
    c.cancel()
    flushFrame()

    expect(flush).not.toHaveBeenCalled()
  })

  it('after cancel(), scheduling works again', () => {
    const { sched, flushFrame } = makeFakeScheduler()
    const c = createFrameCoalescer(sched)
    const flush = vi.fn()

    c.schedule(flush)
    c.cancel()
    c.schedule(flush)
    flushFrame()

    expect(flush).toHaveBeenCalledTimes(1)
  })
})
