import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CHAT, CRUSH, FONT_MONO, FONT_PROSE } from './crush-styles'

/**
 * ＋ / 🎙 under the input — the "长按变录音条" micro-interaction
 * (micro-interactions skill, spec 📘6), for both ways of recording:
 *
 *   hold 🎙 ≥ 250 ms → the pair stretches into a recording bar across the row:
 *     ＋ turns 45° into ✕, 🎙 rides to the right end, a red dot pulses, a 0:03
 *     timer runs, a live waveform scrolls in from the right. Slide left past a
 *     third of the bar (or onto ✕) → "Release to cancel". Let go → the words
 *     stay; under 1 s → dropped ("Too short"); 60 s → ends by itself (last 10 s
 *     count down in amber).
 *   tap 🎙 → hands-free dictation, same bar; ■ stops (keeps the words), ✕ or
 *     Esc drops them.
 *
 * Only transform / opacity / clip-path animate (no width); every transition is
 * interruptible. Reduced motion: fades only.
 * App.tsx owns the speech process: `hive:voice-toggle` / `hive:voice-cancel`,
 * and it reports `hive:voice-state` / `hive:voice-level`.
 */

const LONG_MS = 250
const MIN_MS = 1000
const MAX_MS = 60_000
const PAIR_W = 62
const SMOOTH = 'cubic-bezier(0.2, 0.8, 0.2, 1)'   // spring.smooth
const BOUNCY = 'cubic-bezier(0.34, 1.56, 0.64, 1)' // spring.bouncy
const OPEN_MS = 420, CLOSE_MS = 540
const BAR = 3, GAP = 2, SAMPLE_MS = 50
/** dB → 0..1: -60 dB is silence, -15 dB loud speech. */
const levelOf = (db: number) => Math.max(0, Math.min(1, (db + 60) / 45))

type VoiceState = { listening: boolean; partial: string; notice?: string }
type Mode = 'idle' | 'hold' | 'tap'

const CSS = `
@keyframes hvg-dot { 0%, 100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.45); opacity: .55 } }
@keyframes hvg-shake { 0%, 100% { transform: translateX(0) } 20%, 60% { transform: translateX(-4px) } 40%, 80% { transform: translateX(4px) } }
@keyframes hvg-in { from { opacity: 0 } to { opacity: 1 } }
.hvg-dot { animation: hvg-dot 1.1s ease-in-out infinite }
.hvg-shake { animation: hvg-shake 300ms ease-in-out }
@media (prefers-reduced-motion: reduce) {
  .hvg, .hvg * { transition-property: opacity !important; transition-duration: 150ms !important; transition-timing-function: linear !important; animation: none !important }
}
`

const fmt = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

/** `slot`: what must stay in reach while recording (the auto-send countdown) — inside the bar when it is open, next to the pair otherwise. */
export function VoiceGroup({ agentId, onAttach, slot }: { agentId: string; onAttach: (paths: string[]) => void; slot?: React.ReactNode }) {
  const [state, setState] = useState<VoiceState>({ listening: false, partial: '' })
  const [mode, setMode] = useState<Mode>('idle')
  const [open, setOpen] = useState(false)       // bar stretched (drives the transitions)
  const [mounted, setMounted] = useState(false) // bar in the DOM (stays while shrinking back)
  const [arming, setArming] = useState(false)
  const [cancelArmed, setCancelArmed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [flash, setFlash] = useState('')
  const [shake, setShake] = useState(0)
  const [geom, setGeom] = useState({ left: 0, width: 300 })

  const rootRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cancelBtnRef = useRef<HTMLButtonElement>(null)
  const timer = useRef<number | null>(null)
  const modeRef = useRef<Mode>('idle')
  const listeningRef = useRef(false)
  const startedAt = useRef(0)
  const downX = useRef(0)
  const levels = useRef<{ v: number; at: number }[]>([])
  modeRef.current = mode
  listeningRef.current = state.listening

  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<VoiceState>).detail)
    window.addEventListener('hive:voice-state', onState)
    return () => window.removeEventListener('hive:voice-state', onState)
  }, [])

  const toggle = () => window.dispatchEvent(new CustomEvent('hive:voice-toggle', { detail: { agentId } }))
  const say = (t: string) => { setFlash(t); window.setTimeout(() => setFlash(f => (f === t ? '' : f)), 1600) }

  // The bar spans from the pair to the end of the toolbar row.
  const measure = () => {
    const el = rootRef.current
    const row = el?.offsetParent as HTMLElement | null
    if (!el || !row) return
    // Stop short of whatever sits at the row's right end (Send / Stop): those stay in reach.
    const left = el.offsetLeft
    let end = row.clientWidth
    for (const c of Array.from(row.children) as HTMLElement[]) {
      if (c === el || c.contains(el) || c.offsetWidth === 0) continue
      if (c.offsetLeft > left + PAIR_W + 200) end = Math.min(end, c.offsetLeft - 8)
    }
    setGeom({ left, width: Math.max(PAIR_W + 160, end - left) })
  }
  const openBar = (m: Mode) => {
    measure()
    modeRef.current = m
    setMode(m)
    setMounted(true)
    startedAt.current = Date.now()
    levels.current = []
    setElapsed(0)
  }
  // Two frames after mount: start stretching, so it grows from the pair's size.
  useLayoutEffect(() => {
    if (!mounted || mode === 'idle') return
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)))
    return () => cancelAnimationFrame(r)
  }, [mounted, mode])
  const closeBar = () => {
    modeRef.current = 'idle'
    setOpen(false)
    setCancelArmed(false)
    setMode('idle')
    window.setTimeout(() => { if (modeRef.current === 'idle') setMounted(false) }, CLOSE_MS)
  }

  /** End a recording: keep the words, or drop them. */
  const finish = (keep: boolean) => {
    const m = modeRef.current
    if (m === 'idle') return
    const short = Date.now() - startedAt.current < MIN_MS
    if (!keep || (m === 'hold' && short)) {
      window.dispatchEvent(new CustomEvent('hive:voice-cancel'))
      if (keep && short) say('Too short')
    } else if (listeningRef.current) toggle()
    closeBar()
  }

  // Listening ended elsewhere (helper exit, error) → shrink back; started elsewhere → show the bar.
  useEffect(() => {
    if (!state.listening && modeRef.current !== 'idle' && timer.current === null && Date.now() - startedAt.current > 800) closeBar()
    if (state.listening && modeRef.current === 'idle' && timer.current === null) openBar('tap')
  }, [state.listening])
  // An error shakes the pair / bar once (3 × 4 px, 300 ms).
  useEffect(() => {
    if (!state.notice) return
    setShake(n => n + 1)
    // It never started (no mic permission, helper missing): shrink back and show why next to the pair.
    if (!state.listening && modeRef.current !== 'idle') closeBar()
  }, [state.notice])

  // Timer, the 60 s cap (hold), Esc.
  useEffect(() => {
    if (mode === 'idle') return
    const iv = window.setInterval(() => {
      const t = Date.now() - startedAt.current
      setElapsed(t)
      if (modeRef.current === 'hold' && t >= MAX_MS) finish(true)
    }, 200)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(false) }
    window.addEventListener('keydown', onKey)
    return () => { clearInterval(iv); window.removeEventListener('keydown', onKey) }
  }, [mode])

  // Waveform: levels pushed as they come, drawn every frame, scrolling left.
  useEffect(() => {
    if (!mounted) return
    const onLevel = (e: Event) => {
      levels.current.push({ v: levelOf((e as CustomEvent<number>).detail), at: performance.now() })
      if (levels.current.length > 400) levels.current.splice(0, levels.current.length - 400)
    }
    window.addEventListener('hive:voice-level', onLevel)
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = canvasRef.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth, h = c.clientHeight
      if (!w || !h) return
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr) }
      const g = c.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = getComputedStyle(c).color
      const now = performance.now()
      const L = levels.current
      // The newest bar slides in from the right edge over one sample period.
      const last = L.length ? L[L.length - 1].at : now
      const step = BAR + GAP
      const shift = Math.min(1, (now - last) / SAMPLE_MS) * step
      const n = Math.ceil(w / step) + 1
      for (let i = 0; i < n; i++) {
        const s = L[L.length - 1 - i]
        let v = s ? s.v : 0
        // Quiet: a faint breathing line, so it never looks frozen.
        const quiet = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(now / 320 + i * 0.55))
        if (v < quiet) v = quiet
        const bh = Math.max(3, v * h)
        const x = w - (i + 1) * step + step - shift - BAR
        if (x < -BAR) break
        g.globalAlpha = 0.45 + 0.55 * Math.min(1, v * 1.4)
        g.beginPath()
        if (g.roundRect) g.roundRect(x, (h - bh) / 2, BAR, bh, BAR / 2)
        else g.rect(x, (h - bh) / 2, BAR, bh)
        g.fill()
      }
      g.globalAlpha = 1
    }
    raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('hive:voice-level', onLevel) }
  }, [mounted])

  const overCancel = (x: number) => { const r = cancelBtnRef.current?.getBoundingClientRect(); return !!r && x <= r.right + 6 }
  const cancelZone = (x: number) => downX.current - x > (geom.width - PAIR_W) / 3 || overCancel(x)

  // Pointer: a long press opens the hold bar; a short tap turns hands-free on.
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    downX.current = e.clientX
    if (modeRef.current === 'tap') return
    setArming(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setArming(false)
      openBar('hold')
      if (!listeningRef.current) toggle()
    }, LONG_MS)
  }
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (modeRef.current === 'tap') { finish(true); return }
    if (timer.current !== null) {
      clearTimeout(timer.current); timer.current = null; setArming(false)
      openBar('tap')
      if (!listeningRef.current) toggle()
      return
    }
    if (modeRef.current === 'hold') finish(!cancelZone(e.clientX))
  }
  const move = (e: React.PointerEvent<HTMLButtonElement>) => { if (modeRef.current === 'hold') setCancelArmed(cancelZone(e.clientX)) }
  const pointerCancel = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; setArming(false) }
    if (modeRef.current === 'hold') finish(false)
  }

  const attach = async () => {
    const paths = await window.api.dialog.selectFiles().catch(() => [] as string[])
    if (paths.length) onAttach(paths)
  }

  const recording = mode !== 'idle'
  const remaining = MAX_MS - elapsed
  const ending = mode === 'hold' && remaining <= 10_000
  const red = cancelArmed
  const travel = geom.width - PAIR_W
  const clip = open ? 'inset(0 0 0 0 round 999px)' : `inset(0 ${travel}px 0 0 round 999px)`
  const hint = red ? 'Release to cancel' : mode === 'hold' ? '← slide to cancel · Release to finish' : 'Tap ■ to stop · Esc cancels'
  const ms = open ? OPEN_MS : CLOSE_MS
  const ease = open ? SMOOTH : BOUNCY

  const btn: React.CSSProperties = {
    flexShrink: 0, width: 30, height: 26, border: 'none', borderRadius: 999, background: 'transparent',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    fontFamily: FONT_PROSE, fontSize: 13, color: CHAT.muted, padding: 0, touchAction: 'none', userSelect: 'none'
  }
  const micHandlers = {
    onPointerDown: down, onPointerUp: up, onPointerMove: move, onPointerCancel: pointerCancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      if (modeRef.current === 'idle') { openBar('tap'); if (!listeningRef.current) toggle() } else finish(true)
    }
  }

  return (
    <span ref={rootRef} className="hvg" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <style>{CSS}</style>
      <span role="group" aria-label="Attach and voice" key={`pair-${shake}`} className={shake && !mounted ? 'hvg-shake' : ''}
        style={{ display: 'inline-flex', alignItems: 'center', height: 28, width: PAIR_W, padding: 1, borderRadius: 999, background: CHAT.surface2, opacity: mounted ? 0 : 1, transition: 'opacity 120ms' }}>
        <button onClick={attach} aria-label="Attach files" title="Attach files" tabIndex={mounted ? -1 : 0} style={{ ...btn, fontSize: 17 }}>＋</button>
        {/* Stays mounted under the bar while you hold it: it owns the captured pointer, so the release still arrives here. */}
        <button {...micHandlers} aria-label="Voice input" aria-hidden={mounted || undefined} tabIndex={mounted ? -1 : 0} title="Voice input · tap for hands-free, hold to talk"
          style={{ ...btn, background: arming ? 'color-mix(in srgb, var(--chat-accent) 30%, transparent)' : 'transparent',
            transform: arming ? 'scale(0.86)' : 'scale(1)', transition: arming ? `transform ${LONG_MS}ms linear, background ${LONG_MS}ms linear` : `transform 160ms ${SMOOTH}` }}>🎙</button>
      </span>

      {mounted && (
        <span role="group" aria-label={recording ? 'Recording' : 'Recording ended'} key={`bar-${shake}`} className={shake ? 'hvg-shake' : ''}
          style={{
            position: 'absolute', left: geom.left, top: '50%', marginTop: -14, height: 28, width: geom.width, zIndex: 5,
            borderRadius: 999, clipPath: clip,
            background: 'color-mix(in srgb, var(--chat-accent) 14%, var(--chat-bg))',
            boxShadow: `inset 0 0 0 1px ${red ? CRUSH.Sriracha : 'color-mix(in srgb, var(--chat-accent) 55%, transparent)'}`,
            transition: `clip-path ${ms}ms ${ease}, box-shadow 150ms`
          }}>
          <button ref={cancelBtnRef} onClick={() => finish(false)} aria-label="Cancel recording" title="Drop what was said"
            style={{ ...btn, position: 'absolute', left: 1, top: 1, fontSize: 17, color: red ? '#FFFFFF' : CRUSH.Sriracha, background: red ? CRUSH.Sriracha : 'transparent',
              transform: `scale(${red ? 1.15 : 1})`, transition: `transform 250ms ${SMOOTH}, background 150ms, color 150ms` }}>
            <span aria-hidden style={{ display: 'inline-block', lineHeight: 1, transform: `rotate(${open ? 45 : 0}deg)`, transition: `transform ${ms}ms ${ease}` }}>＋</span>
          </button>
          <span style={{ position: 'absolute', left: 38, right: 38, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 8,
            opacity: open ? 1 : 0, transition: open ? `opacity 150ms ease-out ${Math.round(OPEN_MS * 0.4)}ms` : 'opacity 120ms ease-in' }}>
            <i className="hvg-dot" aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: CRUSH.Sriracha, flexShrink: 0 }} />
            <span aria-label="Recording time" style={{ fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums', fontSize: 11.5, color: ending ? CRUSH.Zest : CHAT.ink2, flexShrink: 0 }}>
              {ending ? fmt(remaining) : fmt(elapsed)}
            </span>
            <canvas ref={canvasRef} role="img" aria-label="Live waveform" style={{ flex: 1, minWidth: 0, height: 20, color: red ? CRUSH.Sriracha : CHAT.accent }} />
            {slot && <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{slot}</span>}
            {state.notice
              ? <span role="status" title={state.notice} style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: FONT_PROSE, fontSize: 11, color: CRUSH.Sriracha, whiteSpace: 'nowrap' }}>⚠ {state.notice}</span>
              : <span aria-live="polite" style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: FONT_PROSE, fontSize: 11, color: red ? CRUSH.Sriracha : CHAT.muted, whiteSpace: 'nowrap' }}>{hint}</span>}
          </span>
          <button {...micHandlers} aria-label={mode === 'hold' ? 'Release to finish' : 'Stop listening'} title={hint}
            style={{ ...btn, position: 'absolute', right: 1, top: 1, color: '#FFFFFF', background: red ? 'transparent' : CRUSH.Sriracha,
              transform: `translateX(${open ? 0 : -travel}px)`, transition: `transform ${ms}ms ${ease}, background 150ms` }}>
            {mode === 'tap' ? '■' : '🎙'}
          </button>
        </span>
      )}

      {slot && !mounted && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{slot}</span>}
      {flash && !mounted && <span role="status" style={{ fontFamily: FONT_PROSE, fontSize: 11.5, color: CRUSH.Zest, animation: 'hvg-in 150ms ease-out' }}>{flash}</span>}
      {state.notice && !mounted && (
        <span role="status" title={state.notice} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: FONT_PROSE, fontSize: 11.5, color: CRUSH.Sriracha, animation: 'hvg-in 150ms ease-out' }}>⚠ {state.notice}</span>
      )}
    </span>
  )
}
