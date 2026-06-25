/**
 * Pure helpers for the OfficeView canvas animation loop. Kept DOM-free so the
 * throttle + visibility gating logic is unit-testable (the canvas drawing and
 * IntersectionObserver wiring itself is GUI / UNTESTABLE).
 *
 * Why this exists: OfficeView ran an unthrottled `requestAnimationFrame` loop
 * that redrew the whole canvas ~60fps forever — even when the Office tab was
 * not visible — allocating a fresh `agents.filter().sort()` every frame. The
 * renderer process's CPU/GC crept up the longer Hive stayed open. These helpers
 * drive a 30fps cap and a pause-when-hidden gate.
 */

/** Target frame interval (~30fps). The office animations (steam, blink, idle
 * wander) are slow and subtle, so 30fps looks identical to 60fps while halving
 * the main-thread repaint + allocation cost. */
export const OFFICE_FRAME_INTERVAL_MS = 1000 / 30

/**
 * rAF fires at the display's full refresh rate (~60fps). Return true only when
 * at least one target interval has elapsed since the last *drawn* frame, so the
 * caller can skip the heavy redraw on the in-between callbacks.
 *
 * `lastDrawn === 0` (never drawn) always draws.
 */
export function shouldDrawFrame(
  now: number,
  lastDrawn: number,
  intervalMs: number = OFFICE_FRAME_INTERVAL_MS
): boolean {
  if (lastDrawn === 0) return true
  return now - lastDrawn >= intervalMs
}

/**
 * Whether the animation loop should be running at all. Pauses when the browser
 * tab is backgrounded (`document.hidden`) OR the canvas is scrolled / toggled
 * off-screen (not intersecting), so a parked Office tab stops burning CPU.
 */
export function shouldAnimate(documentHidden: boolean, canvasVisible: boolean): boolean {
  return !documentHidden && canvasVisible
}
