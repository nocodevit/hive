/**
 * HandoffModal (v2.2.1 — theme-aware).
 *
 * Fixes v2.2.0 regression: I used hardcoded Crush palette hex
 * (`#DFDBDD`, `#2D2C35`, etc.) inside a Modal that mounts at app level.
 * In light mode the light-gray text was invisible against the light
 * modal background. Crush palette is meant ONLY for HiveChat + terminal
 * decorations (locked deep-purple surface). App-level modals must use
 * theme-aware Tailwind classes (`text-text-primary`, `bg-bg-secondary`,
 * `border-border`, `text-accent`) so light + dark both work.
 *
 * Design reference: docs/design.md § "Color Palette" tokens.
 *
 * Design contract (unchanged from v2.2.0):
 *   - Goal: multi-select preset checkboxes + always-visible free text
 *   - Breakers: 5 independent toggles with inline numeric / path inputs
 *   - Quick / Normal / Marathon preset-autofill buttons
 *   - Implicit defaults: permission auto-allow + 5h auto-resume
 *   - Submits via window.api.handoff.start({chatId, goals, breakers})
 */
import { useState } from 'react'
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
  render: (specify: string) => string
}

export const GOAL_PRESETS: GoalPreset[] = [
  // v2.2.2: first slot — Plan Mode continuation. Chat-inject means the
  // plan claude presented via ExitPlanMode is already in context; this
  // preset just makes the affordance visible so users don't have to
  // discover it by typing "execute the plan above" into Custom.
  { key: 'plan', label: 'Execute the plan I approved above (Plan Mode)', needsSpecify: false,
    render: () => 'execute the plan you presented via ExitPlanMode above, item by item, until every item is implemented and verified' },
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
      <div className="space-y-4">
        {/* GOAL section */}
        <div>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            Goal <span className="normal-case tracking-normal opacity-70">— check any + free text; ALL must hold for done</span>
          </div>
          <div className="p-3 bg-bg-primary rounded-lg border border-border space-y-2">
            {GOAL_PRESETS.map(p => {
              const checked = checkedPresets.has(p.key)
              return (
                <label key={p.key} className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => togglePreset(p.key)} disabled={starting} className="accent-[var(--accent)]" />
                  <span className={p.needsSpecify ? '' : 'flex-1'}>{p.label}</span>
                  {p.needsSpecify && checked && (
                    <input
                      type="text"
                      placeholder="specify…"
                      value={presetSpecify[p.key] || ''}
                      onChange={e => setPresetSpecify(prev => ({ ...prev, [p.key]: e.target.value }))}
                      disabled={starting}
                      className="flex-1 px-2 py-1 rounded bg-bg-hover text-text-primary border border-border text-xs focus:outline-none focus:border-accent"
                    />
                  )}
                </label>
              )
            })}
            <label className="flex items-start gap-2 text-sm text-text-primary pt-1">
              <span className="pt-1 text-text-muted">Custom:</span>
              <textarea
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder="e.g. deploy to staging and verify /health returns 200"
                rows={2}
                maxLength={4000}
                disabled={starting}
                className="flex-1 px-2 py-1 rounded bg-bg-hover text-text-primary border border-border text-xs resize-y min-h-[40px] focus:outline-none focus:border-accent"
              />
            </label>
          </div>
        </div>

        {/* BREAKERS section */}
        <div>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            Circuit breakers <span className="normal-case tracking-normal opacity-70">— each independent; ANY trip = SIGTERM</span>
          </div>
          <div className="p-3 bg-bg-primary rounded-lg border border-border space-y-2">
            <BreakerRow enabled={enableTurns} setEnabled={setEnableTurns} disabled={starting} label="Max turns">
              <input type="number" min={1} value={maxTurns} onChange={e => setMaxTurns(Number(e.target.value))} disabled={starting || !enableTurns} className="w-20 px-2 py-1 rounded bg-bg-hover text-text-primary border border-border text-xs font-mono focus:outline-none focus:border-accent disabled:opacity-50" />
            </BreakerRow>
            <BreakerRow enabled={enableCost} setEnabled={setEnableCost} disabled={starting} label="Max cost">
              <span className="text-text-muted">$</span>
              <input type="number" step="0.5" min={0.1} value={maxCost} onChange={e => setMaxCost(Number(e.target.value))} disabled={starting || !enableCost} className="w-20 px-2 py-1 rounded bg-bg-hover text-text-primary border border-border text-xs font-mono focus:outline-none focus:border-accent disabled:opacity-50" />
              <span className="text-text-muted text-xs">USD</span>
            </BreakerRow>
            <BreakerRow enabled={enableWall} setEnabled={setEnableWall} disabled={starting} label="Max wall time">
              <input type="number" step="0.25" min={0.25} value={maxWallH} onChange={e => setMaxWallH(Number(e.target.value))} disabled={starting || !enableWall} className="w-20 px-2 py-1 rounded bg-bg-hover text-text-primary border border-border text-xs font-mono focus:outline-none focus:border-accent disabled:opacity-50" />
              <span className="text-text-muted text-xs">h (pause excluded)</span>
            </BreakerRow>
            <BreakerRow enabled={enableGate} setEnabled={setEnableGate} disabled={starting} label="Gate script">
              <input type="text" placeholder="/path/to/gate.sh" value={gatePath} onChange={e => setGatePath(e.target.value)} disabled={starting || !enableGate} className="flex-1 min-w-[180px] px-2 py-1 rounded bg-bg-hover text-text-primary border border-border text-xs font-mono focus:outline-none focus:border-accent disabled:opacity-50" />
            </BreakerRow>
            <BreakerRow enabled={enableAskQ} setEnabled={setEnableAskQ} disabled={starting} label="Stop if Claude asks a question">
              {null}
            </BreakerRow>
          </div>
        </div>

        {/* Rope preset buttons */}
        <div>
          <div className="text-[10px] text-text-muted mb-1.5">Quick presets (fills turns/cost/wall):</div>
          <div className="flex gap-2">
            {ROPE_PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyRope(p.key)}
                disabled={starting}
                className="px-3 py-1.5 rounded-md bg-bg-primary border border-border text-text-primary text-xs hover:bg-bg-hover transition-colors cursor-pointer disabled:opacity-50"
              >
                <span className="font-semibold">{p.label}</span>
                <span className="opacity-65 ml-1.5 text-[10px]">{p.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Implicit defaults hint */}
        <div className="px-2.5 py-1.5 rounded bg-accent-subtle border border-border text-[10px] text-text-muted italic">
          Auto: all permission requests approved while running · 5h rate-limit resume via chat's auto-continue
        </div>

        {error && (
          <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={starting}
            className="px-4 py-1.5 rounded-lg bg-bg-primary border border-border text-text-primary text-sm hover:bg-bg-hover transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGo}
            disabled={!canGo}
            className="px-4 py-1.5 rounded-lg bg-accent text-text-on-purple text-sm font-semibold hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
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
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={disabled} className="accent-[var(--accent)]" />
      <span className={`min-w-[180px] ${enabled ? 'text-text-primary' : 'text-text-muted'}`}>{label}</span>
      {children}
    </label>
  )
}
