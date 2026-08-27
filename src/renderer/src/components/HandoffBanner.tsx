/**
 * HandoffBanner (v2.1.0) — sticky status strip shown at the top of a chat
 * while its agent has an active handoff. Subscribes to handoff:progress +
 * handoff:done events and tears itself down when the run terminates.
 *
 * Deliberately minimal in the default view: elapsed clock + Stop button.
 * The click-ⓘ toggle expands to show turn/cost meters + goal + runId.
 * Matches HandoffModal's "developer-free by default" principle.
 */
import { useEffect, useState, type CSSProperties } from 'react'

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
    <div style={{ ...runningStripStyle, background: 'rgba(232,254,150,0.10)', borderColor: '#E8FE96', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>🤔</span>
        <span style={{ fontWeight: 600, color: '#E8FE96', flexShrink: 0 }}>Handoff paused — agent asked a question</span>
        <span style={{ opacity: 0.7, flexShrink: 0 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
          turn {state.turnCount} · ${state.totalCostUsd.toFixed(2)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button type="button" onClick={onResume} disabled={busy !== null} autoFocus style={{
          padding: '3px 10px', background: '#00FFB2', color: '#150e24',
          border: 'none', borderRadius: 3, fontSize: 11, fontWeight: 600,
          cursor: busy === null ? 'pointer' : 'wait', fontFamily: 'inherit'
        }}>▶ Resume</button>
        <button type="button" onClick={onExit} disabled={busy !== null} style={{
          padding: '3px 10px', background: '#EB4268', color: '#FFFAF1',
          border: 'none', borderRadius: 3, fontSize: 11, fontWeight: 600,
          cursor: busy === null ? 'pointer' : 'wait', fontFamily: 'inherit'
        }}>✕ Exit + report</button>
        {onNewGoal && (
          <button type="button" onClick={onNewGoal} disabled={busy !== null} style={{
            padding: '3px 10px', background: 'transparent', color: '#DFDBDD',
            border: '1px solid #3A3943', borderRadius: 3, fontSize: 11,
            cursor: busy === null ? 'pointer' : 'wait', fontFamily: 'inherit'
          }}>↻ New goal</button>
        )}
      </div>
    </div>
  )
}

function RunningStrip({ state, expanded, onToggle }: { state: HandoffLiveState; expanded: boolean; onToggle: () => void }) {
  const elapsedNow = Date.now() - state.startedAt
  const elapsedStr = formatDuration(elapsedNow)
  const paused = state.status === 'paused'
  const compacting = state.status === 'compacting'
  const label = compacting
    ? 'Handoff auto-compacting (context ≥ 70%)…'
    : paused ? 'Handoff paused (rate-limit)' : 'Handoff running'
  const icon = compacting ? '⏳' : paused ? '⏸' : '🥴'
  const color = compacting ? '#E8FE96' : paused ? '#E8FE96' : '#FF60FF'
  const onStop = async () => {
    if (!confirm('Stop this handoff? Claude will get SIGTERM immediately.')) return
    await (window as any).api.handoff.stop(state.runId)
  }
  // v2.15.5: user complaint 'handoff running 的 detail 应该 show goal 我输入的
  // 内容, 不然我忘了'. Show the goal INLINE (not just behind ⓘ) — the running
  // banner is a long-lived HUD, hunting for a click-to-expand for the most
  // important piece of context is wrong. First goal truncated to ~80 chars
  // shows on the strip; ⓘ expand keeps full multi-goal detail + runId.
  const goals = state.goals ?? []
  const goalPreview = goals.length === 0
    ? ''
    : goals.length === 1
      ? goals[0]
      : `${goals[0]} (+${goals.length - 1} more)`
  return (
    <div style={{ ...runningStripStyle, background: (paused || compacting) ? 'rgba(232,254,150,0.10)' : 'rgba(255,96,255,0.10)', borderColor: color, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontWeight: 600, color, flexShrink: 0 }}>{label}</span>
        <span style={{ opacity: 0.7, flexShrink: 0 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>{elapsedStr}</span>
        <span style={{ opacity: 0.7, flexShrink: 0 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>turn {state.turnCount}</span>
        <span style={{ opacity: 0.7, flexShrink: 0 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>${state.totalCostUsd.toFixed(2)}</span>
        {goalPreview && (
          <>
            <span style={{ opacity: 0.7, flexShrink: 0 }}>·</span>
            <span
              data-testid="handoff-goal-inline"
              title={goals.join('\n\n')}
              style={{
                fontSize: 11,
                fontStyle: 'italic',
                opacity: 0.9,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: '#DFDBDD'
              }}
            >🎯 {goalPreview}</span>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? 'Hide meta' : 'Show meta'}
        style={{ ...infoButtonStyle, flexShrink: 0 }}
      >
        ⓘ
      </button>
      <button
        type="button"
        onClick={onStop}
        style={{ ...stopButtonStyle, flexShrink: 0 }}
      >
        Stop
      </button>
      {expanded && (
        <div style={metaBoxStyle}>
          {goals.length > 0 && (
            <div data-testid="handoff-goal-full" style={{ marginBottom: 6 }}>
              <div style={{ opacity: 0.6, marginBottom: 2 }}>
                {goals.length === 1 ? 'goal:' : `goals (${goals.length}):`}
              </div>
              {goals.map((g, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingLeft: 8 }}>
                  {goals.length > 1 ? `${i + 1}. ` : ''}{g}
                </div>
              ))}
            </div>
          )}
          <div>runId: {state.runId}</div>
          {state.stopReason && <div>reason: {state.stopReason}</div>}
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
    <div style={{ ...runningStripStyle, background: ok ? 'rgba(0,255,178,0.10)' : 'rgba(232,254,150,0.10)', borderColor: ok ? '#00FFB2' : '#E8FE96', flexWrap: 'wrap' }}>
      {/* min-width:0 lets the flex child shrink; without it, a long
          stopReason (e.g. "hit cost cap $5.00 (spent $5.02)") pushes
          the ✕ button off the right edge and the card becomes
          undismissable. Reported by user 2026-08-18: "X 根本关不上". */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 14, flexShrink: 0 }}>{ok ? '✅' : '⚠️'}</span>
        <span style={{ fontWeight: 600, color: ok ? '#00FFB2' : '#E8FE96', flexShrink: 0 }}>
          Handoff {state.status}
        </span>
        <span style={{ opacity: 0.7, flexShrink: 0 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>
          {formatDuration(state.elapsedMs)} · {state.turnCount} turn · ${state.totalCostUsd.toFixed(2)}
        </span>
        {state.stopReason && (
          <>
            <span style={{ opacity: 0.7, flexShrink: 0 }}>·</span>
            <span
              title={state.stopReason}
              style={{
                fontSize: 11,
                opacity: 0.9,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >{state.stopReason}</span>
          </>
        )}
      </div>
      {hasDetails && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-label={expanded ? 'Hide handoff details' : 'Show handoff details'}
          style={{ ...infoButtonStyle, flexShrink: 0 }}
        >{expanded ? '▾' : '▸'} details</button>
      )}
      {/* flexShrink:0 guarantees the dismiss button never gets pushed
          off-screen regardless of the leftside content width. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss handoff summary"
        style={{ ...infoButtonStyle, flexShrink: 0 }}
      >✕</button>
      {expanded && stats && (
        <div style={{
          flexBasis: '100%',
          marginTop: 8,
          padding: '8px 10px',
          background: 'rgba(0,0,0,0.25)',
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#DFDBDD',
          maxHeight: 220,
          overflowY: 'auto'
        }}>
          {stats.filesEdited.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>Files changed ({stats.filesEdited.length}):</div>
              {stats.filesEdited.slice(0, 20).map(f => <div key={f} style={{ paddingLeft: 8 }}>· {f}</div>)}
              {stats.filesEdited.length > 20 && <div style={{ paddingLeft: 8, opacity: 0.6 }}>… +{stats.filesEdited.length - 20} more</div>}
            </div>
          )}
          {stats.commits.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>Commits ({stats.commits.length}):</div>
              {stats.commits.slice(-5).map((c, i) => <div key={i} style={{ paddingLeft: 8 }}>· {c.msg}</div>)}
            </div>
          )}
          {stats.lastTestRun && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ opacity: 0.7, marginBottom: 2 }}>Last test run:</div>
              <div style={{ paddingLeft: 8 }}>
                {stats.lastTestRun.ok ? '✅' : '❌'} {stats.lastTestRun.passed ?? '?'} passed / {stats.lastTestRun.failed ?? '?'} failed
                <div style={{ opacity: 0.6, fontSize: 10 }}>{stats.lastTestRun.command}</div>
              </div>
            </div>
          )}
          {stats.toolErrorsRecovered > 0 && (
            <div style={{ opacity: 0.7 }}>Tool errors recovered: {stats.toolErrorsRecovered}</div>
          )}
          {(stats.autoCompactCount ?? 0) > 0 && (
            <div style={{ opacity: 0.7, marginTop: 4 }}>
              Auto-compacted <b>{stats.autoCompactCount}×</b> · cost <b>${(stats.autoCompactCostUsd ?? 0).toFixed(2)}</b>
            </div>
          )}
          <button
            type="button"
            onClick={copySummary}
            style={{ marginTop: 6, padding: '2px 8px', background: 'transparent', color: '#DFDBDD', border: '1px solid #3A3943', borderRadius: 3, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}
          >Copy summary</button>
        </div>
      )}
    </div>
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

const runningStripStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  // v2.5.1: paddingRight bumped to 56px so the ✕ dismiss button
  // never sits under the floating ↓ scroll-to-bottom arrow (which
  // is `position:absolute; right:16; top:-42; width:32` inside the
  // input area, i.e. hovers up 42px into the banner strip region).
  // 32 (arrow width) + 16 (its right offset) + 8 (safe gap) = 56.
  // User: "handoff x 因为和 bottom 的箭头重合了，所以按不到".
  padding: '6px 56px 6px 12px',
  background: 'rgba(255,96,255,0.10)',
  border: '1px solid #FF60FF',
  borderRadius: 4,
  fontSize: 12, color: '#FFFAF1', fontFamily: 'inherit',
  position: 'relative' as const,
  margin: '4px 8px',
  minWidth: 0  // container must allow shrink so inner min-w-0 works
}

const infoButtonStyle: CSSProperties = {
  background: 'transparent', border: 'none',
  color: '#DFDBDD', fontSize: 12, cursor: 'pointer',
  padding: '2px 6px', fontFamily: 'inherit'
}

const stopButtonStyle: CSSProperties = {
  padding: '3px 10px',
  background: '#EB4268', color: '#FFFAF1',
  border: 'none', borderRadius: 3,
  fontSize: 11, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit'
}

const metaBoxStyle: CSSProperties = {
  position: 'absolute' as const,
  top: '100%', right: 8,
  marginTop: 4,
  padding: 8,
  background: '#201F26',
  border: '1px solid #3A3943',
  borderRadius: 4,
  fontFamily: 'monospace' as const,
  fontSize: 10,
  color: '#DFDBDD',
  zIndex: 30,
  minWidth: 260
}
