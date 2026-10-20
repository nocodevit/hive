interface Props {
  onStart: () => void
  onNotNow: () => void
}

/** First-run card under the Butler button (asked once; main/butler.ts shouldOffer). */
export function ButlerOfferCard({ onStart, onNotNow }: Props) {
  return (
    <div role="dialog" aria-label="Set up Hive with Butler?"
      className="no-drag fixed z-50 top-[60px] right-4 w-[300px] hive-card shadow-e3 p-3.5 flex gap-3 items-center">
      <div className="w-[38px] h-[38px] rounded-xl bg-accent-subtle flex items-center justify-center text-[20px] flex-shrink-0">🎩</div>
      <div className="min-w-0">
        <div className="text-[14px] font-semibold text-text-primary">Set up Hive with Butler?</div>
        <div className="text-[12px] text-text-muted mt-0.5 mb-2">Phone · voice · agents · 2 min</div>
        <div className="flex gap-1.5">
          <button onClick={onStart} className="px-3 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer">Start</button>
          <button onClick={onNotNow} className="px-3 py-1 rounded-lg bg-bg-primary text-text-primary text-[12px] font-semibold cursor-pointer">Not now</button>
        </div>
      </div>
    </div>
  )
}
