import { describe, it, expect, vi } from 'vitest'
import { createNotifier, createAgentWatch, agentWaitEvent, inQuietHours, DEDUP_MS, type Channel, type NotifyEvent } from '../notifier'
import { defaultNotifySettings, sanitizeNotifySettings, type NotifySettings } from '../../shared/notify'

const at = (hhmm: string) => new Date(`2026-10-21T${hhmm}:00`).getTime()

function setup(over: { settings?: Partial<NotifySettings>; away?: boolean; place?: string | null; now?: number } = {}) {
  let t = over.now ?? at('12:00')
  const settings: NotifySettings = { ...defaultNotifySettings(), ...over.settings }
  const sent: string[] = []
  const ch = (id: string, when: Channel['when'], on = true): Channel => ({ id, when, enabled: () => on, send: ev => { sent.push(`${id}:${ev.key}`) } })
  const state = { away: over.away ?? false, place: over.place ?? null }
  const n = createNotifier({
    settings: () => settings,
    channels: [{ ...ch('mac', 'always'), enabled: s => s.mac }, { ...ch('telegram', 'away'), enabled: s => s.away.telegram }],
    now: () => t,
    isAway: () => state.away,
    focusedPlace: () => state.place
  })
  return { n, sent, settings, state, advance: (ms: number) => { t += ms } }
}

const ev = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  kind: 'agentWaiting', key: 'wait:a1', title: 'Missy is waiting for you', body: 'done', target: { kind: 'agent', agentId: 'a1' }, ...over
})

describe('notifier', () => {
  it('sends to the Mac when present, not to away channels', async () => {
    const s = setup()
    expect(await s.n.emit(ev())).toEqual({ send: true, channels: ['mac'] })
    expect(s.sent).toEqual(['mac:wait:a1'])
  })

  it('routes to away channels too when the owner is away', async () => {
    const s = setup({ away: true })
    await s.n.emit(ev())
    expect(s.sent).toEqual(['mac:wait:a1', 'telegram:wait:a1'])
  })

  it('away push still goes out with the Mac switch off', async () => {
    const s = setup({ away: true, settings: { mac: false } })
    await s.n.emit(ev())
    expect(s.sent).toEqual(['telegram:wait:a1'])
  })

  it('nothing at all when Mac is off and the owner is present', async () => {
    const s = setup({ settings: { mac: false } })
    expect(await s.n.emit(ev())).toEqual({ send: false, reason: 'no_channel' })
  })

  it('de-dups the same key for 10 minutes', async () => {
    const s = setup()
    await s.n.emit(ev())
    s.advance(DEDUP_MS - 1)
    expect(await s.n.emit(ev())).toEqual({ send: false, reason: 'duplicate' })
    await s.n.emit(ev({ key: 'wait:a2', target: { kind: 'agent', agentId: 'a2' } }))
    s.advance(1)
    expect((await s.n.emit(ev())).send).toBe(true)
    expect(s.sent).toEqual(['mac:wait:a1', 'mac:wait:a2', 'mac:wait:a1'])
  })

  it('a suppressed event does not start the de-dup window', async () => {
    const s = setup({ place: 'agent:a1' })
    expect(await s.n.emit(ev())).toEqual({ send: false, reason: 'looking' })
    s.state.place = null
    expect((await s.n.emit(ev())).send).toBe(true)
  })

  it('no popup while Hive is focused on that agent; other places still notify', async () => {
    const s = setup({ place: 'agent:a1' })
    expect((await s.n.emit(ev())).send).toBe(false)
    expect((await s.n.emit(ev({ key: 'wait:a2', target: { kind: 'agent', agentId: 'a2' } }))).send).toBe(true)
    s.state.place = 'approvals'
    expect(await s.n.emit(ev({ kind: 'butlerApproval', key: 'approval:x', target: { kind: 'approvals' } }))).toEqual({ send: false, reason: 'looking' })
  })

  it('per-event switches: task done is off by default', async () => {
    const s = setup()
    expect(await s.n.emit(ev({ kind: 'taskDone', key: 'done:t1' }))).toEqual({ send: false, reason: 'event_off' })
    s.settings.events.agentWaiting = false
    expect(await s.n.emit(ev())).toEqual({ send: false, reason: 'event_off' })
    s.settings.events.taskDone = true
    expect((await s.n.emit(ev({ kind: 'taskDone', key: 'done:t1' }))).send).toBe(true)
  })

  it('quiet hours silence every channel', async () => {
    const s = setup({ now: at('23:30'), away: true, settings: { quiet: { on: true, start: '22:00', end: '08:00' } } })
    expect(await s.n.emit(ev())).toEqual({ send: false, reason: 'quiet' })
    expect(s.sent).toEqual([])
  })

  it('a failing channel does not stop the others', async () => {
    const sent: string[] = []
    const n = createNotifier({
      settings: () => defaultNotifySettings(),
      channels: [
        { id: 'bad', when: 'always', enabled: () => true, send: () => { throw new Error('boom') } },
        { id: 'ok', when: 'always', enabled: () => true, send: e => { sent.push(e.key) } }
      ],
      isAway: () => false,
      focusedPlace: () => null
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await n.emit(ev())
    expect(sent).toEqual(['wait:a1'])
    warn.mockRestore()
  })
})

describe('inQuietHours', () => {
  const q = (start: string, end: string, on = true) => ({ on, start, end })
  it('wraps past midnight', () => {
    expect(inQuietHours(q('22:00', '08:00'), new Date(at('22:00')))).toBe(true)
    expect(inQuietHours(q('22:00', '08:00'), new Date(at('07:59')))).toBe(true)
    expect(inQuietHours(q('22:00', '08:00'), new Date(at('08:00')))).toBe(false)
    expect(inQuietHours(q('22:00', '08:00'), new Date(at('12:00')))).toBe(false)
  })
  it('same-day window', () => {
    expect(inQuietHours(q('12:00', '13:30'), new Date(at('12:45')))).toBe(true)
    expect(inQuietHours(q('12:00', '13:30'), new Date(at('13:30')))).toBe(false)
  })
  it('off, or start = end, is never quiet', () => {
    expect(inQuietHours(q('22:00', '08:00', false), new Date(at('23:00')))).toBe(false)
    expect(inQuietHours(q('09:00', '09:00'), new Date(at('09:00')))).toBe(false)
  })
})

describe('sanitizeNotifySettings', () => {
  it('defaults: Mac on, task done off, quiet off', () => {
    const s = sanitizeNotifySettings(undefined)
    expect(s.mac).toBe(true)
    expect(s.events.taskDone).toBe(false)
    expect(s.events.agentPermission).toBe(true)
    expect(s.quiet.on).toBe(false)
  })
  it('drops bad values and unknown keys', () => {
    const s = sanitizeNotifySettings({ mac: 'yes', events: { taskDone: true, bogus: true }, quiet: { on: true, start: '25:00', end: '07:30' }, extra: 1 })
    expect(s.mac).toBe(true)
    expect(s.events.taskDone).toBe(true)
    expect('bogus' in s.events).toBe(false)
    expect(s.quiet).toEqual({ on: true, start: '22:00', end: '07:30' })
    expect('extra' in s).toBe(false)
  })
})

describe('agent watch', () => {
  const assistant = (text: string) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
  const perm = (tool: string, input: unknown) => ({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: tool, input } })

  it('a finished turn waits with the last text', () => {
    const w = createAgentWatch(() => 5)
    expect(w.onEvent('a1', assistant('All tests pass. Merge?'))).toBeNull()
    expect(w.onEvent('a1', { type: 'result', subtype: 'success' })).toEqual({ agentId: 'a1', state: 'waiting', since: 5, text: 'All tests pass. Merge?' })
    expect(w.pending(['a1']).map(x => x.state)).toEqual(['waiting'])
  })

  it('permission and question requests', () => {
    const w = createAgentWatch()
    expect(w.onEvent('a1', perm('Bash', { command: 'git push' }))).toMatchObject({ state: 'permission', text: 'Bash · git push' })
    expect(w.onEvent('a2', perm('AskUserQuestion', { questions: [{ question: 'Which DB?' }] }))).toMatchObject({ state: 'question', text: 'Which DB?' })
  })

  it('new generation clears the wait; dead chats are not pending', () => {
    const w = createAgentWatch()
    w.onEvent('a1', perm('Bash', { command: 'ls' }))
    w.onEvent('a2', { type: 'result' })
    w.onEvent('a1', { type: 'user', message: { content: [] } })
    expect(w.pending(['a1', 'a2']).map(x => x.agentId)).toEqual(['a2'])
    expect(w.pending([])).toEqual([])
  })

  it('status-neutral events change nothing', () => {
    const w = createAgentWatch()
    w.onEvent('a1', { type: 'result' })
    expect(w.onEvent('a1', { type: 'rate_limit_event' })).toBeNull()
    expect(w.pending(['a1'])).toHaveLength(1)
  })

  it('notification text per wait', () => {
    expect(agentWaitEvent({ agentId: 'a1', state: 'permission', since: 0, text: 'Bash · ls' }, 'Missy'))
      .toEqual({ kind: 'agentPermission', key: 'perm:a1', title: 'Missy asks permission', body: 'Bash · ls', target: { kind: 'agent', agentId: 'a1' } })
    expect(agentWaitEvent({ agentId: 'a1', state: 'waiting', since: 0, text: '' }, 'Missy'))
      .toMatchObject({ kind: 'agentWaiting', key: 'wait:a1', title: 'Missy is waiting for you', body: 'Turn finished' })
    expect(agentWaitEvent({ agentId: 'a1', state: 'question', since: 0, text: 'Which DB?' }, 'Missy'))
      .toMatchObject({ kind: 'agentWaiting', title: 'Missy asks you' })
  })
})
