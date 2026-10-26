import { useEffect, useRef, useState } from 'react'
import { CHAT, CRUSH, FONT_PROSE, accentTint } from './crush-styles'

const HOLD_MS = 300
const MORPH_MS = 220
const EASE = 'cubic-bezier(.2,.8,.2,1)'
/** Quiet bars breathe so a silent room doesn't look frozen; reduced motion turns every animation here off. */
const CSS = `
@keyframes hive-vg-breathe { 0%, 100% { transform: scaleY(1) } 50% { transform: scaleY(2.2) } }
.hive-vg-bar.quiet { animation: hive-vg-breathe 1.4s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .hive-vg, .hive-vg * { transition: none !important; animation: none !important } }
`
const BARS = 36
/** dB → 0..1 bar height: -60 dB is silence, -15 dB is loud speech. */
const levelOf = (db: number) => Math.max(0, Math.min(1, (db + 60) / 45))

type VoiceState = { listening: boolean; partial: string; notice?: string }

/**
 * ＋ / 🎙 button pair under the input. Tap 🎙 = hands-free on/off (as before).
 * Hold 🎙 = the pair stretches into a recording bar with a live waveform and ＋
 * turns into ✕; let go = the words land in the input, let go on ✕ (or Esc) = dropped.
 * App.tsx owns the speech process: `hive:voice-toggle`, `hive:voice-cancel`,
 * and it reports `hive:voice-state` / `hive:voice-level`.
 */
export function VoiceGroup({ agentId, onAttach }: { agentId: string; onAttach: (paths: string[]) => void }) {
  const [state, setState] = useState<VoiceState>({ listening: false, partial: '' })
  const [holding, setHolding] = useState(false)
  // arming = pressed, not yet a hold; closing = released, bar still shrinking back.
  const [arming, setArming] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const [overCancel, setOverCancel] = useState(false)
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0))
  const timer = useRef<number | null>(null)
  const holdingRef = useRef(false)
  const listeningRef = useRef(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  listeningRef.current = state.listening

  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<VoiceState>).detail)
    window.addEventListener('hive:voice-state', onState)
    return () => window.removeEventListener('hive:voice-state', onState)
  }, [])
  useEffect(() => {
    if (!holding) return
    setBars(Array(BARS).fill(0))
    const onLevel = (e: Event) => setBars(b => [...b.slice(1), levelOf((e as CustomEvent<number>).detail)])
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') end(true) }
    window.addEventListener('hive:voice-level', onLevel)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('hive:voice-level', onLevel); window.removeEventListener('keydown', onKey) }
  }, [holding])

  const toggle = () => window.dispatchEvent(new CustomEvent('hive:voice-toggle', { detail: { agentId } }))
  const isOverCancel = (x: number, y: number) => {
    const r = cancelRef.current?.getBoundingClientRect()
    return !!r && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 10 && y <= r.bottom + 10
  }
  const end = (cancel: boolean) => {
    if (!holdingRef.current) return
    holdingRef.current = false
    setHolding(false)
    setClosing(true)
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setClosing(false); setOverCancel(false) }, MORPH_MS)
    if (cancel) window.dispatchEvent(new CustomEvent('hive:voice-cancel'))
    else if (listeningRef.current) toggle()
  }
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setArming(true)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setArming(false)
      holdingRef.current = true
      setHolding(true)
      if (!listeningRef.current) toggle()
    }, HOLD_MS)
  }
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; setArming(false); toggle(); return }
    end(isOverCancel(e.clientX, e.clientY))
  }
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (holdingRef.current) setOverCancel(isOverCancel(e.clientX, e.clientY))
  }
  const attach = async () => {
    if (holding) return
    const paths = await window.api.dialog.selectFiles().catch(() => [] as string[])
    if (paths.length) onAttach(paths)
  }

  const btn: React.CSSProperties = {
    flexShrink: 0, width: 30, height: 26, border: 'none', borderRadius: 999, background: 'transparent',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    fontFamily: FONT_PROSE, fontSize: 13, color: CHAT.muted, padding: 0, touchAction: 'none', userSelect: 'none'
  }
  const shown = holding || closing
  const red = overCancel && shown
  return (
    <span className="hive-vg" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <style>{CSS}</style>
      <span
        role="group"
        aria-label={holding ? 'Recording' : 'Attach and voice'}
        style={{
          display: 'inline-flex', alignItems: 'center', height: 28, padding: 1, borderRadius: 999,
          width: holding ? 280 : 62, overflow: 'hidden',
          background: holding ? accentTint(14) : state.listening ? accentTint(12) : CHAT.surface2,
          boxShadow: holding ? `0 0 0 1px ${red ? CRUSH.Sriracha : CHAT.accent}` : '0 0 0 1px transparent',
          transition: `width ${MORPH_MS}ms ${EASE}, background 160ms, box-shadow 160ms`
        }}
      >
        <button
          ref={cancelRef}
          onClick={attach}
          aria-label={holding ? 'Cancel recording' : 'Attach files'}
          title={holding ? 'Release here to cancel' : 'Attach files'}
          style={{ ...btn, fontSize: 17, color: shown ? (red ? '#FFFFFF' : CRUSH.Sriracha) : CHAT.muted, background: red ? CRUSH.Sriracha : 'transparent', transition: 'background 120ms, color 120ms' }}
        >
          <span aria-hidden style={{ display: 'inline-block', lineHeight: 1, transform: holding ? 'rotate(135deg)' : 'rotate(0deg)', transition: `transform ${MORPH_MS}ms ${EASE}` }}>＋</span>
        </button>
        {/* Always laid out (flex: 1), so 🎙 rides the right edge as the bar grows and shrinks instead of jumping. */}
        <span aria-label={shown ? 'Live waveform' : undefined} role={shown ? 'img' : undefined} aria-hidden={!shown}
          style={{ flex: 1, minWidth: 0, height: 20, display: 'flex', alignItems: 'center', gap: 2, padding: shown ? '0 6px' : 0, opacity: holding ? 1 : 0, transition: `opacity ${holding ? 160 : 120}ms` }}>
          {shown && bars.map((v, i) => (
            <i key={i} className={`hive-vg-bar${v < 0.08 && holding ? ' quiet' : ''}`}
              style={{ flex: 1, minWidth: 2, height: `${Math.max(10, v * 100)}%`, borderRadius: 2, background: red ? CRUSH.Sriracha : CHAT.accent, opacity: 0.35 + v * 0.65, transition: 'height 60ms linear, background 120ms', animationDelay: `${(i % 12) * 110}ms` }} />
          ))}
        </span>
        <button
          onPointerDown={down}
          onPointerUp={up}
          onPointerMove={move}
          onPointerCancel={() => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; setArming(false) } end(true) }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
          onContextMenu={e => e.preventDefault()}
          aria-label={holding ? 'Release to finish' : state.listening ? 'Stop listening' : 'Voice input'}
          title={holding ? 'Release to finish · release on ✕ to cancel' : state.listening ? 'Stop listening' : 'Voice input · hold to talk'}
          style={{
            ...btn, color: state.listening ? CRUSH.Sriracha : CHAT.muted,
            // Pressed but not yet a hold: it sinks and fills over the 300 ms, so you can tell holding will record.
            background: holding ? CHAT.accent : arming ? accentTint(30) : 'transparent',
            transform: arming ? 'scale(0.86)' : 'scale(1)',
            transition: arming ? `transform ${HOLD_MS}ms linear, background ${HOLD_MS}ms linear` : `transform 160ms ${EASE}, background 160ms`
          }}
        >{holding ? <span style={{ color: '#FFFFFF' }}>🎙</span> : state.listening ? '■' : '🎙'}</button>
      </span>
      {shown && <span aria-live="polite" aria-hidden={!holding} style={{ fontFamily: FONT_PROSE, fontSize: 11, color: red ? CRUSH.Sriracha : CHAT.muted, whiteSpace: 'nowrap', opacity: holding ? 1 : 0, transform: holding ? 'translateX(0)' : 'translateX(-6px)', transition: `opacity 120ms, transform ${MORPH_MS}ms ${EASE}` }}>{holding ? (overCancel ? 'Release to cancel' : 'Release to finish') : ''}</span>}
      {state.notice && !shown && (
        <span role="status" title={state.notice} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: FONT_PROSE, fontSize: 11.5, color: CRUSH.Zest }}>⚠ {state.notice}</span>
      )}
    </span>
  )
}
