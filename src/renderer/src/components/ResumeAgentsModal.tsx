import { useEffect, useMemo, useState } from 'react'
import { ctxPctFromPrev, restartResumeMode } from './hive-chat/bulkRestart'
import { parseContextSize } from './hive-chat/progress-bar'
import { formatTimeSince } from '../timeSince'

export interface UnclosedAgent {
  agentId: string
  agent: string
  project: string
  lastTask: string
  lastActiveMs: number
  contextSize: string
  peakInputTokens: number
  hasSession: boolean
}

interface Props {
  rows: UnclosedAgent[]
  onResume: (agentIds: string[]) => void
  onSkip: () => void
}

const MODE_NOTE: Record<'compact-resume' | 'resume' | 'new', string> = {
  'compact-resume': 'compacts first',
  resume: 'resumes',
  new: 'starts new'
}

function lastActive(ms: number, now: number): string {
  const since = formatTimeSince(ms, now)
  return since === 'now' ? 'just now' : `${since} ago`
}

/**
 * Shown once at startup when chats were still open at the last quit (or
 * crash). Everything is ticked by default; nothing starts until Resume.
 */
export default function ResumeAgentsModal({ rows, onResume, onSkip }: Props) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(rows.map(r => r.agentId)))
  const allPicked = picked.size === rows.length
  const now = useMemo(() => Date.now(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSkip() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSkip])

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onSkip} />
      <div role="dialog" aria-modal="true" aria-labelledby="resume-agents-title"
        className="hive-card relative w-[720px] max-w-[92vw] max-h-[82vh] flex flex-col">
        <div className="px-6 pt-5 pb-3">
          <h2 id="resume-agents-title" className="hive-head-title !text-[16px]">Resume where you left off?</h2>
          <p className="mt-1 text-[13px] text-text-muted">
            {rows.length === 1 ? '1 agent had its chat open' : `${rows.length} agents had their chats open`} when Hive last closed.
          </p>
        </div>

        <label className="mx-4 px-2.5 py-2 flex items-center gap-3 text-[13px] font-semibold text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={allPicked}
            onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map(r => r.agentId)))}
            className="w-4 h-4 accent-[var(--accent)] cursor-pointer"
          />
          Select all
          <span className="ml-auto text-[12px] font-medium text-text-muted">{picked.size} of {rows.length} selected</span>
        </label>

        <ul className="flex-1 min-h-0 overflow-y-auto px-4 pb-2 space-y-1">
          {rows.map(r => {
            const pct = ctxPctFromPrev(r, parseContextSize)
            const mode = restartResumeMode(r.hasSession, pct)
            const on = picked.has(r.agentId)
            return (
              <li key={r.agentId}>
                <label className={`flex items-start gap-3 px-2.5 py-2.5 rounded-xl cursor-pointer transition-colors ${on ? 'bg-accent-subtle' : 'hover:bg-bg-hover'}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(r.agentId)}
                    aria-label={`${r.project} / ${r.agent}`}
                    className="mt-0.5 w-4 h-4 accent-[var(--accent)] cursor-pointer flex-shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] font-semibold text-text-primary truncate">{r.agent}</span>
                      <span className="text-[12px] text-text-muted truncate">{r.project}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] leading-snug text-text-primary/80 line-clamp-2">
                      {r.lastTask || <span className="text-text-muted">No message recorded</span>}
                    </p>
                  </div>
                  <div className="flex-shrink-0 w-[150px] text-right">
                    <div className="flex items-center justify-end gap-2 text-[12px] tabular-nums text-text-primary">
                      <span className="w-12 h-1 rounded-full bg-sidebar-bg overflow-hidden" aria-hidden="true">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, pct)}%` }} />
                      </span>
                      {r.hasSession ? `context ${pct}%` : 'context —'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-text-muted">
                      {MODE_NOTE[mode]}{r.lastActiveMs ? ` · ${lastActive(r.lastActiveMs, now)}` : ''}
                    </div>
                  </div>
                </label>
              </li>
            )
          })}
        </ul>

        <div className="px-6 py-4 flex items-center justify-end gap-2">
          <button
            onClick={onSkip}
            className="px-4 py-2 rounded-[10px] text-[13px] font-medium text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors cursor-pointer"
          >
            Not now
          </button>
          <button
            autoFocus
            disabled={picked.size === 0}
            onClick={() => onResume(rows.filter(r => picked.has(r.agentId)).map(r => r.agentId))}
            className="px-4 py-2 rounded-[10px] text-[13px] font-semibold bg-accent text-text-on-purple hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            Resume{picked.size > 0 ? ` (${picked.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
