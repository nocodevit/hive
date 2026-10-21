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
    routines: {
      run: vi.fn(async () => ({ ok: true })),
      get: vi.fn(async () => ({
        settings: {
          weekdays: [1, 2, 3, 4, 5, 6, 7],
          routines: {
            'morning-plan': { enabled: true, schedule: { kind: 'times', times: ['00:00'] } },
            'sort-inbox': { enabled: true, schedule: { kind: 'times', times: ['00:00'] } },
            'jira-check': { enabled: false, schedule: { kind: 'times', times: ['09:00'] } },
            'evening-report': { enabled: true, schedule: { kind: 'times', times: ['23:59'] } }
          }
        },
        installed: {},
        lastRuns: {
          'morning-plan': { id: 'morning-plan', at: new Date().setHours(0, 0, 30, 0), ok: true, late: false },
          'sort-inbox': { id: 'sort-inbox', at: new Date().setHours(0, 0, 30, 0), ok: false, late: false, error: 'mail: auth' }
        }
      }))
    }
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
  it('lists every routine with what ran, failed, is next or off today', async () => {
    render(<TodayTab visible />)
    const box = await screen.findByRole('generic', { name: 'Routines' })
    expect(box).toHaveTextContent('Morning planran 00:00')
    expect(box).toHaveTextContent('Sort inboxfailed 00:00')
    expect(box).toHaveTextContent('Jiraoff')
    expect(box).toHaveTextContent('Evening reportnext 23:59')
  })
})
