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
.hgs { position: relative; flex-shrink: 0; width: 34px; height: 34px; padding: 0; border: none; background: transparent; cursor: pointer }
.hgs:disabled { cursor: default }
.hgs-hole { position: absolute; inset: 0; border-radius: 50%; background: radial-gradient(circle at 50% 40%, #2a1848, #0a0512);
  box-shadow: inset 0 3px 6px rgba(0,0,0,.8), 0 0 0 2px var(--chat-accent, #9b5cff); transition: box-shadow 150ms }
.hgs:disabled .hgs-hole { box-shadow: inset 0 3px 6px rgba(0,0,0,.8), 0 0 0 2px color-mix(in srgb, var(--chat-muted) 40%, transparent) }
.hgs-arrow { position: absolute; inset: 0; display: grid; place-items: center; color: #c9a8ff; font-weight: 700; font-size: 15px; transition: opacity 120ms }
.hgs:disabled .hgs-arrow { color: color-mix(in srgb, var(--chat-muted) 60%, transparent) }
.hgs.pop .hgs-arrow { opacity: 0 }
/* the ghost lives in the hole: clipped at the rim, it pops half out */
.hgs-clip { position: absolute; left: -6px; right: -6px; top: -44px; bottom: 3px; overflow: hidden; border-radius: 0 0 50% 50%; pointer-events: none }
.hgs-ghost { position: absolute; left: 50%; bottom: 0; width: 30px; margin-left: -15px; transform: translateY(30px); opacity: 0;
  transition: transform 260ms cubic-bezier(.34,1.56,.64,1), opacity 100ms; filter: drop-shadow(0 0 6px rgba(239,233,255,.4)) }
.hgs.pop .hgs-ghost { transform: translateY(-4px); opacity: 1 }
@media (prefers-reduced-motion: reduce) { .hgs-ghost { transition: opacity 150ms linear !important; transform: translateY(-4px) } .hgs-arrow { transition: opacity 150ms linear !important } }
`

/**
 * Send, Halloween style (owner's pick, 10-29: "洞里的鬼，打地鼠"): the button is
 * a small dark hole with a faint ↑. When a message goes (click or Enter) the chat
 * sets `popped` for a second: a ghost pops half out of the hole, then ducks back.
 * The chat keeps this button up for that second even while the reply starts.
 */
export function GhostSend({ enabled, popped, onPress }: { enabled: boolean; popped: boolean; onPress: () => void }) {
  return (
    <button onClick={() => { if (enabled) onPress() }} disabled={!enabled && !popped} title="Send (Enter)" aria-label="Send" className={`hgs${popped ? ' pop' : ''}`}>
      <style>{CSS}</style>
      <span className="hgs-hole" aria-hidden />
      <span className="hgs-arrow" aria-hidden>↑</span>
      <span className="hgs-clip" aria-hidden>
        <svg className="hgs-ghost" viewBox="0 0 60 70">
          <path fill="#f3ecff" d="M30 2C14 2 4 14 4 30v36l8-6 8 6 10-6 10 6 8-6 8 6V30C56 14 46 2 30 2z" />
          <ellipse cx="22" cy="27" rx="4.5" ry="6" fill="#120a1f" /><ellipse cx="38" cy="27" rx="4.5" ry="6" fill="#120a1f" />
          <circle cx="22" cy="28" r="2" fill="#ff3b3b" /><circle cx="38" cy="28" r="2" fill="#ff3b3b" />
          <ellipse cx="30" cy="42" rx="5" ry="6" fill="#120a1f" />
        </svg>
      </span>
    </button>
  )
}
