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
 *
 * v2.18.0 — style-guide pass. The modal had drifted off docs/design.md on four
 * counts, all fixed by the shared constants below: raw macOS system checkboxes
 * (`accent-[…]` does not restyle the control), radii that matched no token
 * (Tailwind's 4px/8px vs the guide's 6px/12px), spacing on 1.5/2.5/0.5 steps
 * that breaks the 4px grid (Rule #5), and lowercase sub-section labels where
 * Rule #4 requires uppercase + tracking. Also swapped a hardcoded `red-500`
 * error box for the theme-aware `--status-danger` token, which is what makes
 * the error readable in light mode.
 */
import { useState } from 'react'
import Modal from './Modal'
import { PLAN_REMINDERS, DEFAULT_REMINDER_KEYS, appendPlanReminders } from './handoffReminders'

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
  // v2.2.3: prompts strengthened to force per-item explicit reporting.
  // Without this, /goal's Haiku evaluator (which only reads what claude
  // SAYS in the transcript, can't independently verify) may keep judging
  // "not verified" even when claude silently did the work — burning
  // turns on redundant checks until the turn cap trips.
  { key: 'plan', label: 'Execute the plan I approved above (Plan Mode)', needsSpecify: false,
    render: () => 'work through the plan you presented via ExitPlanMode above, item by item. After finishing each item, briefly state which item you completed and how you verified it (test output, file paths, commit sha). Only consider done when every item is both implemented AND verified' },
  { key: 'feature', label: 'Feature done', needsSpecify: true,
    render: s => `implement this feature and verify it works: ${s}. After each substantive change, briefly state what changed and how you verified it (test output, screenshot, file diff). Only consider done when the feature is both implemented AND verified` },
  { key: 'tests', label: 'Tests pass (npm test / vitest / etc.)', needsSpecify: false,
    render: () => 'the project test command (npm test / vitest run / pytest — whichever this project uses) exits 0 with zero failures. Run the command and quote its actual exit code and pass/fail summary in the conversation so completion can be verified from the transcript' },
  { key: 'lint', label: 'Lint clean', needsSpecify: false,
    render: () => 'the project lint command exits 0 with zero errors. Run the command and quote its actual output so completion can be verified from the transcript' }
]

interface RopePresetUI { key: RopeKey; label: string; hint: string; turns: number; cost: number; wallH: number }
export const ROPE_PRESETS: RopePresetUI[] = [
  { key: 'quick',    label: 'Quick',    hint: '~15m · ~$1',  turns: 15,  cost: 1,  wallH: 0.25 },
  { key: 'normal',   label: 'Normal',   hint: '~2h · ~$5',   turns: 60,  cost: 5,  wallH: 2 },
  { key: 'marathon', label: 'Marathon', hint: '~8h · ~$20',  turns: 200, cost: 20, wallH: 8 }
]

// ---------------------------------------------------------------------------
// Style tokens for this modal, per docs/design.md.
//
// CHECKBOX — the box stays a REAL <input type="checkbox">, restyled with
// `appearance-none` rather than replaced by a <button role="checkbox">. That
// keeps every native behaviour the rest of the app relies on: clicking the
// wrapping <label> toggles it, keyboard space works, and it is still findable
// as input[type=checkbox]. `accent-[var(--accent)]` (what this modal used
// before) does NOT restyle the control — macOS still draws its own system
// checkbox, which is the one piece of raw OS chrome left in the app and reads
// as foreign against the glassmorphism surfaces. The checkmark is a ::after
// rotated border rather than an SVG so the whole control is one element.
//
// RADIUS — design.md § Border Radius: 6px small elements (inputs, the box),
// 12px cards. Tailwind's `rounded`(4px)/`rounded-lg`(8px) hit neither, so this
// modal used off-token values throughout; `rounded-md`(6px)/`rounded-xl`(12px)
// are the correct mappings.
//
// SPACING — design.md Rule #5, everything on the 4px grid. The old markup was
// full of 1.5/2.5/0.5 steps (6px/10px/2px) that sit off it.
const CHECKBOX =
  'appearance-none shrink-0 w-4 h-4 rounded-md border border-border bg-bg-hover ' +
  'cursor-pointer relative transition-colors duration-base ease-eased ' +
  'hover:border-accent checked:bg-accent checked:border-accent ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ' +
  "after:content-[''] after:absolute after:left-[5px] after:top-[1px] " +
  'after:w-[4px] after:h-[8px] after:border-r-2 after:border-b-2 ' +
  'after:border-text-on-purple after:rotate-45 after:opacity-0 ' +
  'checked:after:opacity-100 after:transition-opacity ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

/** Section label: uppercase + tracking, per design.md Rule #4. */
const SECTION_LABEL =
  'text-[10px] font-semibold text-text-muted uppercase tracking-[0.08em] mb-2'

/** Inner surface inside the modal — flat card, 12px radius. */
const INNER_CARD = 'p-3 bg-bg-primary rounded-xl border border-border space-y-2'

/** Text / number inputs — 6px radius, 4px-grid padding. */
const FIELD =
  'px-2 py-1 rounded-md bg-bg-hover text-text-primary border border-border text-xs ' +
  'transition-colors duration-base ease-eased ' +
  'focus:outline-none focus:border-accent disabled:opacity-50'

export default function HandoffModal({ open, chatId, agentName, onCancel, onStarted }: HandoffModalProps) {
  const [checkedPresets, setCheckedPresets] = useState<Set<string>>(new Set())
  const [presetSpecify, setPresetSpecify] = useState<Record<string, string>>({})
  const [freeText, setFreeText] = useState('')
  // Standing reminders under the 'plan' preset — all on by default so the user's
  // fixed instructions ride along automatically; they can uncheck any per run.
  const [checkedReminders, setCheckedReminders] = useState<Set<string>>(
    new Set(DEFAULT_REMINDER_KEYS)
  )
  // One-off rule for THIS run, typed under the standing list. No checkbox:
  // non-empty text is the opt-in, clearing it is the opt-out.
  const [customReminder, setCustomReminder] = useState('')

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
      } else if (preset.key === 'plan') {
        // Ride the checked standing reminders — plus this run's custom rule —
        // along inside the single plan goal.
        out.push(appendPlanReminders(preset.render(''), checkedReminders, customReminder))
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

  const toggleReminder = (key: string) => {
    setCheckedReminders(prev => {
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
          <div className={SECTION_LABEL}>
            Goal <span className="normal-case tracking-normal opacity-70">— check any + free text; ALL must hold for done</span>
          </div>
          <div className={INNER_CARD}>
            {GOAL_PRESETS.map(p => {
              const checked = checkedPresets.has(p.key)
              return (
                <div key={p.key}>
                  <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                    <input type="checkbox" checked={checked} onChange={() => togglePreset(p.key)} disabled={starting} className={CHECKBOX} />
                    <span className={p.needsSpecify ? '' : 'flex-1'}>{p.label}</span>
                    {p.needsSpecify && checked && (
                      <input
                        type="text"
                        placeholder="specify…"
                        value={presetSpecify[p.key] || ''}
                        onChange={e => setPresetSpecify(prev => ({ ...prev, [p.key]: e.target.value }))}
                        disabled={starting}
                        className={`flex-1 ${FIELD}`}
                      />
                    )}
                  </label>
                  {/* Standing reminders — appear only when the plan preset is on,
                      indented beneath it. All default-checked; uncheck to drop.
                      The last row is a free-text rule for THIS run only. */}
                  {p.key === 'plan' && checked && (
                    <div className="mt-2 ml-6 pl-3 border-l border-border space-y-2">
                      <div className={`${SECTION_LABEL} mb-0`}>
                        Standing rules <span className="normal-case tracking-normal opacity-70">— on by default; uncheck any to drop</span>
                      </div>
                      <div className="space-y-1">
                        {PLAN_REMINDERS.map(r => (
                          <label key={r.key} className="flex items-start gap-2 text-xs leading-4 text-text-primary cursor-pointer">
                            <input type="checkbox" checked={checkedReminders.has(r.key)} onChange={() => toggleReminder(r.key)} disabled={starting} className={CHECKBOX} />
                            <span>{r.label}</span>
                          </label>
                        ))}
                      </div>
                      {/* Custom rule — no checkbox on purpose: typing IS the
                          opt-in, clearing it is the opt-out, so there is no way
                          to end up with a checked-but-empty row. */}
                      <input
                        type="text"
                        value={customReminder}
                        onChange={e => setCustomReminder(e.target.value)}
                        placeholder="+ your own rule for this run…"
                        maxLength={500}
                        disabled={starting}
                        className={`w-full ${FIELD}`}
                      />
                    </div>
                  )}
                </div>
              )
            })}
            <div className="pt-1 space-y-1">
              <div className="text-[11px] text-text-muted">Custom goal</div>
              <textarea
                value={freeText}
                onChange={e => setFreeText(e.target.value)}
                placeholder="e.g. deploy to staging and verify /health returns 200"
                rows={2}
                maxLength={4000}
                disabled={starting}
                className={`w-full resize-y min-h-[40px] ${FIELD}`}
              />
            </div>
          </div>
        </div>

        {/* BREAKERS section */}
        <div>
          <div className={SECTION_LABEL}>
            Circuit breakers <span className="normal-case tracking-normal opacity-70">— each independent; ANY trip = SIGTERM</span>
          </div>
          <div className={INNER_CARD}>
            <BreakerRow enabled={enableTurns} setEnabled={setEnableTurns} disabled={starting} label="Max turns">
              <input type="number" min={1} value={maxTurns} onChange={e => setMaxTurns(Number(e.target.value))} disabled={starting || !enableTurns} className={`w-20 font-mono ${FIELD}`} />
            </BreakerRow>
            <BreakerRow enabled={enableCost} setEnabled={setEnableCost} disabled={starting} label="Max cost">
              <span className="text-text-muted">$</span>
              <input type="number" step="0.5" min={0.1} value={maxCost} onChange={e => setMaxCost(Number(e.target.value))} disabled={starting || !enableCost} className={`w-20 font-mono ${FIELD}`} />
              <span className="text-text-muted text-xs">USD</span>
            </BreakerRow>
            <BreakerRow enabled={enableWall} setEnabled={setEnableWall} disabled={starting} label="Max wall time">
              <input type="number" step="0.25" min={0.25} value={maxWallH} onChange={e => setMaxWallH(Number(e.target.value))} disabled={starting || !enableWall} className={`w-20 font-mono ${FIELD}`} />
              <span className="text-text-muted text-xs">h (pause excluded)</span>
            </BreakerRow>
            <BreakerRow enabled={enableGate} setEnabled={setEnableGate} disabled={starting} label="Gate script">
              <input type="text" placeholder="/path/to/gate.sh" value={gatePath} onChange={e => setGatePath(e.target.value)} disabled={starting || !enableGate} className={`flex-1 min-w-[180px] font-mono ${FIELD}`} />
            </BreakerRow>
            <BreakerRow enabled={enableAskQ} setEnabled={setEnableAskQ} disabled={starting} label="Stop if Claude asks a question">
              {null}
            </BreakerRow>
          </div>
        </div>

        {/* Rope preset buttons */}
        <div>
          <div className={SECTION_LABEL}>Quick presets <span className="normal-case tracking-normal opacity-70">— fills turns / cost / wall</span></div>
          <div className="flex gap-2">
            {ROPE_PRESETS.map(p => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyRope(p.key)}
                disabled={starting}
                className="px-3 py-2 rounded-md bg-bg-primary border border-border text-text-primary text-xs hover:bg-bg-hover transition-colors duration-base ease-eased cursor-pointer disabled:opacity-50"
              >
                <span className="font-semibold">{p.label}</span>
                <span className="opacity-65 ml-2 text-[10px] font-mono">{p.hint}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Implicit defaults hint */}
        <div className="px-3 py-2 rounded-md bg-accent-subtle border border-border text-[11px] text-text-muted">
          Auto: all permission requests approved while running · 5h rate-limit resume via chat's auto-continue
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-status-danger/10 border border-status-danger text-status-danger text-xs">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            disabled={starting}
            className="px-3 py-2 rounded-lg bg-bg-hover border border-border text-text-muted text-sm hover:text-text-primary transition-colors duration-base ease-eased cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleGo}
            disabled={!canGo}
            className="px-3 py-2 rounded-lg bg-accent text-text-on-purple text-sm font-semibold hover:bg-accent-hover transition-colors duration-base ease-eased cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
      <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={disabled} className={CHECKBOX} />
      <span className={`min-w-[180px] ${enabled ? 'text-text-primary' : 'text-text-muted'}`}>{label}</span>
      {children}
    </label>
  )
}
