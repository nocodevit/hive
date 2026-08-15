/**
 * HandoffModal (v2.1.0) — user-facing entry to autonomous /goal runs.
 *
 * Design: developer-free by default. The visible surface is just goal +
 * three rope buttons. Underlying knobs (max turns, max cost, wall time)
 * are inferred from the rope preset and only revealed via ⚙︎ Show advanced.
 *
 * When Go fires: calls window.api.handoff.start with the input; the
 * supervisor spawns claude and pushes progress events to HandoffBanner.
 * This modal only kicks off — it does NOT track running state.
 */
import { useState, type CSSProperties } from 'react'
import Modal from './Modal'

export type RopeKey = 'quick' | 'normal' | 'marathon'

export interface HandoffPreset {
  key: RopeKey
  label: string
  desc: string
  maxTurns: number
  maxCostUsd: number
  maxWallTimeMs: number
}

export const HANDOFF_PRESETS: HandoffPreset[] = [
  { key: 'quick',    label: 'Quick',    desc: '~15 min · ~$1',  maxTurns: 15,  maxCostUsd: 1,  maxWallTimeMs: 15 * 60 * 1000 },
  { key: 'normal',   label: 'Normal',   desc: '~2 hours · ~$5', maxTurns: 60,  maxCostUsd: 5,  maxWallTimeMs: 2 * 60 * 60 * 1000 },
  { key: 'marathon', label: 'Marathon', desc: '~8 hours · ~$20',maxTurns: 200, maxCostUsd: 20, maxWallTimeMs: 8 * 60 * 60 * 1000 }
]

export interface HandoffModalProps {
  open: boolean
  agentId: string
  agentName: string
  cwd: string
  onCancel: () => void
  onStarted: (runId: string) => void
}

export default function HandoffModal({ open, agentId, agentName, cwd, onCancel, onStarted }: HandoffModalProps) {
  const [goal, setGoal] = useState('')
  const [rope, setRope] = useState<RopeKey>('normal')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preset = HANDOFF_PRESETS.find(p => p.key === rope)!
  const canGo = goal.trim().length > 0 && !starting

  const handleGo = async () => {
    if (!canGo) return
    setStarting(true)
    setError(null)
    try {
      const res = await (window as any).api.handoff.start({ agentId, cwd, goal: goal.trim(), rope })
      if (res?.ok && res.runId) {
        setGoal('')
        setStarting(false)
        onStarted(res.runId)
      } else {
        setError(res?.error || 'unknown error')
        setStarting(false)
      }
    } catch (e) {
      setError(String(e))
      setStarting(false)
    }
  }

  return (
    <Modal open={open} onClose={onCancel} title={`Hand off to ${agentName}`}>
      <div>
        <div style={{ fontSize: 11, color: '#858392', marginBottom: 16 }}>
          Agent runs /goal until done or a circuit breaker trips.
        </div>

        <label style={labelStyle}>What do you want done?</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. All tests in test/auth pass and lint is clean"
          rows={4}
          maxLength={4000}
          disabled={starting}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: 10, marginBottom: 16,
            background: '#2D2C35', color: '#FFFAF1',
            border: '1px solid #3A3943', borderRadius: 6,
            fontFamily: 'inherit', fontSize: 13, resize: 'vertical' as const
          }}
        />

        <label style={labelStyle}>How much rope?</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {HANDOFF_PRESETS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setRope(p.key)}
              disabled={starting}
              style={ropeButtonStyle(rope === p.key)}
            >
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.label}</div>
              <div style={{ fontSize: 10, opacity: 0.75, marginTop: 2 }}>{p.desc}</div>
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            style={{
              background: 'transparent', border: 'none',
              color: '#858392', fontSize: 11, cursor: 'pointer',
              padding: 0, fontFamily: 'inherit'
            }}
          >
            {showAdvanced ? '▾' : '▸'} Show advanced
          </button>
          {showAdvanced && (
            <div style={{
              marginTop: 8, padding: 10,
              background: '#201F26', borderRadius: 4,
              fontSize: 11, color: '#DFDBDD', fontFamily: 'monospace'
            }}>
              <div>max turns: <span style={{ color: '#FF60FF' }}>{preset.maxTurns}</span></div>
              <div>max cost: <span style={{ color: '#FF60FF' }}>${preset.maxCostUsd.toFixed(2)}</span></div>
              <div>max wall time: <span style={{ color: '#FF60FF' }}>{Math.round(preset.maxWallTimeMs / 60_000)} min</span></div>
              <div>evaluator: <span style={{ color: '#FF60FF' }}>Haiku</span> (native /goal check)</div>
              <div style={{ marginTop: 6, opacity: 0.6, fontSize: 10 }}>
                Any single breaker trips → SIGTERM claude.
              </div>
            </div>
          )}
        </div>

        {error && (
          <div style={{
            padding: 10, marginBottom: 12,
            background: 'rgba(235,66,104,0.10)',
            border: '1px solid #EB4268',
            borderRadius: 4, color: '#EB4268', fontSize: 12
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={starting}
            style={cancelButtonStyle}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGo}
            disabled={!canGo}
            style={goButtonStyle(canGo)}
          >
            {starting ? 'Starting…' : 'Go'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

const labelStyle: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: '#DFDBDD', marginBottom: 6, letterSpacing: 0.3
}

function ropeButtonStyle(selected: boolean): CSSProperties {
  return {
    flex: 1, padding: '10px 12px',
    background: selected ? '#6B50FF' : '#2D2C35',
    color: selected ? '#FFFAF1' : '#DFDBDD',
    border: `1px solid ${selected ? '#6B50FF' : '#3A3943'}`,
    borderRadius: 6, cursor: 'pointer',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    transition: 'background 120ms, border-color 120ms'
  }
}

const cancelButtonStyle: CSSProperties = {
  padding: '8px 14px',
  background: 'transparent', color: '#DFDBDD',
  border: '1px solid #3A3943', borderRadius: 6,
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13
}

function goButtonStyle(enabled: boolean): CSSProperties {
  return {
    padding: '8px 18px',
    background: enabled ? '#6B50FF' : '#3A3943',
    color: '#FFFAF1',
    border: 'none', borderRadius: 6,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    opacity: enabled ? 1 : 0.5
  }
}
