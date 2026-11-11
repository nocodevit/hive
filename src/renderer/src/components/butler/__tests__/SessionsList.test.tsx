// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { SessionsList, OFF_FOLD_AFTER } from '../SessionCard'

afterEach(() => cleanup())

const row = (agentId: string, agent: string, activity: 'working' | 'waiting' | 'off') => ({ agentId, agent, projectId: 'p', project: 'Acme', activity, updatedAt: Date.now() - 60_000 })
const action = (r: { agent: string }) => <button>{`Open ${r.agent}`}</button>
const reply = async () => ({ ok: true })

describe('Butler › Sessions list', () => {
  it('groups agents under Needs you / Working / Off with counts', () => {
    render(<SessionsList rows={[row('a', 'Missy', 'waiting'), row('b', 'Bob', 'working'), row('c', 'Quinn', 'off')]} turns={{}} action={action} onReply={reply} />)
    expect(within(screen.getByRole('region', { name: 'Needs you (1)' })).getByText('Missy')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Working (1)' })).getByText('Bob')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Off (1)' })).getByText('Quinn')).toBeTruthy()
  })

  it('a row with a last turn previews it and expands with its chevron button; a row without one is not clickable', () => {
    render(<SessionsList rows={[row('a', 'Missy', 'waiting'), row('b', 'Bob', 'working')]}
      turns={{ a: { task: 'compare plans', reply: 'Compared both plans. Shall I write the table?', at: 1 } }} action={action} onReply={reply} />)
    const show = screen.getByRole('button', { name: "Show Missy's last reply" })
    expect(show.getAttribute('aria-expanded')).toBe('false')
    expect(show.textContent).toContain('compare plans')
    fireEvent.click(show)
    expect(screen.getByRole('button', { name: "Hide Missy's last reply" }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('note', { name: 'You asked Missy' }).textContent).toContain('compare plans')
    expect(screen.getByRole('region', { name: "Missy's last reply" }).textContent).toContain('Shall I write the table?')
    expect((screen.getByRole('button', { name: 'Bob' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a long Off list starts folded and opens on click; the action button stays separate', () => {
    const offs = Array.from({ length: OFF_FOLD_AFTER + 1 }, (_, i) => row(`o${i}`, `Agent${i}`, 'off'))
    render(<SessionsList rows={[row('b', 'Bob', 'working'), ...offs]} turns={{}} action={action} onReply={reply} />)
    expect(screen.queryByText('Agent0')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Off/ }))
    expect(screen.getByText('Agent0')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open Bob' })).toBeTruthy()
  })
})
