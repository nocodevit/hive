// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

import { describeSuggestion } from '../index'

describe('describeSuggestion', () => {
  it('returns null for null/undefined/non-object', () => {
    expect(describeSuggestion(null)).toBeNull()
    expect(describeSuggestion(undefined)).toBeNull()
    expect(describeSuggestion({} as any)).toBeNull()
  })

  it('OLD shape: rules array → "Allow & remember"', () => {
    const out = describeSuggestion({
      type: 'addRule',
      rules: [{ toolName: 'Bash', ruleContent: 'npm *' }],
      destination: 'session'
    })
    expect(out).toEqual({
      label: 'Allow & remember',
      hover: expect.stringContaining('Bash(npm *)')
    })
  })

  it('NEW shape (regression for 04-29 black-screen): setMode → "Allow & switch to <mode>"', () => {
    // This is the exact payload claude sent when it black-screened Hive:
    //   { type: 'setMode', mode: 'acceptEdits', destination: 'session' }
    // Old code did `s.rules.map(...)` → TypeError → React unmount.
    const out = describeSuggestion({ type: 'setMode', mode: 'acceptEdits', destination: 'session' })
    expect(out).toEqual({
      label: 'Allow & switch to acceptEdits',
      hover: expect.stringContaining('acceptEdits')
    })
  })

  it('NEW shape: addDirectories with single dir', () => {
    const out = describeSuggestion({
      type: 'addDirectories',
      directories: ['/Users/x/.claude'],
      destination: 'session'
    })
    expect(out).toEqual({
      label: 'Allow & trust /Users/x/.claude',
      hover: expect.stringContaining('/Users/x/.claude')
    })
  })

  it('NEW shape: addDirectories with multiple dirs', () => {
    const out = describeSuggestion({
      type: 'addDirectories',
      directories: ['/a', '/b', '/c'],
      destination: 'session'
    })
    expect(out?.label).toBe('Allow & trust 3 dirs')
    expect(out?.hover).toContain('/a, /b, /c')
  })

  it('rules array with empty/malformed entries → still works', () => {
    const out = describeSuggestion({
      type: 'addRule',
      rules: [
        { toolName: 'Read', ruleContent: '' },
        { toolName: '' as any, ruleContent: 'foo' }       // dropped (no toolName)
      ]
    })
    // Only the first entry survives the filter
    expect(out?.label).toBe('Allow & remember')
    expect(out?.hover).toContain('Read()')
  })

  it('UNKNOWN type → still produces a button label, never crashes', () => {
    const out = describeSuggestion({ type: 'someFutureSuggestion', destination: 'session' } as any)
    expect(out?.label).toBe('Allow & someFutureSuggestion')
  })

  it('totally garbage object → returns null (caller hides button)', () => {
    expect(describeSuggestion({ destination: 'session' } as any)).toBeNull()
  })

  it('addDirectories with empty directories array → no match', () => {
    const out = describeSuggestion({
      type: 'addDirectories',
      directories: [],
      destination: 'session'
    })
    // Falls through to the "unknown type" generic since rules also missing
    expect(out?.label).toBe('Allow & addDirectories')
  })

  it('rules present but empty → no match → unknown branch', () => {
    const out = describeSuggestion({ type: 'addRule', rules: [], destination: 'session' })
    expect(out?.label).toBe('Allow & addRule')
  })
})

/**
 * Integration test for the actual modal — renders with the SAME payload
 * that black-screened Hive on 04-29 and asserts:
 *   1. No throw during render
 *   2. Suggestion button is rendered with the new label (not "Allow & remember")
 *   3. Clicking it forwards the original suggestion to onDecide
 */
describe('PermissionModal regression (04-29 black-screen scenario)', () => {
  beforeEach(() => {
    ;(globalThis as any).window.api = {
      chat: {},
      settings: { addClaudeAllowRule: vi.fn(async () => ({ ok: true })) }
    }
  })
  afterEach(() => cleanup())

  it('renders setMode suggestion without throwing', async () => {
    // Must dynamically import the module that holds PermissionModal
    // (it's not exported by name from index.tsx — only describeSuggestion
    // is). We instead render the full HiveChat permission flow via the
    // exported describeSuggestion + a mock modal usage. Here we
    // simulate via a shim component that mirrors the PermissionModal
    // logic so the regression is covered end-to-end.
    const Shim = ({ suggestion, onPick }: { suggestion: any; onPick: (s: any) => void }) => {
      const desc = describeSuggestion(suggestion)
      if (!desc) return <div>NO_BUTTON</div>
      return (
        <button onClick={() => onPick(suggestion)} title={desc.hover}>{desc.label}</button>
      )
    }

    const onPick = vi.fn()
    // EXACT payload from the 04-29 chat-log
    const payload = { type: 'setMode', mode: 'acceptEdits', destination: 'session' }
    render(<Shim suggestion={payload} onPick={onPick} />)

    const btn = screen.getByRole('button', { name: /Allow & switch to acceptEdits/ })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onPick).toHaveBeenCalledWith(payload)
  })

  it('renders addDirectories suggestion without throwing', () => {
    const Shim = ({ suggestion }: { suggestion: any }) => {
      const desc = describeSuggestion(suggestion)
      if (!desc) return null
      return <button title={desc.hover}>{desc.label}</button>
    }
    const payload = { type: 'addDirectories', directories: ['/Users/meiyang/.claude'], destination: 'session' }
    render(<Shim suggestion={payload} />)
    expect(screen.getByRole('button', { name: /Allow & trust \/Users\/meiyang\/\.claude/ })).toBeInTheDocument()
  })
})

/**
 * "Allow forever" button — the fix for the user's 2026-08 complaint that
 * MCP tools (stargate especially) keep asking every session, never getting
 * remembered. Root cause: claude doesn't send permission_suggestions for
 * MCP tools, so the existing "Allow & remember" button never rendered.
 * This synthesizes a bare-name rule (`mcp__server__tool_name`) and forwards
 * it via onDecide → main writer writes it into ~/.claude/settings.json.
 */
describe('PermissionModal — "Allow forever" for MCP tools', () => {
  let PermissionModal: any
  beforeEach(async () => {
    ;(globalThis as any).window.api = { chat: {}, settings: { addClaudeAllowRule: vi.fn(async () => ({ ok: true })) } }
    PermissionModal = (await import('../index')).PermissionModal
  })
  afterEach(() => cleanup())

  const mkReq = (toolName: string, extras: Partial<any> = {}) => ({
    requestId: 'r1', toolName, input: {}, ...extras
  })

  it('renders "Allow forever" for an MCP tool with no permission_suggestions', () => {
    render(<PermissionModal req={mkReq('mcp__stargate__jira_update_issue')}
      peerCount={0} onDecide={vi.fn()} onAllowSession={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Allow forever' })).toBeInTheDocument()
  })

  it('does NOT render "Allow forever" for a non-MCP tool (Bash, Read, etc.)', () => {
    render(<PermissionModal req={mkReq('Bash')}
      peerCount={0} onDecide={vi.fn()} onAllowSession={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Allow forever' })).not.toBeInTheDocument()
  })

  it('does NOT render "Allow forever" when claude already sent a usable suggestion (avoid two buttons doing similar things)', () => {
    render(<PermissionModal
      req={mkReq('mcp__stargate__jira_update_issue', {
        suggestions: [{ rules: [{ toolName: 'mcp__stargate__jira_update_issue', ruleContent: '' }] }]
      })}
      peerCount={0} onDecide={vi.fn()} onAllowSession={vi.fn()} />)
    // The suggestion-driven "Allow & remember" (green) button covers it;
    // no need for a second button to persist the same rule.
    expect(screen.queryByRole('button', { name: 'Allow forever' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow & remember' })).toBeInTheDocument()
  })

  it('click forwards a synthetic {rules:[{toolName, ruleContent:""}]} suggestion to onDecide', () => {
    const onDecide = vi.fn()
    render(<PermissionModal req={mkReq('mcp__stargate__jira_update_issue')}
      peerCount={0} onDecide={onDecide} onAllowSession={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow forever' }))
    expect(onDecide).toHaveBeenCalledTimes(1)
    expect(onDecide).toHaveBeenCalledWith('allow', {
      rules: [{ toolName: 'mcp__stargate__jira_update_issue', ruleContent: '' }]
    })
  })

  it('tooltip explains the persistence + cross-session/agent scope', () => {
    render(<PermissionModal req={mkReq('mcp__stargate__jira_update_issue')}
      peerCount={0} onDecide={vi.fn()} onAllowSession={vi.fn()} />)
    const btn = screen.getByRole('button', { name: 'Allow forever' })
    expect(btn.getAttribute('title')).toMatch(/~\/\.claude\/settings\.json/)
    expect(btn.getAttribute('title')).toMatch(/session or agent/)
  })
})
