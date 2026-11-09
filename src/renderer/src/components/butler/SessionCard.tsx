import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FADE_IN, SMOOTH } from '../../lib/motion'

export interface LastTurn { task: string; reply: string; at: number }

type Send = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * One agent in Butler → Sessions: the task you last gave it and how it ended
 * the turn. Click to read the whole reply and answer it right here.
 */
export function SessionCard({ agent, dot, meta, action, turn, onReply }: {
  agent: string; dot: string; meta: string; action: ReactNode; turn?: LastTurn
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
  return (
    <motion.div layout transition={SMOOTH} className="rounded-xl bg-bg-primary text-[13px]">
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${dot}`} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-text-primary truncate">{agent}</div>
          <div className="text-[11px] text-text-muted truncate">{meta}</div>
        </div>
        {action}
      </div>
      {hasTurn && (
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} ${agent}'s last reply`}
          className="w-full text-left px-3 pb-2 -mt-0.5 flex flex-col gap-0.5 cursor-pointer">
          {turn?.task && <span className="text-[11.5px] text-text-muted truncate"><b className="font-semibold">Task</b> {turn.task}</span>}
          {turn?.reply && !open && <span className="text-[12px] text-text-secondary line-clamp-2">{turn.reply}</span>}
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE_IN} className="px-3 pb-3 flex flex-col gap-2">
            {turn?.reply && (
              <div role="region" aria-label={`${agent}'s last reply`}
                className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-[12.5px] text-text-primary leading-relaxed">{turn.reply}</div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea value={text} rows={1} placeholder={`Reply to ${agent}`} aria-label={`Reply to ${agent}`}
                onChange={e => { setText(e.target.value); if (send === 'failed') setSend('idle') }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void go() } }}
                className="flex-1 min-w-0 resize-none max-h-32 px-2.5 py-1.5 rounded-lg bg-bg-secondary border border-border text-[12.5px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
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
    </motion.div>
  )
}
