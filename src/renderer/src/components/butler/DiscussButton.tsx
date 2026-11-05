import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { popover } from '../../lib/motion'

/** An agent the work can be dispatched to. */
export interface DiscussTarget { agentId: string; agent: string; projectId: string; project: string; activity: 'working' | 'waiting' | 'off' }
/** No target: talk it over with Butler. A target: dispatch it to that agent's chat. */
export type OnDiscuss = (text: string, to?: DiscussTarget) => void

const DOT = { working: 'bg-status-working', waiting: 'bg-status-waiting', off: 'bg-text-muted/40' } as const
const GAP = 4
const EDGE = 8
const MENU_W = 240
const MENU_MAX = 320

/** Where the menu fits: below the trigger, or above when there is more room there; never past the window. */
function place(r: DOMRect) {
  const below = window.innerHeight - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  const down = below >= Math.min(MENU_MAX, above)
  const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - MENU_W - EDGE))
  return down
    ? { left, top: r.bottom + GAP, maxHeight: Math.min(MENU_MAX, below), origin: 'top left' }
    : { left, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(MENU_MAX, above), origin: 'bottom left' }
}

/** "💬 Discuss" talks it over with Butler; "📤 Dispatch ▾" sends it to one agent, listed by project. */
export function DiscussButton({ subject, text, onDiscuss, compact = false, className = '' }: {
  subject: string; text: () => string; onDiscuss: OnDiscuss; compact?: boolean; className?: string
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<DiscussTarget[]>([])
  const [pos, setPos] = useState<ReturnType<typeof place> | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const update = () => trigger.current && setPos(place(trigger.current.getBoundingClientRect()))
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [open])
  useEffect(() => {
    if (!open) return
    window.api.butler.agents().then(r => setRows(r as DiscussTarget[])).catch(() => {})
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === 'Escape') setOpen(false); return }
      const t = e.target as Node
      if (!trigger.current?.contains(t) && !menu.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])
  const projects = [...new Set(rows.map(r => r.project))]
  const go = (to?: DiscussTarget) => { setOpen(false); onDiscuss(text(), to) }
  const base = 'h-7 rounded-lg text-[12px] text-text-secondary hover:bg-bg-hover inline-flex items-center gap-1 cursor-pointer'
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <button onClick={() => go()} aria-label={`Discuss ${subject}`} title="Talk it over with Butler — opens the Butler chat"
        className={`${base} ${compact ? 'w-7 justify-center' : 'px-2'}`}>💬{compact ? '' : ' Discuss'}</button>
      <button ref={trigger} onClick={() => setOpen(o => !o)} aria-label={`Dispatch ${subject}`} aria-haspopup="menu" aria-expanded={open}
        title="Dispatch to an agent — sends it to that agent's chat" className={`${base} ${compact ? 'px-1' : 'pl-2 pr-1.5'}`}>
        📤{compact ? '' : ' Dispatch'}<span className="text-[10px] text-text-muted" aria-hidden>▾</span>
      </button>
      {createPortal(
        <AnimatePresence>{open && pos && (
          <motion.div ref={menu} {...popover(pos.origin)} role="menu" aria-label="Dispatch to"
            style={{ transformOrigin: pos.origin, position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight, width: MENU_W }}
            className="z-[80] overflow-y-auto rounded-xl bg-bg-secondary border border-border shadow-lg p-1">
            {rows.length === 0 && <div className="px-2 py-1.5 text-[12px] text-text-muted">No agents yet</div>}
            {projects.map(p => (
              <div key={p} role="group" aria-label={p}>
                <div className="px-2 pt-2 pb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-text-muted truncate">{p || 'No project'}</div>
                {rows.filter(r => r.project === p).map(r => (
                  <button key={r.agentId} role="menuitem" onClick={() => go(r)} aria-label={`Dispatch to ${r.agent}`}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-[12.5px] text-text-primary hover:bg-bg-hover cursor-pointer">
                    <i className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[r.activity] ?? DOT.off}`} aria-hidden />
                    <span className="flex-1 min-w-0 truncate">{r.agent}</span>
                    {r.activity === 'off' && <span className="text-[10.5px] text-text-muted">resumes</span>}
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}</AnimatePresence>,
        document.body
      )}
    </span>
  )
}
