import { describe, it, expect } from 'vitest'
import { reconcileLiveStatus } from '../live-status'

const a = (id: string, status: 'working' | 'waiting' | 'done') => ({ id, status, name: id })

describe('reconcileLiveStatus', () => {
  it('a live idle chat shown gray becomes waiting', () => {
    const out = reconcileLiveStatus([a('m', 'done')], [{ agentId: 'm', chatLive: true, activity: 'waiting' }])
    expect(out[0].status).toBe('waiting')
  })
  it('a live chat mid-turn is working', () => {
    expect(reconcileLiveStatus([a('m', 'waiting')], [{ agentId: 'm', chatLive: true, activity: 'working' }])[0].status).toBe('working')
  })
  it('agents without a live chat (terminal sessions, off) are left to the hooks', () => {
    const agents = [a('t', 'working'), a('o', 'done')]
    expect(reconcileLiveStatus(agents, [{ agentId: 't', chatLive: false, activity: 'off' }])).toBe(agents)
  })
  it('does not downgrade working to waiting from an idle reading', () => {
    expect(reconcileLiveStatus([a('m', 'working')], [{ agentId: 'm', chatLive: true, activity: 'waiting' }])[0].status).toBe('working')
  })
  it('returns the same array when nothing changes', () => {
    const agents = [a('m', 'waiting')]
    expect(reconcileLiveStatus(agents, [{ agentId: 'm', chatLive: true, activity: 'waiting' }])).toBe(agents)
  })
})
