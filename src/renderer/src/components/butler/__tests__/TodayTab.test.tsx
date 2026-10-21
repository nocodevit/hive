// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

afterEach(cleanup)
import { TodayTab } from '../TodayTab'

const day = (date: string, over: Record<string, unknown> = {}) => ({ date, plan: [], planLate: null, summary: '', feishu: '', jira: '', meetings: '', butler: '', ...over })

beforeEach(() => {
  const days: Record<string, any> = {
    '2026-10-20': day('2026-10-20', { plan: [
      { index: 0, text: 'Review fix', done: true, source: null },
      { index: 1, text: 'Reply Lin', done: false, ignored: false, source: 'draft', ref: 'acc-1:7:43' },
      { index: 2, text: 'Old idea', done: false, ignored: true, source: null, ref: null }
    ] }),
    '2026-10-19': day('2026-10-19', { summary: 'Shipped v2.28.3\nmore' })
  }
  ;(window as any).api = {
    journal: {
      day: vi.fn(async (d?: string) => days[d ?? '2026-10-20']),
      dates: vi.fn(async () => ['2026-10-20', '2026-10-19']),
      toggle: vi.fn(async () => ({ ok: true })),
      ignore: vi.fn(async () => ({ ok: true, markedRead: true }))
    },
    approvals: { list: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]) },
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
  it('shows the day, the plan with progress, and yesterday folded; ticking writes back', async () => {
    render(<TodayTab visible />)
    expect(await screen.findByText('Tue 20 Oct')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
    expect(await screen.findByText('Shipped v2.28.3')).toBeInTheDocument()
    expect(screen.getByLabelText('Yesterday')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Reply Lin/ }))
    await waitFor(() => expect((window as any).api.journal.toggle).toHaveBeenCalledWith('2026-10-20', 1, 'Reply Lin', true))
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
  })

  it('status chips: routines that ran, the one that failed, what waits to be approved', async () => {
    render(<TodayTab visible />)
    const chips = await screen.findByLabelText('Status')
    expect(chips).toHaveTextContent('1/3 routines')
    expect(chips).toHaveTextContent('⚠ 1 failed')
    await waitFor(() => expect(chips).toHaveTextContent('2 to approve'))
    const routines = screen.getByLabelText('Routines')
    expect(routines).toHaveTextContent('Sort inbox failed 00:00')
    expect(routines).toHaveTextContent('Evening reportnext 23:59')
  })

  it('the evening report opens as Needs you / Open / Done lists, without repeating the headline', async () => {
    ;(window as any).api.journal.day = vi.fn(async () => day('2026-10-20', {
      summary: 'Cube v2 on UAT\n**Needs you**\n1. Cube Support — grant GitHub access\n2. Ben — answer Plan C\n**Done**\n- Cube v2 — MR !1066 merged'
    }))
    render(<TodayTab visible />)
    const row = await screen.findByLabelText('Summary')
    expect(row.querySelector('summary')).toHaveTextContent('Cube v2 on UAT')
    const body = row.querySelector('summary + div')!
    expect(body).not.toHaveTextContent('Cube v2 on UAT')
    expect(body.querySelector('ol')!.children).toHaveLength(2)
    expect(body.querySelector('ol')).toHaveTextContent('Cube Support — grant GitHub access')
    expect(body.querySelector('ul')).toHaveTextContent('Cube v2 — MR !1066 merged')
    expect(body.querySelectorAll('strong')[0]).toHaveTextContent('Needs you')
  })
  it('‹ opens the previous day with its summary; Today comes back', async () => {
    render(<TodayTab visible />)
    fireEvent.click(await screen.findByRole('button', { name: 'Previous day' }))
    expect(await screen.findByText('Mon 19 Oct')).toBeInTheDocument()
    expect(screen.getByLabelText('Summary')).toHaveTextContent('Shipped v2.28.3')
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByText('Tue 20 Oct')).toBeInTheDocument()
  })
  it('ignore hides the item and tells main (which marks the email read); ignored items never show', async () => {
    render(<TodayTab visible />)
    await screen.findByText('Reply Lin')
    expect(screen.queryByText('Old idea')).toBeNull()
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ignore Reply Lin' })).toHaveAttribute('title', 'Ignore · marks the email read')
    fireEvent.click(screen.getByRole('button', { name: 'Ignore Reply Lin' }))
    await waitFor(() => expect((window as any).api.journal.ignore).toHaveBeenCalledWith('2026-10-20', 1, 'Reply Lin'))
    expect(screen.queryByText('Reply Lin')).toBeNull()
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})
