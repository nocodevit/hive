import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { popover } from '../../lib/motion'

/** Who a discussion goes to: Butler (no target), or one agent's chat. */
export interface DiscussTarget { agentId: string; agent: string; projectId: string; project: string; activity: 'working' | 'waiting' | 'off' }
export type OnDiscuss = (text: string, to?: DiscussTarget) => void

const DOT = { working: 'bg-status-working', waiting: 'bg-status-waiting', off: 'bg-text-muted/40' } as const

/** "💬 Discuss" goes to Butler; ▾ lists every agent by project to take it there instead. */
export function DiscussButton({ label, text, onDiscuss, compact = false, className = '' }: {
  label: string; text: () => string; onDiscuss: OnDiscuss; compact?: boolean; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<DiscussTarget[]>([])
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    window.api.butler.agents().then(r => setRows(r as DiscussTarget[])).catch(() => {})
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  const projects = [...new Set(rows.map(r => r.project))]
  const go = (to?: DiscussTarget) => { setOpen(false); onDiscuss(text(), to) }
  const base = 'h-7 rounded-lg text-[12px] text-text-secondary hover:bg-bg-hover inline-flex items-center cursor-pointer'
  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button onClick={() => go()} aria-label={label} title="Discuss with Butler" className={`${base} ${compact ? 'w-7 justify-center' : 'pl-2 pr-1 gap-1'} rounded-r-none`}>💬{compact ? '' : ' Discuss'}</button>
      <button onClick={() => setOpen(o => !o)} aria-label={`${label} with…`} aria-expanded={open} title="Discuss with an agent" className={`${base} w-5 justify-center rounded-l-none text-[10px] text-text-muted`}>▾</button>
      <AnimatePresence>{open && (
        <motion.div {...popover('bottom left')} role="menu" aria-label="Discuss with" className="absolute z-30 bottom-full mb-1 left-0 w-[240px] max-h-[320px] overflow-y-auto rounded-xl bg-bg-secondary border border-border shadow-lg p-1">
          <button role="menuitem" onClick={() => go()} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] text-text-primary hover:bg-bg-hover cursor-pointer">🎩 <b className="font-semibold">Butler</b><span className="ml-auto text-[10.5px] text-text-muted">default</span></button>
          {projects.map(p => (
            <div key={p} role="group" aria-label={p}>
              <div className="px-2 pt-2 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-muted truncate">{p || 'No project'}</div>
              {rows.filter(r => r.project === p).map(r => (
                <button key={r.agentId} role="menuitem" onClick={() => go(r)} aria-label={`Discuss with ${r.agent}`}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] text-text-primary hover:bg-bg-hover cursor-pointer">
                  <i className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[r.activity] ?? DOT.off}`} aria-hidden />
                  <span className="flex-1 min-w-0 truncate">{r.agent}</span>
                  {r.activity === 'off' && <span className="text-[10.5px] text-text-muted">resumes</span>}
                </button>
              ))}
            </div>
          ))}
        </motion.div>
      )}</AnimatePresence>
    </span>
  )
}
