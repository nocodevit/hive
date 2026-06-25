import { describe, expect, it } from 'vitest'
import {
  OFFICE_FRAME_INTERVAL_MS,
  shouldDrawFrame,
  shouldAnimate
} from '../officeAnimation'

describe('OFFICE_FRAME_INTERVAL_MS', () => {
  it('targets 30fps', () => {
    expect(OFFICE_FRAME_INTERVAL_MS).toBeCloseTo(33.333, 2)
  })
})

describe('shouldDrawFrame (30fps throttle on a ~60fps rAF)', () => {
  it('always draws the first frame (lastDrawn === 0)', () => {
    expect(shouldDrawFrame(0, 0)).toBe(true)
    expect(shouldDrawFrame(5, 0)).toBe(true)
  })

  it('skips the in-between 60fps callback (~16ms since last draw)', () => {
    // a 60fps rAF fires every ~16.7ms; that is < one 30fps interval, so the
    // intermediate callback must NOT redraw.
    expect(shouldDrawFrame(1016.7, 1000)).toBe(false)
  })

  it('draws once a full 30fps interval has elapsed', () => {
    // a hair past one interval (real rAF timestamps are never exactly
    // lastDrawn+interval; asserting the exact float boundary is a flaky trap)
    expect(shouldDrawFrame(1000 + OFFICE_FRAME_INTERVAL_MS + 0.01, 1000)).toBe(true)
    expect(shouldDrawFrame(1040, 1000)).toBe(true) // 40ms > 33.3ms
  })

  it('respects a custom interval', () => {
    expect(shouldDrawFrame(1100, 1000, 200)).toBe(false)
    expect(shouldDrawFrame(1200, 1000, 200)).toBe(true)
  })
})

describe('shouldAnimate (pause when not visible)', () => {
  it('animates only when the tab is visible AND the canvas is on-screen', () => {
    expect(shouldAnimate(false, true)).toBe(true)
  })

  it('pauses when the tab is backgrounded', () => {
    expect(shouldAnimate(true, true)).toBe(false)
  })

  it('pauses when the canvas is off-screen', () => {
    expect(shouldAnimate(false, false)).toBe(false)
  })

  it('pauses when both', () => {
    expect(shouldAnimate(true, false)).toBe(false)
  })
})
