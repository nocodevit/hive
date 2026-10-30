import { useEffect, useState } from 'react'

/** True while the 🎃 Halloween skin is on (follows the html data-palette attribute). */
export function useHalloween(): boolean {
  const read = () => document.documentElement.dataset.palette === 'halloween'
  const [on, setOn] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setOn(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] })
    return () => mo.disconnect()
  }, [])
  return on
}

const CSS = `
.hps { position: relative; flex-shrink: 0; width: 34px; height: 34px; padding: 0; border: none; background: transparent; cursor: pointer }
.hps:disabled { cursor: default }
.hps svg { display: block; width: 100%; height: 100%; overflow: visible; transform-origin: 50% 60% }
.hps:disabled svg { filter: grayscale(.85) brightness(.6) }
.hps .face { fill: #2a1400; transition: fill 120ms }
.hps .glow { opacity: 0; transition: opacity 120ms }
.hps.pop .face { fill: #ffd34d }
.hps.pop .glow { opacity: 1 }
.hps.pop svg { animation: hps-bump 420ms cubic-bezier(.34,1.56,.64,1) }
@keyframes hps-bump { 0% { transform: scale(1) } 30% { transform: scale(1.25) rotate(-6deg) } 60% { transform: scale(.95) rotate(3deg) } 100% { transform: scale(1) } }
.hps-smoke { position: absolute; left: 50%; top: 2px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: rgba(220,200,255,.5); filter: blur(2px); opacity: 0; pointer-events: none }
.hps.pop .hps-smoke { animation: hps-smoke 900ms ease-out 120ms forwards }
.hps.pop .hps-smoke + .hps-smoke { animation-delay: 210ms; --dx: 8px }
@keyframes hps-smoke { from { opacity: .8; transform: translate(0, 0) scale(.6) } to { opacity: 0; transform: translate(var(--dx, -8px), -46px) scale(2.2) } }
@media (prefers-reduced-motion: reduce) { .hps.pop svg, .hps.pop .hps-smoke { animation: none !important } .hps .face, .hps .glow { transition: fill 150ms linear, opacity 150ms linear } }
`

/**
 * Send, Halloween style (owner's pick, 10-30: the jack-o'-lantern): a dark pumpkin.
 * When a message goes (click or Enter) the chat sets `lit` for a moment: the face
 * lights up, the pumpkin hops, two wisps of smoke rise, then it goes dark again.
 * The chat keeps this button up for that moment even while the reply starts.
 */
export function PumpkinSend({ enabled, lit, onPress }: { enabled: boolean; lit: boolean; onPress: () => void }) {
  return (
    <button onClick={() => { if (enabled) onPress() }} disabled={!enabled && !lit} title="Send (Enter)" aria-label="Send" className={`hps${lit ? ' pop' : ''}`}>
      <style>{CSS}</style>
      <svg viewBox="0 0 40 40" aria-hidden>
        <defs><radialGradient id="hps-glow"><stop offset="0" stopColor="#ffcf4d" stopOpacity=".9" /><stop offset="1" stopColor="#ff7a00" stopOpacity="0" /></radialGradient></defs>
        <circle className="glow" cx="20" cy="23" r="20" fill="url(#hps-glow)" />
        <path d="M19 6c0-3 3-4 4-3-2 1-2 2-2 4z" fill="#4a7a2a" />
        <ellipse cx="13" cy="23" rx="9" ry="13" fill="#e8730c" /><ellipse cx="27" cy="23" rx="9" ry="13" fill="#e8730c" /><ellipse cx="20" cy="23" rx="9" ry="14" fill="#ff8a1c" />
        <path className="face" d="M11 19l4-4 3 4zM22 19l3-4 4 4zM11 26c3 4 15 4 18 0l-3 1-2-2-2 2-2-2-2 2-2-2-2 2z" />
      </svg>
      <span className="hps-smoke" aria-hidden /><span className="hps-smoke" aria-hidden />
    </button>
  )
}
