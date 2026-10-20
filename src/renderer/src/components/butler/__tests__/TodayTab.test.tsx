// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TodayTab } from '../TodayTab'

const day = (date: string, over: Record<string, unknown> = {}) => ({ date, plan: [], planLate: null, summary: '', feishu: '', jira: '', ...over })

beforeEach(() => {
  const days: Record<string, any> = {
    '2026-10-20': day('2026-10-20', { plan: [
      { index: 0, text: 'Review fix', done: true, source: null },
      { index: 1, text: 'Reply Lin', done: false, source: 'draft' }
    ] }),
    '2026-10-19': day('2026-10-19', { summary: 'Shipped v2.28.3\nmore' })
  }
  ;(window as any).api = {
    journal: {
      day: vi.fn(async (d?: string) => days[d ?? '2026-10-20']),
      dates: vi.fn(async () => ['2026-10-20', '2026-10-19']),
      toggle: vi.fn(async () => ({ ok: true }))
    },
    routines: { run: vi.fn(async () => ({ ok: true })) }
  }
})

describe('TodayTab', () => {
  it('shows the plan, pills and yesterday folded; ticking writes back', async () => {
    render(<TodayTab visible />)
    expect(await screen.findByText('Plan · Tue 20 Oct')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(await screen.findByText('Yesterday · Shipped v2.28.3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Reply Lin/ }))
    await waitFor(() => expect((window as any).api.journal.toggle).toHaveBeenCalledWith('2026-10-20', 1, 'Reply Lin', true))
    expect(screen.getByRole('button', { name: '‹ Older days' })).toBeInTheDocument()
  })
})
