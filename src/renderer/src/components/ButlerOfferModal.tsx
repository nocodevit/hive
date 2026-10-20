import { useEffect } from 'react'

interface Props {
  onTurnOn: () => void
  onNotNow: () => void
}

/**
 * Asked once (main/butler.ts shouldOffer): turn on the built-in Butler so
 * Hive can be driven from the Claude app on a phone. Either answer is final;
 * the switch stays in App Settings → Remote Control.
 */
export default function ButlerOfferModal({ onTurnOn, onNotNow }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onNotNow() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNotNow])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onNotNow} />
      <div role="dialog" aria-modal="true" aria-labelledby="butler-offer-title"
        className="hive-card relative w-[520px] max-w-[92vw] px-6 py-5">
        <h2 id="butler-offer-title" className="hive-head-title text-base text-text-primary">Control Hive from your phone?</h2>
        <p className="mt-2 text-[13px] text-text-muted">
          Turn on Butler and a Claude Code session called “Hive Butler” runs on this Mac with Remote Control.
          In the Claude app on your phone (Code tab) you can then ask who is running, read what an agent said,
          and send a message to the agent you name.
        </p>
        <p className="mt-2 text-[13px] text-text-muted">
          You can change this any time in App Settings → Remote Control.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onNotNow}
            className="px-3 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-[13px] cursor-pointer">Not now</button>
          <button onClick={onTurnOn}
            className="px-3 py-1.5 rounded-lg bg-accent text-text-on-purple text-[13px] cursor-pointer">Turn on</button>
        </div>
      </div>
    </div>
  )
}
