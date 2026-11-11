import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FADE_IN, SMOOTH } from '../../lib/motion'
import { sinceLabel, type SessionRow } from '../../lib/butler-sessions'

export interface LastTurn { task: string; reply: string; at: number }

type Send = 'idle' | 'sending' | 'sent' | 'failed'
type Activity = SessionRow['activity']

const DOT: Record<Activity, string> = { working: 'bg-status-working', waiting: 'bg-status-waiting', off: 'bg-status-done' }
const SECTION: Record<Activity, string> = { waiting: 'Needs you', working: 'Working', off: 'Off' }

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className={`flex-shrink-0 text-text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

/**
 * One agent in Butler → Sessions. The header row (chevron, name, project, when)
 * opens it; collapsed it previews what you asked and how the agent answered,
 * open it shows the whole answer and a box to reply right here.
 */
export function SessionCard({ agent, project, activity, updatedAt, action, turn, onReply }: {
  agent: string; project: string; activity: Activity; updatedAt?: number; action: ReactNode; turn?: LastTurn
  onReply: (text: string) => Promise<{ ok: boolean }>
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [send, setSend] = useState<Send>('idle')
  const go = async () => {
    const t = text.trim()
    if (!t || send === 'sending') return
    setSend('sending')
    const r = await onReply(t).catch(() => ({ ok: false }))
    if (r.ok) { setText(''); setSend('sent'); setTimeout(() => setSend(s => (s === 'sent' ? 'idle' : s)), 1500) } else setSend('failed')
  }
  const hasTurn = !!(turn?.task || turn?.reply)
  const since = sinceLabel(updatedAt)
  return (
    <motion.li layout="position" transition={SMOOTH} className="list-none">
      <div className="grid grid-cols-[1fr_auto] items-start gap-x-2 px-3 py-2.5">
        <button type="button" onClick={() => setOpen(o => !o)} disabled={!hasTurn} aria-expanded={hasTurn ? open : undefined}
          aria-label={hasTurn ? `${open ? 'Hide' : 'Show'} ${agent}'s last reply` : agent}
          className="min-w-0 text-left rounded-lg -mx-1.5 -my-1 px-1.5 py-1 enabled:cursor-pointer enabled:hover:bg-bg-hover/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          <span className="flex items-center gap-2 min-w-0">
            {hasTurn ? <Chevron open={open} /> : <span aria-hidden className="w-3 flex-shrink-0" />}
            <span aria-hidden className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[activity]}`} />
            <span className="text-[13.5px] font-semibold text-text-primary truncate">{agent}</span>
            {project && <span className="px-1.5 py-px rounded-md bg-bg-hover text-[11px] font-medium text-text-secondary truncate max-w-[45%]">{project}</span>}
            {since && <span className="ml-auto pl-1 font-mono text-[11px] text-text-muted flex-shrink-0">{since}</span>}
          </span>
          {hasTurn && !open && (
            <span className="mt-1.5 ml-5 flex flex-col gap-1">
              {turn?.task && (
                <span className="flex items-baseline gap-1.5 min-w-0 text-[12px] text-text-muted">
                  <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider">You</span>
                  <span className="truncate">{turn.task}</span>
                </span>
              )}
              {turn?.reply && <span className="text-[12.5px] leading-snug text-text-secondary line-clamp-2">{turn.reply}</span>}
            </span>
          )}
        </button>
        <div className="pt-px">{action}</div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE_IN} className="px-3 pb-3 ml-5 flex flex-col gap-2">
            {turn?.task && (
              <div role="note" aria-label={`You asked ${agent}`} className="self-end max-w-[88%] rounded-[12px_4px_12px_12px] bg-accent-subtle px-2.5 py-1.5 text-[12.5px] text-text-primary">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-accent">You asked</span>
                <span className="whitespace-pre-wrap break-words">{turn.task}</span>
              </div>
            )}
            {turn?.reply && (
              <div role="region" aria-label={`${agent}'s last reply`}
                className="max-w-[94%] rounded-[4px_12px_12px_12px] bg-bg-primary border border-border px-2.5 py-1.5">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted">{agent} replied</span>
                <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] text-text-primary leading-relaxed">{turn.reply}</div>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea value={text} rows={1} placeholder={`Reply to ${agent}…`} aria-label={`Reply to ${agent}`}
                onChange={e => { setText(e.target.value); if (send === 'failed') setSend('idle') }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void go() } }}
                className="flex-1 min-w-0 resize-none max-h-32 px-2.5 py-1.5 rounded-lg bg-bg-primary border border-border text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
              <button onClick={() => void go()} disabled={!text.trim() || send === 'sending'} aria-label={`Send to ${agent}`}
                className="h-[30px] px-2.5 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default inline-grid place-items-center">
                <span className={`[grid-area:1/1] ${send === 'idle' || send === 'failed' ? '' : 'invisible'}`}>Send</span>
                <span className={`[grid-area:1/1] ${send === 'sending' ? '' : 'invisible'}`}>Sending…</span>
                <span className={`[grid-area:1/1] ${send === 'sent' ? '' : 'invisible'}`}>✓ Sent</span>
              </button>
            </div>
            {send === 'failed' && <div role="alert" className="text-[11.5px] text-status-danger">Not sent — {agent} could not be reached</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  )
}

/** More agents off than this: the Off group starts folded. */
export const OFF_FOLD_AFTER = 6

/** Butler → Sessions: Needs you / Working / Off, each a list; a long Off list starts folded. */
export function SessionsList<R extends SessionRow>({ rows, turns, action, onReply }: {
  rows: R[]
  turns: Record<string, LastTurn | undefined>
  action: (r: R) => ReactNode
  onReply: (r: R, text: string) => Promise<{ ok: boolean }>
}) {
  const [showOffPick, setShowOff] = useState<boolean | null>(null)
  const showOff = showOffPick ?? rows.filter(r => r.activity === 'off').length <= OFF_FOLD_AFTER
  if (rows.length === 0) return <div className="text-[12px] text-text-muted px-1">No agents yet</div>
  return (
    <>
      {(['waiting', 'working', 'off'] as const).map(k => {
        const list = rows.filter(r => r.activity === k)
        if (!list.length) return null
        const folded = k === 'off' && !showOff
        return (
          <section key={k} aria-label={`${SECTION[k]} (${list.length})`} className="flex flex-col gap-1.5">
            <h3 className="flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
              {k === 'off' ? (
                <button type="button" onClick={() => setShowOff(!showOff)} aria-expanded={showOff}
                  className="inline-flex items-center gap-1.5 uppercase tracking-wider cursor-pointer hover:text-text-primary">
                  <Chevron open={showOff} />{SECTION[k]} <span className="font-mono">{list.length}</span>
                </button>
              ) : (
                <><span aria-hidden className={`w-2 h-2 rounded-full ${DOT[k]}`} />{SECTION[k]} <span className="font-mono">{list.length}</span></>
              )}
            </h3>
            {!folded && (
              <ul className={`rounded-xl bg-bg-secondary border divide-y divide-border overflow-hidden ${k === 'waiting' ? 'border-status-waiting/50' : 'border-border'}`}>
                {list.map(r => (
                  <SessionCard key={r.agentId} agent={r.agent} project={r.project} activity={r.activity} updatedAt={r.updatedAt}
                    turn={turns[r.agentId]} action={action(r)} onReply={text => onReply(r, text)} />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </>
  )
}
