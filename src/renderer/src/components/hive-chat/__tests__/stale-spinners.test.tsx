// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { TimelineRow, HiveChatPausedContext } from '../renderers'

afterEach(() => { cleanup(); vi.useRealTimers() })

const tool = { kind: 'tool_call', id: 't1', toolUseId: 'u1', name: 'Bash', input: { command: 'sleep 99' } } as any
const compacting = { kind: 'system', id: 's1', text: '⏳ Compacting context…' } as any
const shown = (ui: React.ReactElement) => render(<HiveChatPausedContext.Provider value={false}>{ui}</HiveChatPausedContext.Provider>)

describe('finished turns keep no spinners running (idle CPU)', () => {
  it('a tool call with no result shows "still running" only while its turn is open', () => {
    vi.useFakeTimers()
    shown(<><TimelineRow entry={tool} live /><TimelineRow entry={{ ...tool, id: 't2' }} live={false} /></>)
    act(() => { vi.advanceTimersByTime(6000) })
    expect(screen.getAllByText(/still running/)).toHaveLength(1)
  })
  it('an old ⏳ line is plain text: no rotating hourglass, no cycling dots', () => {
    const { container } = shown(<TimelineRow entry={compacting} live={false} />)
    expect(screen.getByText('⏳ Compacting context…')).toBeInTheDocument()
    expect(container.querySelector('.hive-dots-loader')).toBeNull()
    expect(container.innerHTML).not.toContain('hg-flip 2s')
  })
  it('the live ⏳ line animates, and holds still when its chat is hidden', () => {
    const live = shown(<TimelineRow entry={compacting} live />)
    expect(live.container.querySelector('.hive-dots-loader')).not.toBeNull()
    cleanup()
    const hidden = render(<HiveChatPausedContext.Provider value={true}><TimelineRow entry={compacting} live /></HiveChatPausedContext.Provider>)
    expect(hidden.container.querySelector('.hive-dots-loader')).toBeNull()
    expect(hidden.container.innerHTML).not.toContain('hg-flip 2s')
  })
})
