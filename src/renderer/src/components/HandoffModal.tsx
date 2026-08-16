/**
 * HandoffModal (v2.2.0 — checkbox layout, chat-inject backend).
 *
 * v2.1.0 had rope-radio + single-goal-textarea shape. v2.2.0 exposes
 * every knob directly:
 *   - Goal: multi-select preset checkboxes + always-visible free text
 *     (any checked = one condition, joined with AND ALSO by the supervisor)
 *   - Breakers: 5 independent toggles with inline numeric / path inputs
 *   - Quick / Normal / Marathon: preset-autofill buttons (check +
 *     populate the 3 numeric breakers), user can still adjust after
 *
 * Two implicit defaults (surfaced as small grey text, no toggle):
 *   - Permissions auto-allowed while handoff is running (renderer side)
 *   - 5h rate-limit auto-resume (inherited from chat's own auto-continue)
 *
 * Submits via window.api.handoff.start({chatId, goals, breakers}).
 */
import { useState, type CSSProperties } from 'react'
import Modal from './Modal'

export type RopeKey = 'quick' | 'normal' | 'marathon'

export interface HandoffModalProps {
  open: boolean
  chatId: string
  agentName: string
  onCancel: () => void
  onStarted: (runId: string) => void
}

interface GoalPreset {
  key: string
  label: string
  needsSpecify: boolean
  render: (specify: string) => string  // final text sent as one goal fragment
}

export const GOAL_PRESETS: GoalPreset[] = [
  { key: 'feature', label: 'Feature done', needsSpecify: true,
    render: s => `feature is complete: ${s}` },
  { key: 'tests', label: 'Tests pass (npm test / vitest / etc.)', needsSpecify: false,
    render: () => 'the project test command exits 0 (npm test / vitest run / pytest — whichever this project uses)' },
  { key: 'lint', label: 'Lint clean', needsSpecify: false,
    render: () => 'the project lint command exits 0 with zero errors' }
]

interface RopePresetUI { key: RopeKey; label: string; hint: string; turns: number; cost: number; wallH: number }
export const ROPE_PRESETS: RopePresetUI[] = [
  { key: 'quick',    label: 'Quick',    hint: '~15m · ~$1',  turns: 15,  cost: 1,  wallH: 0.25 },
  { key: 'normal',   label: 'Normal',   hint: '~2h · ~$5',   turns: 60,  cost: 5,  wallH: 2 },
  { key: 'marathon', label: 'Marathon', hint: '~8h · ~$20',  turns: 200, cost: 20, wallH: 8 }
]

export default function HandoffModal({ open, chatId, agentName, onCancel, onStarted }: HandoffModalProps) {
  const [checkedPresets, setCheckedPresets] = useState<Set<string>>(new Set())
  const [presetSpecify, setPresetSpecify] = useState<Record<string, string>>({})
  const [freeText, setFreeText] = useState('')

  const [enableTurns, setEnableTurns] = useState(true)
  const [enableCost, setEnableCost] = useState(true)
  const [enableWall, setEnableWall] = useState(true)
  const [enableGate, setEnableGate] = useState(false)
  const [enableAskQ, setEnableAskQ] = useState(true)
  const [maxTurns, setMaxTurns] = useState(60)
  const [maxCost, setMaxCost] = useState(5)
  const [maxWallH, setMaxWallH] = useState(2)
  const [gatePath, setGatePath] = useState('')

  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyRope = (rope: RopeKey) => {
    const p = ROPE_PRESETS.find(r => r.key === rope)!
    setEnableTurns(true); setMaxTurns(p.turns)
    setEnableCost(true);  setMaxCost(p.cost)
    setEnableWall(true);  setMaxWallH(p.wallH)
  }

  const buildGoals = (): string[] => {
    const out: string[] = []
    for (const preset of GOAL_PRESETS) {
      if (!checkedPresets.has(preset.key)) continue
      if (preset.needsSpecify) {
        const s = (presetSpecify[preset.key] || '').trim()
        if (!s) continue
        out.push(preset.render(s))
      } else {
        out.push(preset.render(''))
      }
    }
    const free = freeText.trim()
    if (free) out.push(free)
    return out
  }

  const goals = buildGoals()
  const canGo = goals.length > 0 && !starting

  const handleGo = async () => {
    if (!canGo) return
    setStarting(true)
    setError(null)
    try {
      const breakers: Record<string, unknown> = {}
      if (enableTurns && maxTurns > 0) breakers.maxTurns = Math.floor(maxTurns)
      if (enableCost && maxCost > 0)   breakers.maxCostUsd = Number(maxCost)
      if (enableWall && maxWallH > 0)  breakers.maxWallTimeMs = Math.floor(maxWallH * 60 * 60 * 1000)
      if (enableGate && gatePath.trim()) breakers.gateScriptPath = gatePath.trim()
      if (enableAskQ) breakers.stopOnAskUserQuestion = true

      const res = await (window as any).api.handoff.start({ chatId, goals, breakers })
      if (res?.ok && res.runId) {
        setCheckedPresets(new Set()); setPresetSpecify({}); setFreeText('')
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

  const togglePreset = (key: string) => {
    setCheckedPresets(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Modal open={open} onClose={onCancel} title={`Hand off to ${agentName}`}>
      <div>
        <label style={sectionLabelStyle}>
          Goal <span style={{ opacity: 0.6, fontWeight: 400 }}>— check any + free text; ALL must hold for done</span>
        </label>
        <div style={sectionBoxStyle}>
          {GOAL_PRESETS.map(p => {
            const checked = checkedPresets.has(p.key)
            return (
              <div key={p.key} style={{ marginBottom: 6 }}>
                <label style={rowStyle}>
                  <input type="checkbox" checked={checked} onChange={() => togglePreset(p.key)} disabled={starting} />
                  <span style={{ flex: p.needsSpecify ? 'unset' : 1 }}>{p.label}</span>
                  {p.needsSpecify && checked && (
                    <input
                      type="text"
                      placeholder="specify…"
                      value={presetSpecify[p.key] || ''}
                      onChange={e => setPresetSpecify(prev => ({ ...prev, [p.key]: e.target.value }))}
                      disabled={starting}
                      style={inlineTextStyle}
                    />
                  )}
                </label>
              </div>
            )
          })}
          <div style={{ marginTop: 8 }}>
            <label style={{ ...rowStyle, alignItems: 'flex-start' }}>
              <span style={{ paddingTop: 4, opacity: 0.8 }}>Custom:</span>
              <textarea
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder="e.g. deploy to staging and verify /health returns 200"
                rows={2}
                maxLength={4000}
                disabled={starting}
                style={{ ...inlineTextStyle, resize: 'vertical' as const, minHeight: 40 }}
              />
            </label>
          </div>
        </div>

        <label style={sectionLabelStyle}>
          Circuit breakers <span style={{ opacity: 0.6, fontWeight: 400 }}>— each independent; ANY trip = SIGTERM</span>
        </label>
        <div style={sectionBoxStyle}>
          <BreakerRow enabled={enableTurns} setEnabled={setEnableTurns} disabled={starting} label="Max turns">
            <input type="number" min={1} value={maxTurns} onChange={e => setMaxTurns(Number(e.target.value))} disabled={starting || !enableTurns} style={numericStyle} />
          </BreakerRow>
          <BreakerRow enabled={enableCost} setEnabled={setEnableCost} disabled={starting} label="Max cost">
            <span style={{ opacity: 0.8 }}>$</span>
            <input type="number" step="0.5" min={0.1} value={maxCost} onChange={e => setMaxCost(Number(e.target.value))} disabled={starting || !enableCost} style={numericStyle} />
            <span style={{ opacity: 0.6 }}>USD</span>
          </BreakerRow>
          <BreakerRow enabled={enableWall} setEnabled={setEnableWall} disabled={starting} label="Max wall time">
            <input type="number" step="0.25" min={0.25} value={maxWallH} onChange={e => setMaxWallH(Number(e.target.value))} disabled={starting || !enableWall} style={numericStyle} />
            <span style={{ opacity: 0.6 }}>h (pause excluded)</span>
          </BreakerRow>
          <BreakerRow enabled={enableGate} setEnabled={setEnableGate} disabled={starting} label="Gate script">
            <input type="text" placeholder="/path/to/gate.sh" value={gatePath} onChange={e => setGatePath(e.target.value)} disabled={starting || !enableGate} style={{ ...inlineTextStyle, minWidth: 200 }} />
          </BreakerRow>
          <BreakerRow enabled={enableAskQ} setEnabled={setEnableAskQ} disabled={starting} label="Stop if Claude asks a question">
            {null}
          </BreakerRow>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, color: '#858392', marginBottom: 6 }}>Quick presets (fills turns/cost/wall):</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {ROPE_PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyRope(p.key)}
                disabled={starting}
                style={ropeBtnStyle}
              >
                <span style={{ fontWeight: 600 }}>{p.label}</span>
                <span style={{ opacity: 0.65, marginLeft: 6, fontSize: 10 }}>{p.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{
          padding: '6px 10px', marginBottom: 14,
          background: 'rgba(107,80,255,0.06)',
          border: '1px solid #3A3943',
          borderRadius: 4,
          fontSize: 10, color: '#858392', fontStyle: 'italic' as const
        }}>
          Auto: all permission requests approved while running · 5h rate-limit resume via chat's auto-continue
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
          <button type="button" onClick={onCancel} disabled={starting} style={cancelBtnStyle}>
            Cancel
          </button>
          <button type="button" onClick={handleGo} disabled={!canGo} style={goBtnStyle(canGo)}>
            {starting ? 'Starting…' : 'Start handoff'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function BreakerRow({ enabled, setEnabled, disabled, label, children }: {
  enabled: boolean; setEnabled: (v: boolean) => void; disabled: boolean; label: string; children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label style={rowStyle}>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={disabled} />
        <span style={{ minWidth: 200, opacity: enabled ? 1 : 0.5 }}>{label}</span>
        {children}
      </label>
    </div>
  )
}

const sectionLabelStyle: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: '#DFDBDD', marginBottom: 6, letterSpacing: 0.3
}
const sectionBoxStyle: CSSProperties = {
  padding: 10, marginBottom: 14,
  background: '#201F26', borderRadius: 6,
  border: '1px solid #3A3943'
}
const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: 12, color: '#DFDBDD',
  cursor: 'pointer'
}
const inlineTextStyle: CSSProperties = {
  flex: 1, padding: '4px 8px',
  background: '#2D2C35', color: '#FFFAF1',
  border: '1px solid #3A3943', borderRadius: 4,
  fontSize: 12, fontFamily: 'inherit'
}
const numericStyle: CSSProperties = {
  width: 70, padding: '4px 8px',
  background: '#2D2C35', color: '#FFFAF1',
  border: '1px solid #3A3943', borderRadius: 4,
  fontSize: 12, fontFamily: 'monospace'
}
const ropeBtnStyle: CSSProperties = {
  padding: '5px 10px',
  background: '#2D2C35', color: '#DFDBDD',
  border: '1px solid #3A3943', borderRadius: 4,
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 11
}
const cancelBtnStyle: CSSProperties = {
  padding: '8px 14px',
  background: 'transparent', color: '#DFDBDD',
  border: '1px solid #3A3943', borderRadius: 6,
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13
}
function goBtnStyle(enabled: boolean): CSSProperties {
  return {
    padding: '8px 18px',
    background: enabled ? '#6B50FF' : '#3A3943',
    color: '#FFFAF1', border: 'none', borderRadius: 6,
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    opacity: enabled ? 1 : 0.5
  }
}
