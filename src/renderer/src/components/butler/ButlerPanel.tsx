import { useEffect, useState } from 'react'
import HiveChat from '../hive-chat'
import { orderSessions, sessionCounts, type SessionRow } from '../../lib/butler-sessions'
import { setupProgress, type SetupMark } from '../../lib/butler-setup'
import { ApprovalsList } from './ApprovalsList'
import { TodayTab } from './TodayTab' // [butler:mail-routines]

export type ButlerMode = 'drawer' | 'page'
// [butler:mail-routines] add 'today'
type Tab = 'chat' | 'today' | 'sessions' | 'approve'
const TAB_LABEL: Record<Tab, string> = { chat: 'Chat', today: 'Today', sessions: 'Sessions', approve: 'Approve' }

interface Props {
  mode: ButlerMode
  visible: boolean
  pinned: boolean
  phoneConnected: boolean
  chatFontSize?: number
  /** Left edge of the page mode (right of the project list). */
  pageLeft: number
  onClose: () => void
  onMode: (m: ButlerMode) => void
  onPin: (pinned: boolean) => void
  onOpenAgent: (row: SessionRow) => void
  onResumeAgent: (row: SessionRow) => void
  setupMarks: Record<string, SetupMark>
  setupCardHidden: boolean
  onContinueSetup: (stepId: string) => void
  onHideSetup: () => void
}

const DOT = { working: 'bg-status-working', waiting: 'bg-status-waiting', off: 'bg-status-done' } as const

/**
 * Butler's chat and the sessions overview. One element for both the drawer
 * and the page pinned under the project list, so the chat never remounts.
 * The chat itself is a plain HiveChat in ~/.hive/butler (its CLAUDE.md has
 * the rules); it is mounted the first time the panel opens.
 */
export function ButlerPanel(p: Props) {
  const [tab, setTab] = useState<Tab>('chat')
  const [approvals, setApprovals] = useState<Array<{ id: string; kind: string; title: string; subtitle: string; draft: string; action: string }>>([])
  const [folder, setFolder] = useState<string | null>(null)
  const [rows, setRows] = useState<SessionRow[]>([])
  const [mounted, setMounted] = useState(false)

  useEffect(() => { if (p.visible) setMounted(true) }, [p.visible])
  useEffect(() => {
    if (!mounted || folder) return
    window.api.butler.folder().then(setFolder).catch(() => { /* main not ready */ })
  }, [mounted, folder])
  useEffect(() => {
    if (!mounted) return
    window.api.approvals.list().then(setApprovals).catch(() => {})
    return window.api.approvals.onChange(setApprovals)
  }, [mounted])
  useEffect(() => {
    if (!p.visible) return
    let alive = true
    const load = () => window.api.butler.agents().then(r => { if (alive) setRows(orderSessions(r)) }).catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [p.visible])

  if (!mounted) return null
  const setup = setupProgress(p.setupMarks)
  const n = sessionCounts(rows)
  const waiting = rows.filter(r => r.activity === 'waiting')
  const box = p.mode === 'drawer'
    ? { top: 10, right: 10, bottom: 10, width: 420 }
    : { top: 10, right: 10, bottom: 10, left: p.pageLeft }

  return (
    <div
      role="complementary"
      aria-label="Butler panel"
      // no-drag over the whole panel: it floats above column headers that
      // are window drag regions, which would otherwise swallow its clicks.
      className="no-drag hive-card fixed z-40 flex flex-col overflow-hidden shadow-e3"
      style={{ ...box, display: p.visible ? 'flex' : 'none' }}
    >
      <div className="hive-head gap-2">
        <h2 className="hive-head-title flex items-center gap-2 min-w-0">
          <span className="w-[22px] h-[22px] rounded-full bg-accent-subtle inline-flex items-center justify-center text-[13px]">🎩</span>
          Butler
          {p.phoneConnected && <span className="hive-head-sub !ml-0 text-status-working">📱</span>}
        </h2>
        <div className="no-drag flex items-center gap-1">
          {p.mode === 'page' ? (
            <button onClick={() => p.onPin(!p.pinned)} aria-pressed={p.pinned} title={p.pinned ? 'Unpin' : 'Pin to the project list'}
              className={`h-7 px-2 rounded-lg text-[12px] font-semibold cursor-pointer ${p.pinned ? 'bg-accent-subtle text-accent' : 'text-text-muted hover:bg-bg-hover'}`}>📌 {p.pinned ? 'Pinned' : 'Pin'}</button>
          ) : (
            <button onClick={() => p.onMode('page')} title="Open as a page" aria-label="Open as a page"
              className="w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer">⤢</button>
          )}
          {p.mode === 'page' && (
            <button onClick={() => p.onMode('drawer')} title="Back to the side panel" aria-label="Back to the side panel"
              className="w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer">⤡</button>
          )}
          <button onClick={p.onClose} aria-label="Close Butler" className="w-7 h-7 rounded-lg text-text-muted hover:bg-bg-hover cursor-pointer">✕</button>
        </div>
      </div>

      <div className="no-drag flex gap-0.5 px-3 pb-1" role="tablist">
        {(Object.keys(TAB_LABEL) as Tab[]).map(t => {
          const count = t === 'sessions' ? n.waiting : t === 'approve' ? approvals.length : 0
          return (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold cursor-pointer inline-flex items-center gap-1 ${tab === t ? 'bg-accent-subtle text-accent' : 'text-text-muted hover:text-text-primary'}`}>
              {TAB_LABEL[t]}
              {count > 0 && <span className="min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold inline-flex items-center justify-center">{count}</span>}
            </button>
          )
        })}
      </div>

      <div className="flex-1 min-h-0 relative" style={{ display: tab === 'chat' ? 'flex' : 'none', flexDirection: 'column' }}>
        {!p.setupCardHidden && setup.open.length > 0 && (
          <div className="mx-3 mt-1 mb-1 px-3 py-2.5 rounded-xl bg-accent-subtle flex flex-col gap-1.5" aria-label="Setup progress">
            <div className="flex items-center justify-between text-[12px] font-bold text-text-primary">
              <span>Setup {setup.done}/{setup.total}</span>
              <button onClick={p.onHideSetup} className="text-[12px] font-semibold text-accent cursor-pointer">Hide</button>
            </div>
            <div className="h-1 rounded-full bg-bg-secondary overflow-hidden"><i className="block h-full bg-accent" style={{ width: `${(setup.done / Math.max(1, setup.total)) * 100}%` }} /></div>
            {setup.open.slice(0, 2).map(s => (
              <div key={s.id} className="flex items-center gap-2 text-[12px] text-text-primary">
                <span className="flex-1">{s.name}</span>
                <button onClick={() => p.onContinueSetup(s.id)} aria-label={`Set up ${s.name}`} className="px-2.5 py-0.5 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer">Set up</button>
              </div>
            ))}
          </div>
        )}
        {waiting.length > 0 && (
          <div className="mx-3 mt-1 mb-1 flex flex-col gap-1">
            {waiting.slice(0, 2).map(r => (
              <div key={r.agentId} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-bg-primary text-[13px]">
                <span className="w-[7px] h-[7px] rounded-full bg-status-waiting flex-shrink-0" />
                <span className="flex-1 min-w-0 truncate font-semibold text-text-primary">{r.agent} <span className="font-normal text-text-muted">· {r.project}</span></span>
                <button onClick={() => p.onOpenAgent(r)} className="px-2.5 py-1 rounded-lg bg-accent text-text-on-purple text-[12px] font-semibold cursor-pointer">Answer</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 min-h-0 relative">
          {folder && (
            <HiveChat
              id="chat-butler"
              cwd={folder}
              agentName="Butler"
              visible={p.visible && tab === 'chat'}
              autoResume
              chatFontSize={p.chatFontSize}
            />
          )}
        </div>
      </div>

      {tab === 'approve' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-2">
          <ApprovalsList items={approvals} />
        </div>
      )}

      {/* [butler:mail-routines] Today tab body */}
      {tab === 'today' && <TodayTab visible={p.visible} />}

      {tab === 'sessions' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col gap-2">
          <div className="grid grid-cols-3 gap-1.5">
            {(['working', 'waiting', 'off'] as const).map(k => (
              <div key={k} className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-bg-primary text-[11px] font-semibold text-text-muted">
                <span className={`w-[7px] h-[7px] rounded-full ${DOT[k]}`} />
                <b className="text-[18px] text-text-primary">{n[k]}</b>{k}
              </div>
            ))}
          </div>
          {rows.map(r => (
            <div key={r.agentId} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-bg-primary text-[13px]">
              <span className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${DOT[r.activity]}`} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-text-primary truncate">{r.agent}</div>
                <div className="text-[11px] text-text-muted truncate">{r.project} · {r.activity}</div>
              </div>
              {r.activity === 'off' ? (
                <button onClick={() => p.onResumeAgent(r)} aria-label={`Resume ${r.agent}`} className="px-2.5 py-1 rounded-lg bg-bg-secondary border border-border text-text-primary text-[12px] font-semibold cursor-pointer">Resume</button>
              ) : (
                <button onClick={() => p.onOpenAgent(r)} aria-label={`${r.activity === 'waiting' ? 'Answer' : 'Open'} ${r.agent}`} className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold cursor-pointer ${r.activity === 'waiting' ? 'bg-accent text-text-on-purple' : 'bg-bg-secondary border border-border text-text-primary'}`}>{r.activity === 'waiting' ? 'Answer' : 'Open'}</button>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="text-[12px] text-text-muted px-1">No agents yet</div>}
        </div>
      )}
    </div>
  )
}
