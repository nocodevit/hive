// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import HandoffModal, { GOAL_PRESETS, ROPE_PRESETS } from '../HandoffModal'

afterEach(() => cleanup())

const baseProps = {
  open: true,
  chatId: 'chat-agent-abc',
  agentName: 'David',
  onCancel: vi.fn(),
  onStarted: vi.fn()
}

beforeEach(() => {
  ;(window as any).api = {
    handoff: {
      start: vi.fn().mockResolvedValue({ ok: true, runId: 'hnd_xyz' })
    }
  }
})

describe('HandoffModal (v2.2.0)', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(<HandoffModal {...baseProps} open={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows agent name in the title', () => {
    render(<HandoffModal {...baseProps} />)
    expect(screen.getByText(/Hand off to David/)).toBeInTheDocument()
  })

  it('surfaces the "auto: permissions + 5h auto-resume" implicit-defaults line', () => {
    render(<HandoffModal {...baseProps} />)
    expect(screen.getByText(/permission requests approved/)).toBeInTheDocument()
    expect(screen.getByText(/5h rate-limit resume/)).toBeInTheDocument()
  })

  it('Go disabled when no goal (no preset checked + free text empty)', () => {
    render(<HandoffModal {...baseProps} />)
    const go = screen.getByRole('button', { name: /Start handoff/ }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
  })

  it('typing in free text enables Go', () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/deploy to staging/), { target: { value: 'do it' } })
    const go = screen.getByRole('button', { name: /Start handoff/ }) as HTMLButtonElement
    expect(go.disabled).toBe(false)
  })

  it('checking a preset that needs "specify" without filling it does NOT enable Go', () => {
    render(<HandoffModal {...baseProps} />)
    // "Feature done" needs specify
    fireEvent.click(screen.getByText(/Feature done/))
    const go = screen.getByRole('button', { name: /Start handoff/ }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    // Now fill specify → enabled
    fireEvent.change(screen.getByPlaceholderText(/specify…/), { target: { value: 'user auth' } })
    expect(go.disabled).toBe(false)
  })

  it('checking a preset that does NOT need specify (Tests pass) enables Go immediately', () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.click(screen.getByText(/Tests pass/))
    const go = screen.getByRole('button', { name: /Start handoff/ }) as HTMLButtonElement
    expect(go.disabled).toBe(false)
  })

  it('clicking Go submits {chatId, goals[], breakers} in v2 shape', async () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/deploy to staging/), { target: { value: 'do it' } })
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))
    expect((window as any).api.handoff.start).toHaveBeenCalledWith(expect.objectContaining({
      chatId: 'chat-agent-abc',
      goals: ['do it']
    }))
    const call = (window as any).api.handoff.start.mock.calls[0][0]
    // Default breakers: turns, cost, wall, askQ enabled (from initial state)
    expect(call.breakers).toEqual(expect.objectContaining({
      maxTurns: 60,
      maxCostUsd: 5,
      maxWallTimeMs: 2 * 60 * 60 * 1000,
      stopOnAskUserQuestion: true
    }))
    expect(call.breakers.gateScriptPath).toBeUndefined()
  })

  it('unchecking cost breaker omits maxCostUsd from payload', async () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/deploy to staging/), { target: { value: 'x' } })
    // Uncheck "Max cost" by clicking its checkbox
    const rows = screen.getAllByRole('checkbox') as HTMLInputElement[]
    // Find checkbox in the Max cost row — locate by label
    const costLabel = screen.getByText('Max cost').closest('label') as HTMLLabelElement
    const costCheckbox = costLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(costCheckbox)
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))
    const call = (window as any).api.handoff.start.mock.calls[0][0]
    expect(call.breakers.maxCostUsd).toBeUndefined()
    expect(call.breakers.maxTurns).toBeDefined()
    expect(rows.length).toBeGreaterThan(0) // sanity
  })

  it('Quick preset button fills turns=15 / cost=1 / wall=0.25h', async () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/deploy to staging/), { target: { value: 'x' } })
    // "Quick" text appears both in the section header ("Quick presets: ...")
    // AND on the button — click the actual button by tag+role.
    const quickBtn = screen.getAllByRole('button').find(b => /^Quick/.test(b.textContent || '')) as HTMLButtonElement
    expect(quickBtn).toBeDefined()
    fireEvent.click(quickBtn)
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))
    const call = (window as any).api.handoff.start.mock.calls[0][0]
    expect(call.breakers.maxTurns).toBe(15)
    expect(call.breakers.maxCostUsd).toBe(1)
    expect(call.breakers.maxWallTimeMs).toBe(15 * 60 * 1000)
  })

  it('surfaces supervisor error inline', async () => {
    ;(window as any).api.handoff.start = vi.fn().mockResolvedValue({ ok: false, error: 'chat already has an active handoff' })
    render(<HandoffModal {...baseProps} />)
    fireEvent.change(screen.getByPlaceholderText(/deploy to staging/), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))
    expect(screen.getByText(/chat already has an active handoff/)).toBeInTheDocument()
  })

  it('Cancel calls onCancel', () => {
    const onCancel = vi.fn()
    render(<HandoffModal {...baseProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('GOAL_PRESETS + ROPE_PRESETS are exported for external reference', () => {
    expect(GOAL_PRESETS.length).toBeGreaterThan(0)
    expect(ROPE_PRESETS.map(r => r.key)).toEqual(['quick', 'normal', 'marathon'])
  })

  it('Plan Mode preset appears FIRST in the goal list (v2.2.2)', () => {
    expect(GOAL_PRESETS[0].key).toBe('plan')
    expect(GOAL_PRESETS[0].needsSpecify).toBe(false)
    // Prompt text must reference ExitPlanMode explicitly so claude's
    // evaluator knows what "the plan" refers to in transcript.
    expect(GOAL_PRESETS[0].render('')).toMatch(/ExitPlanMode/)
  })

  it('every preset prompt forces per-item / per-step reporting (v2.2.3 evaluator starvation fix)', () => {
    // /goal's Haiku evaluator only judges from what claude SAYS in the
    // transcript. If a prompt lets claude do the work silently, the
    // evaluator keeps voting "not verified" and the handoff burns turns.
    // Every preset must instruct claude to explicitly report progress.
    for (const p of GOAL_PRESETS) {
      const rendered = p.render(p.key === 'feature' ? 'test feature' : '')
      // Contains an explicit reporting or verification directive.
      const hasReportDirective = /briefly state|quote its actual|verified|verify/.test(rendered)
      expect(hasReportDirective).toBe(true)
    }
  })

  it('checking the Plan Mode preset submits a plan-execution goal fragment', async () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.click(screen.getByText(/Execute the plan I approved above/))
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))
    const call = (window as any).api.handoff.start.mock.calls[0][0]
    expect(call.goals.length).toBe(1)
    expect(call.goals[0]).toMatch(/work through the plan you presented via ExitPlanMode/)
    expect(call.goals[0]).toMatch(/briefly state/)  // v2.2.3 per-item report
  })

  // v2.18.0 — the custom standing-rule box under the Plan Mode preset.
  it('custom standing rule appears only under Plan Mode and rides into the goal', async () => {
    render(<HandoffModal {...baseProps} />)
    // Hidden until the plan preset is checked — the sub-items belong to it.
    expect(screen.queryByPlaceholderText(/your own rule for this run/)).toBeNull()

    fireEvent.click(screen.getByText(/Execute the plan I approved above/))
    const box = screen.getByPlaceholderText(/your own rule for this run/)
    fireEvent.change(box, { target: { value: 'never force-push to master' } })
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))

    const call = (window as any).api.handoff.start.mock.calls[0][0]
    // Rides INSIDE the single plan goal as a standing rule, not as its own goal.
    expect(call.goals.length).toBe(1)
    expect(call.goals[0]).toMatch(/never force-push to master/)
    expect(call.goals[0]).toMatch(/standing rules/)
  })

  it('an empty custom rule box adds nothing to the goal', async () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.click(screen.getByText(/Execute the plan I approved above/))
    fireEvent.change(screen.getByPlaceholderText(/your own rule for this run/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))
    const call = (window as any).api.handoff.start.mock.calls[0][0]
    // Six standing rules, numbered 1-6, and no dangling 7th from the blank box.
    expect(call.goals[0]).toMatch(/6\. /)
    expect(call.goals[0]).not.toMatch(/7\. /)
  })

  it('Plan Mode preset stacks with other goals (AND ALSO on backend)', async () => {
    render(<HandoffModal {...baseProps} />)
    fireEvent.click(screen.getByText(/Execute the plan I approved above/))
    fireEvent.click(screen.getByText(/Tests pass/))
    fireEvent.click(screen.getByRole('button', { name: /Start handoff/ }))
    await new Promise(r => setTimeout(r, 10))
    const call = (window as any).api.handoff.start.mock.calls[0][0]
    expect(call.goals.length).toBe(2)
    expect(call.goals.some((g: string) => /ExitPlanMode/.test(g))).toBe(true)
    expect(call.goals.some((g: string) => /test command.*exits 0/.test(g))).toBe(true)
  })
})
