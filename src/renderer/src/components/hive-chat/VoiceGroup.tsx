import { useEffect, useRef, useState } from 'react'
import { CHAT, CRUSH, FONT_PROSE, accentTint } from './crush-styles'

const HOLD_MS = 300
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
    setOverCancel(false)
    if (cancel) window.dispatchEvent(new CustomEvent('hive:voice-cancel'))
    else if (listeningRef.current) toggle()
  }
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    timer.current = window.setTimeout(() => {
      timer.current = null
      holdingRef.current = true
      setHolding(true)
      if (!listeningRef.current) toggle()
    }, HOLD_MS)
  }
  const up = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; toggle(); return }
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
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        role="group"
        aria-label={holding ? 'Recording' : 'Attach and voice'}
        style={{
          display: 'inline-flex', alignItems: 'center', height: 28, padding: 1, borderRadius: 999,
          width: holding ? 280 : 62, overflow: 'hidden',
          background: holding ? accentTint(14) : state.listening ? accentTint(12) : CHAT.surface2,
          boxShadow: holding ? `0 0 0 1px ${overCancel ? CRUSH.Sriracha : CHAT.accent}` : 'none',
          transition: 'width 220ms cubic-bezier(.2,.8,.2,1), background 160ms, box-shadow 160ms'
        }}
      >
        <button
          ref={cancelRef}
          onClick={attach}
          aria-label={holding ? 'Cancel recording' : 'Attach files'}
          title={holding ? 'Release here to cancel' : 'Attach files'}
          style={{ ...btn, fontSize: 17, color: holding ? (overCancel ? '#FFFFFF' : CRUSH.Sriracha) : CHAT.muted, background: overCancel ? CRUSH.Sriracha : 'transparent', transition: 'background 120ms, color 120ms' }}
        >
          <span aria-hidden style={{ display: 'inline-block', lineHeight: 1, transform: holding ? 'rotate(135deg)' : 'rotate(0deg)', transition: 'transform 220ms cubic-bezier(.2,.8,.2,1)' }}>＋</span>
        </button>
        {holding && (
          <span aria-label="Live waveform" role="img" style={{ flex: 1, minWidth: 0, height: 20, display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px' }}>
            {bars.map((v, i) => (
              <i key={i} style={{ flex: 1, minWidth: 2, height: `${Math.max(10, v * 100)}%`, borderRadius: 2, background: overCancel ? CRUSH.Sriracha : CHAT.accent, opacity: 0.35 + v * 0.65, transition: 'height 60ms linear' }} />
            ))}
          </span>
        )}
        <button
          onPointerDown={down}
          onPointerUp={up}
          onPointerMove={move}
          onPointerCancel={() => end(true)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
          onContextMenu={e => e.preventDefault()}
          aria-label={holding ? 'Release to finish' : state.listening ? 'Stop listening' : 'Voice input'}
          title={holding ? 'Release to finish · release on ✕ to cancel' : state.listening ? 'Stop listening' : 'Voice input · hold to talk'}
          style={{ ...btn, marginLeft: holding ? 0 : 'auto', color: state.listening ? CRUSH.Sriracha : CHAT.muted, background: holding ? CHAT.accent : 'transparent' }}
        >{holding ? <span style={{ color: '#FFFFFF' }}>🎙</span> : state.listening ? '■' : '🎙'}</button>
      </span>
      {holding && <span aria-live="polite" style={{ fontFamily: FONT_PROSE, fontSize: 11, color: overCancel ? CRUSH.Sriracha : CHAT.muted, whiteSpace: 'nowrap' }}>{overCancel ? 'Release to cancel' : 'Release to finish'}</span>}
      {state.notice && !holding && (
        <span role="status" title={state.notice} style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: FONT_PROSE, fontSize: 11.5, color: CRUSH.Zest }}>⚠ {state.notice}</span>
      )}
    </span>
  )
}
