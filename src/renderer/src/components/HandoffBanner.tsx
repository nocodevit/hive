/**
 * HandoffBanner (v2.1.0) — sticky status strip shown at the top of a chat
 * while its agent has an active handoff. Subscribes to handoff:progress +
 * handoff:done events and tears itself down when the run terminates.
 *
 * One row: status, elapsed · turn · cost, the goal, Details, Stop.
 * Details expands in place (full goals + runId).
 * Matches HandoffModal's "developer-free by default" principle.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { confirmDialog } from './ConfirmDialog'
import { CHAT, CRUSH, FONT_MONO, FONT_PROSE, accentTint } from './hive-chat/crush-styles'

export interface HandoffLiveState {
  runId: string
  agentId: string
  chatId?: string
  status: 'running' | 'paused' | 'compacting' | 'done' | 'stopped' | 'failed'
  turnCount: number
  totalCostUsd: number
  startedAt: number
  elapsedMs: number
  pausedMs?: number
  stopReason?: string
  askedQuestion?: { question: string; options?: Array<{ label: string; description?: string }> }
  /**
   * v2.15.5: goals the user typed at handoff start. Ships from main via
   * emitProgress so the running banner's ⓘ detail can echo them back —
   * "handoff running 好久了, 我目标是啥来着" was the exact user gripe.
   */
  goals?: string[]
  stats?: {
    filesEdited: string[]
    commits: Array<{ sha?: string; msg: string }>
    lastTestRun?: { command: string; passed?: number; failed?: number; ok: boolean }
    toolErrorsRecovered: number
    autoCompactCount?: number       // v2.5.0
    autoCompactCostUsd?: number     // v2.5.0
  }
}

export interface HandoffBannerProps {
  agentId: string
  /** Called when user picks "New goal from here" in the pause UI — parent
   * opens the Handoff modal seeded with current context. */
  onRequestNewGoal?: () => void
}

export default function HandoffBanner({ agentId, onRequestNewGoal }: HandoffBannerProps) {
  const [state, setState] = useState<HandoffLiveState | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [finalState, setFinalState] = useState<HandoffLiveState | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // Hydrate on mount: if a handoff is already running for this agent
  // (e.g. Hive reloaded mid-run), pick it up from the supervisor snapshot.
  // Guard on optional-chained api.handoff so tests that don't stub the
  // handoff surface (usage-merge, ctx-resume specs, etc.) don't blow up
  // when HandoffBanner is transitively mounted inside HiveChat.
  useEffect(() => {
    const api = (window as any).api?.handoff
    if (!api?.list) return
    let cancelled = false
    api.list().then((all: HandoffLiveState[]) => {
      if (cancelled) return
      const mine = all.find(h => h.agentId === agentId && h.status === 'running')
      if (mine) setState(mine)
    }).catch(() => { /* silent */ })
    return () => { cancelled = true }
  }, [agentId])

  useEffect(() => {
    const api = (window as any).api?.handoff
    if (!api?.onProgress || !api?.onDone) return
    const off1 = api.onProgress((s: HandoffLiveState) => {
      if (s.agentId !== agentId) return
      setState(s)
      setDismissed(false)
    })
    const off2 = api.onDone((s: HandoffLiveState) => {
      if (s.agentId !== agentId) return
      setState(null)
      setFinalState(s)
    })
    // v2.3.0: dedicated pause event (AskUserQuestion detected → agent
    // paused, needs your answer). Same state update as progress.
    const off3 = api.onPaused?.((s: HandoffLiveState) => {
      if (s.agentId !== agentId) return
      setState(s)
      setDismissed(false)
    }) ?? (() => {})
    return () => { off1?.(); off2?.(); off3?.() }
  }, [agentId])

  // 1s heartbeat so elapsed clock ticks even between turns
  const [, force] = useState(0)
  useEffect(() => {
    if (!state || state.status !== 'running') return
    const iv = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(iv)
  }, [state])

  if (state && state.status === 'paused' && state.askedQuestion) {
    // v2.3.0: full pause UI with 3-button choice (Resume / Exit / New goal)
    return <PausedCard state={state} onNewGoal={onRequestNewGoal} />
  }
  if (state && (state.status === 'running' || state.status === 'paused' || state.status === 'compacting')) {
    return <RunningStrip state={state} expanded={expanded} onToggle={() => setExpanded(v => !v)} />
  }
  if (finalState && !dismissed) {
    return <FinalCard state={finalState} onDismiss={() => setDismissed(true)} />
  }
  return null
}

/**
 * v2.3.0 pause UI — shown when AskUserQuestion pause fires.
 * Three actions: Resume (default), Exit+report, New goal.
 * The question itself renders via the existing AskUserQuestionInline
 * flow in HiveChat; this card just adds the 3-button strip below.
 */
function PausedCard({ state, onNewGoal }: { state: HandoffLiveState; onNewGoal?: () => void }) {
  const [busy, setBusy] = useState<'resume' | 'exit' | null>(null)
  const onResume = async () => {
    setBusy('resume')
    try { await (window as any).api.handoff.resume(state.runId) } finally { setBusy(null) }
  }
  const onExit = async () => {
    setBusy('exit')
    try { await (window as any).api.handoff.stop(state.runId) } finally { setBusy(null) }
  }
  return (
    <div style={runningStripStyle}>
      <div style={rowStyle}>
        <Dot color={CRUSH.Zest} />
        <span style={titleStyle}>Handoff paused · needs your answer</span>
        <span style={metaStyle}>turn {state.turnCount} · ${state.totalCostUsd.toFixed(2)}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onResume} disabled={busy !== null} autoFocus style={primaryButtonStyle}>Resume</button>
        <button type="button" onClick={onExit} disabled={busy !== null} style={stopButtonStyle}>Exit + report</button>
        {onNewGoal && (
          <button type="button" onClick={onNewGoal} disabled={busy !== null} style={ghostButtonStyle}>New goal</button>
        )}
      </div>
    </div>
  )
}

function RunningStrip({ state, expanded, onToggle }: { state: HandoffLiveState; expanded: boolean; onToggle: () => void }) {
  const elapsedStr = formatDuration(Date.now() - state.startedAt)
  const paused = state.status === 'paused'
  const compacting = state.status === 'compacting'
  const label = compacting ? 'Handoff compacting' : paused ? 'Handoff paused (rate limit)' : 'Handoff running'
  const onStop = async () => {
    const ok = await confirmDialog({
      title: 'Stop this handoff?',
      message: 'Claude will get SIGTERM immediately. The /goal loop stops where it is; any un-committed work stays where the agent left it.',
      confirmLabel: 'Stop handoff',
      cancelLabel: 'Keep running'
    })
    if (!ok) return
    await (window as any).api.handoff.stop(state.runId)
  }
  // v2.15.5: the goal shows inline — it is the one thing you need on a
  // long-running strip. Details expand in place (no popover to be clipped).
  const goals = state.goals ?? []
  const goalPreview = goals.length === 0
    ? ''
    : goals.length === 1
      ? goals[0]
      : `${goals[0]} (+${goals.length - 1} more)`
  return (
    <div style={runningStripStyle}>
      <div style={rowStyle}>
        <Dot color={paused || compacting ? CRUSH.Zest : CHAT.accent} pulse={!paused} />
        <span style={titleStyle}>{label}</span>
        <span style={metaStyle}>{elapsedStr} · turn {state.turnCount} · ${state.totalCostUsd.toFixed(2)}</span>
        {goalPreview ? (
          <span
            data-testid="handoff-goal-inline"
            title={goals.join('\n\n')}
            style={{ flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: CHAT.ink2 }}
          >🎯 {goalPreview}</span>
        ) : <span style={{ flex: 1 }} />}
        <button
          type="button"
          onClick={onToggle}
          title={expanded ? 'Hide meta' : 'Show meta'}
          aria-label={expanded ? 'Hide handoff details' : 'Show handoff details'}
          aria-expanded={expanded}
          style={ghostButtonStyle}
        >{expanded ? 'Hide' : 'Details'}</button>
        <button type="button" onClick={onStop} style={stopButtonStyle}>Stop</button>
      </div>
      {expanded && (
        <div style={detailBoxStyle}>
          {goals.length > 0 && (
            <div data-testid="handoff-goal-full">
              <div style={sectionLabelStyle}>{goals.length === 1 ? 'goal:' : `goals (${goals.length}):`}</div>
              {goals.map((g, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: CHAT.ink, marginTop: i ? 6 : 0 }}>
                  {goals.length > 1 ? `${i + 1}. ` : ''}{g}
                </div>
              ))}
            </div>
          )}
          <div style={{ ...metaStyle, marginTop: goals.length ? 8 : 0, wordBreak: 'break-all' }}>
            runId: {state.runId}{state.stopReason ? ` · reason: ${state.stopReason}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function FinalCard({ state, onDismiss }: { state: HandoffLiveState; onDismiss: () => void }) {
  const ok = state.status === 'done'
  const [expanded, setExpanded] = useState(false)
  const stats = state.stats
  const hasDetails = !!stats && (stats.filesEdited.length > 0 || stats.commits.length > 0 || !!stats.lastTestRun || stats.toolErrorsRecovered > 0 || (stats.autoCompactCount ?? 0) > 0)
  const copySummary = () => {
    const lines: string[] = [
      `# Handoff ${state.status}`,
      `Duration: ${formatDuration(state.elapsedMs)} · Turns: ${state.turnCount} · Cost: $${state.totalCostUsd.toFixed(2)}`,
      state.stopReason ? `Reason: ${state.stopReason}` : '',
      stats?.filesEdited.length ? `\n## Files changed (${stats.filesEdited.length})\n${stats.filesEdited.map(f => `- ${f}`).join('\n')}` : '',
      stats?.commits.length ? `\n## Commits (${stats.commits.length})\n${stats.commits.map(c => `- ${c.msg}`).join('\n')}` : '',
      stats?.lastTestRun ? `\n## Last test run\n\`${stats.lastTestRun.command}\`\n${stats.lastTestRun.passed ?? '?'} passed / ${stats.lastTestRun.failed ?? '?'} failed` : '',
      stats?.toolErrorsRecovered ? `\nTool errors recovered: ${stats.toolErrorsRecovered}` : '',
      stats?.autoCompactCount ? `\nAuto-compacted ${stats.autoCompactCount}×, cost $${(stats.autoCompactCostUsd ?? 0).toFixed(2)}` : ''
    ].filter(Boolean)
    navigator.clipboard.writeText(lines.join('\n')).catch(() => { /* silent */ })
  }
  return (
    <div style={runningStripStyle}>
      {/* min-width:0 on the reason lets it shrink, so a long stopReason never
          pushes ✕ off the edge (2026-08-18: "X 根本关不上"). */}
      <div style={rowStyle}>
        <Dot color={ok ? CRUSH.Julep : CRUSH.Zest} />
        <span style={titleStyle}>Handoff {state.status}</span>
        <span style={metaStyle}>{formatDuration(state.elapsedMs)} · {state.turnCount} turn · ${state.totalCostUsd.toFixed(2)}</span>
        {state.stopReason ? (
          <span
            title={state.stopReason}
            style={{ flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: CHAT.ink2 }}
          >{state.stopReason}</span>
        ) : <span style={{ flex: 1 }} />}
        {hasDetails && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Hide handoff details' : 'Show handoff details'}
            aria-expanded={expanded}
            style={ghostButtonStyle}
          >{expanded ? 'Hide' : 'Details'}</button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss handoff summary"
          style={{ ...ghostButtonStyle, padding: '4px 8px' }}
        >✕</button>
      </div>
      {expanded && stats && (
        <div style={{ ...detailBoxStyle, maxHeight: 240, overflowY: 'auto' }}>
          {stats.filesEdited.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={sectionLabelStyle}>Files changed ({stats.filesEdited.length}):</div>
              {stats.filesEdited.slice(0, 20).map(f => <div key={f} style={monoLineStyle}>{f}</div>)}
              {stats.filesEdited.length > 20 && <div style={{ ...monoLineStyle, color: CHAT.muted }}>… +{stats.filesEdited.length - 20} more</div>}
            </div>
          )}
          {stats.commits.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={sectionLabelStyle}>Commits ({stats.commits.length}):</div>
              {stats.commits.slice(-5).map((c, i) => <div key={i} style={{ color: CHAT.ink }}>{c.msg}</div>)}
            </div>
          )}
          {stats.lastTestRun && (
            <div style={{ marginBottom: 8 }}>
              <div style={sectionLabelStyle}>Last test run:</div>
              <div style={{ color: CHAT.ink }}>
                {stats.lastTestRun.ok ? '✅' : '❌'} {stats.lastTestRun.passed ?? '?'} passed / {stats.lastTestRun.failed ?? '?'} failed
              </div>
              <div style={{ ...monoLineStyle, color: CHAT.muted }}>{stats.lastTestRun.command}</div>
            </div>
          )}
          {stats.toolErrorsRecovered > 0 && (
            <div style={{ color: CHAT.muted }}>Tool errors recovered: {stats.toolErrorsRecovered}</div>
          )}
          {(stats.autoCompactCount ?? 0) > 0 && (
            <div style={{ color: CHAT.muted, marginTop: 4 }}>
              Auto-compacted <b>{stats.autoCompactCount}×</b> · cost <b>${(stats.autoCompactCostUsd ?? 0).toFixed(2)}</b>
            </div>
          )}
          <button type="button" onClick={copySummary} style={{ ...ghostButtonStyle, marginTop: 8 }}>Copy summary</button>
        </div>
      )}
    </div>
  )
}

function Dot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span aria-hidden style={{
      width: 8, height: 8, borderRadius: 9999, background: color, flexShrink: 0,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 25%, transparent)`,
      animation: pulse ? 'hive-handoff-pulse 1.6s ease-in-out infinite' : undefined
    }} />
  )
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

// paddingRight 56px keeps the right-most button clear of the floating ↓
// scroll-to-bottom arrow (32 wide + 16 right offset + 8 gap). v2.5.1:
// "handoff x 因为和 bottom 的箭头重合了，所以按不到".
const runningStripStyle: CSSProperties = {
  margin: '0 20px 10px',
  padding: '8px 56px 8px 14px',
  borderRadius: 14,
  background: accentTint(8),
  color: CHAT.ink2,
  fontFamily: FONT_PROSE, fontSize: 13, lineHeight: 1.5,
  minWidth: 0
}

const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 10, rowGap: 6, minWidth: 0 }

const titleStyle: CSSProperties = { color: CHAT.ink, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }

const metaStyle: CSSProperties = { fontFamily: FONT_MONO, fontSize: 11, color: CHAT.muted, flexShrink: 0, whiteSpace: 'nowrap' }

const sectionLabelStyle: CSSProperties = { fontSize: 11, color: CHAT.muted, marginBottom: 2 }

const monoLineStyle: CSSProperties = { fontFamily: FONT_MONO, fontSize: 11, color: CHAT.ink, wordBreak: 'break-all' }

const buttonBase: CSSProperties = {
  flexShrink: 0, borderRadius: 10, padding: '4px 12px',
  fontFamily: FONT_PROSE, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'
}

const ghostButtonStyle: CSSProperties = { ...buttonBase, background: 'transparent', color: CHAT.ink2, border: `1px solid ${CRUSH.Charcoal}` }

const primaryButtonStyle: CSSProperties = { ...buttonBase, background: CRUSH.Charple, color: '#FFFFFF', border: 'none' }

const stopButtonStyle: CSSProperties = { ...buttonBase, background: 'transparent', color: CRUSH.Sriracha, border: `1px solid color-mix(in srgb, ${CRUSH.Sriracha} 45%, transparent)` }

const detailBoxStyle: CSSProperties = {
  marginTop: 8, padding: '8px 12px', borderRadius: 10,
  background: CHAT.surface, fontSize: 12.5
}
