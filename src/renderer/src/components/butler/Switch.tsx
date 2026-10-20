export function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`w-9 h-5 shrink-0 rounded-full cursor-pointer transition-colors relative disabled:opacity-50 ${on ? 'bg-accent' : 'bg-bg-hover'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  )
}
