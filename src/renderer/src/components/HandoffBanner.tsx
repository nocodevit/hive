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
  status: 'running' | 'paused' | 'done' | 'stopped' | 'failed'
  turnCount: number
  totalCostUsd: number
  startedAt: number
  elapsedMs: number
  pausedMs?: number
  stopReason?: string
}

export interface HandoffBannerProps {
  agentId: string
}

export default function HandoffBanner({ agentId }: HandoffBannerProps) {
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
    return () => { off1?.(); off2?.() }
  }, [agentId])

  // 1s heartbeat so elapsed clock ticks even between turns
  const [, force] = useState(0)
  useEffect(() => {
    if (!state || state.status !== 'running') return
    const iv = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(iv)
  }, [state])

  if (state && (state.status === 'running' || state.status === 'paused')) {
    return <RunningStrip state={state} expanded={expanded} onToggle={() => setExpanded(v => !v)} />
  }
  if (finalState && !dismissed) {
    return <FinalCard state={finalState} onDismiss={() => setDismissed(true)} />
  }
  return null
}

function RunningStrip({ state, expanded, onToggle }: { state: HandoffLiveState; expanded: boolean; onToggle: () => void }) {
  const elapsedNow = Date.now() - state.startedAt
  const elapsedStr = formatDuration(elapsedNow)
  const paused = state.status === 'paused'
  const label = paused ? 'Handoff paused (rate-limit)' : 'Handoff running'
  const icon = paused ? '⏸' : '🥴'
  const color = paused ? '#E8FE96' : '#FF60FF'
  const onStop = async () => {
    if (!confirm('Stop this handoff? Claude will get SIGTERM immediately.')) return
    await (window as any).api.handoff.stop(state.runId)
  }
  return (
    <div style={{ ...runningStripStyle, background: paused ? 'rgba(232,254,150,0.10)' : 'rgba(255,96,255,0.10)', borderColor: color }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontWeight: 600, color }}>{label}</span>
        <span style={{ opacity: 0.7 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{elapsedStr}</span>
        <span style={{ opacity: 0.7 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>turn {state.turnCount}</span>
        <span style={{ opacity: 0.7 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>${state.totalCostUsd.toFixed(2)}</span>
      </div>
      <button
        type="button"
        onClick={onToggle}
        title={expanded ? 'Hide meta' : 'Show meta'}
        style={infoButtonStyle}
      >
        ⓘ
      </button>
      <button
        type="button"
        onClick={onStop}
        style={stopButtonStyle}
      >
        Stop
      </button>
      {expanded && (
        <div style={metaBoxStyle}>
          <div>runId: {state.runId}</div>
          {state.stopReason && <div>reason: {state.stopReason}</div>}
        </div>
      )}
    </div>
  )
}

function FinalCard({ state, onDismiss }: { state: HandoffLiveState; onDismiss: () => void }) {
  const ok = state.status === 'done'
  return (
    <div style={{ ...runningStripStyle, background: ok ? 'rgba(0,255,178,0.10)' : 'rgba(232,254,150,0.10)', borderColor: ok ? '#00FFB2' : '#E8FE96' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        <span style={{ fontSize: 14 }}>{ok ? '✅' : '⚠️'}</span>
        <span style={{ fontWeight: 600, color: ok ? '#00FFB2' : '#E8FE96' }}>
          Handoff {state.status}
        </span>
        <span style={{ opacity: 0.7 }}>·</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {formatDuration(state.elapsedMs)} · {state.turnCount} turn · ${state.totalCostUsd.toFixed(2)}
        </span>
        {state.stopReason && (
          <>
            <span style={{ opacity: 0.7 }}>·</span>
            <span style={{ fontSize: 11, opacity: 0.9 }}>{state.stopReason}</span>
          </>
        )}
      </div>
      <button type="button" onClick={onDismiss} style={infoButtonStyle}>✕</button>
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
  padding: '6px 12px',
  background: 'rgba(255,96,255,0.10)',
  border: '1px solid #FF60FF',
  borderRadius: 4,
  fontSize: 12, color: '#FFFAF1', fontFamily: 'inherit',
  position: 'relative' as const,
  margin: '4px 8px'
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
