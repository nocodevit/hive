import { useEffect, useState } from 'react'
import succulent from '../../assets/botanic/succulent.webp'

/** True while the 🌿 Botanic skin is on (follows the html data-palette attribute). */
export function useBotanic(): boolean {
  const read = () => document.documentElement.dataset.palette === 'botanic'
  const [on, setOn] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setOn(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] })
    return () => mo.disconnect()
  }, [])
  return on
}

// A div, not a <button>: the composer's button styles would squash it into an oval.
const CSS = `
.hss { all: unset; position: relative; display: block; box-sizing: border-box; flex: 0 0 auto; --s: 44px;
  width: var(--s); height: var(--s); min-width: var(--s); min-height: var(--s); aspect-ratio: 1 / 1; border-radius: 50%; cursor: pointer }
.hss[aria-disabled='true'] { cursor: default }
.hss:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.hss img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; display: block; pointer-events: none;
  transition: transform 300ms cubic-bezier(.3,1.25,.5,1), filter 150ms, opacity 150ms }
.hss[aria-disabled='true'] img { filter: grayscale(.85); opacity: .55 }
.hss:not([aria-disabled='true']):hover img { transform: rotate(30deg) }
.hss.spin img { animation: hss-spin 900ms cubic-bezier(.3,1.25,.5,1) }
@keyframes hss-spin { 0% { transform: rotate(0) scale(1) } 25% { transform: rotate(140deg) scale(.9) } 100% { transform: rotate(360deg) scale(1) } }
.hss::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 2px solid #c3a6e6; opacity: 0; pointer-events: none }
.hss.spin::after { animation: hss-ring 700ms ease-out 250ms }
@keyframes hss-ring { from { opacity: .9; transform: scale(.9) } to { opacity: 0; transform: scale(1.5) } }
@media (prefers-reduced-motion: reduce) { .hss img, .hss.spin img, .hss.spin::after { animation: none !important; transition: none } .hss:hover img { transform: none } }
`

/**
 * Send, Botanic style (owner's pick, 11-04: rosette B): a round succulent seen
 * from above. When a message goes (click or Enter) the chat sets `lit`: it
 * spins once and a ring ripples out.
 */
export function SucculentSend({ enabled, lit, onPress }: { enabled: boolean; lit: boolean; onPress: () => void }) {
  const press = () => { if (enabled) onPress() }
  return (
    <div role="button" tabIndex={enabled ? 0 : -1} aria-label="Send" aria-disabled={!enabled} title="Send (Enter)"
      className={`hss${lit ? ' spin' : ''}`} onClick={press}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press() } }}>
      <style>{CSS}</style>
      <img src={succulent} alt="" draggable={false} />
    </div>
  )
}
