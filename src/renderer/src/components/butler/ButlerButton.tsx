interface Props {
  open: boolean
  phoneConnected: boolean
  waiting: number
  onClick: () => void
  /** "Hola Butler" wake word is listening: pulsing red mic. */
  listening?: boolean
}

/** Fixed slot at the right end of the rightmost column header. */
export function ButlerButton({ open, phoneConnected, waiting, onClick, listening }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label="Butler"
      aria-expanded={open}
      className={`no-drag h-[30px] pl-[5px] pr-2.5 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer flex-shrink-0 shadow-sm transition-colors ${
        open ? 'bg-accent text-text-on-purple' : 'bg-bg-secondary text-text-primary hover:bg-bg-hover'
      }`}
    >
      <span className={`relative w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[13px] ${open ? 'bg-white/25' : 'bg-accent-subtle'}`}>
        🎩
        {phoneConnected && (
          <span title="Phone connected" className={`absolute -right-px -bottom-px w-2 h-2 rounded-full bg-status-working border-2 ${open ? 'border-accent' : 'border-bg-secondary'}`} />
        )}
      </span>
      Butler
      {listening && (
        <span title="Listening for “Hola Butler”" aria-label="Listening" className="relative w-[18px] h-[18px] rounded-full bg-red-500/15 text-red-500 text-[10px] inline-flex items-center justify-center">
          🎙
          <span className="absolute -inset-[3px] rounded-full border-2 border-red-500/45 animate-ping" />
        </span>
      )}
      {waiting > 0 && (
        <span title={`${waiting} waiting for you`} className="min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold inline-flex items-center justify-center">{waiting}</span>
      )}
    </button>
  )
}
