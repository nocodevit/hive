import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createCalendar, mergeAgenda, parseCalendarLines, parseFeishuEvents, feishuDayEvents, dayRange, type AgendaEvent } from '../calendar'

const day = new Date(2026, 9, 20)
const at = (h: number, m = 0) => new Date(2026, 9, 20, h, m).getTime()
const ev = (title: string, start: number, source: AgendaEvent['source'], over: Partial<AgendaEvent> = {}): AgendaEvent =>
  ({ title, start, end: start + 3600_000, allDay: false, source, ...over })

describe('parseCalendarLines (hive-calendar output)', () => {
  it('reads events, skips junk', () => {
    const out = [
      JSON.stringify({ title: 'Standup', start: at(9), end: at(9, 15), allDay: false, location: 'Room 1' }),
      'garbage',
      JSON.stringify({ title: '', start: at(0), end: at(24), allDay: true }),
      JSON.stringify({ title: 'no start' })
    ].join('\n')
    expect(parseCalendarLines(out).events).toEqual([
      { title: 'Standup', start: at(9), end: at(9, 15), allDay: false, source: 'mac', location: 'Room 1' },
      { title: '(no title)', start: at(0), end: at(24), allDay: true, source: 'mac' }
    ])
  })
  it('reports errors and access answers', () => {
    expect(parseCalendarLines('{"error":"denied"}\n')).toEqual({ events: [], error: 'denied' })
    expect(parseCalendarLines('{"access":"granted"}')).toEqual({ events: [], access: 'granted' })
  })
})

describe('Feishu events', () => {
  it('parses timed and all-day events, drops cancelled', () => {
    const items = [
      { summary: 'Review', start_time: { timestamp: String(at(14) / 1000) }, end_time: { timestamp: String(at(15) / 1000) }, location: { name: 'B2' } },
      { summary: 'Holiday', start_time: { date: '2026-10-20' }, end_time: { date: '2026-10-21' } },
      { summary: 'Gone', status: 'cancelled', start_time: { timestamp: String(at(16) / 1000) } }
    ]
    expect(parseFeishuEvents(items)).toEqual([
      { title: 'Review', start: at(14), end: at(15), allDay: false, source: 'feishu', location: 'B2' },
      { title: 'Holiday', start: at(0), end: new Date(2026, 9, 21).getTime(), allDay: true, source: 'feishu' }
    ])
  })

  it('lists the primary calendar for that day', async () => {
    const urls: string[] = []
    const get = async (url: string) => {
      urls.push(url)
      if (url.includes('/calendars?')) return { status: 200, body: { code: 0, data: { calendar_list: [{ calendar_id: 'shared', type: 'shared' }, { calendar_id: 'cal_me', type: 'primary' }] } } }
      return { status: 200, body: { code: 0, data: { items: [{ summary: 'Sync', start_time: { timestamp: String(at(10) / 1000) }, end_time: { timestamp: String(at(11) / 1000) } }] } } }
    }
    const events = await feishuDayEvents(day, 'u-x', get)
    expect(events.map(e => e.title)).toEqual(['Sync'])
    const { start, end } = dayRange(day)
    expect(urls[1]).toContain('/calendars/cal_me/events?')
    expect(urls[1]).toContain(`start_time=${start / 1000}`)
    expect(urls[1]).toContain(`end_time=${end / 1000}`)
  })
})

describe('mergeAgenda', () => {
  it('drops identical title+start, keeps the rest sorted, all-day first', () => {
    const merged = mergeAgenda(
      [ev('Sync', at(10), 'feishu'), ev('Lunch', at(12), 'feishu')],
      [ev('Sync', at(10), 'mac'), ev('Sync', at(15), 'mac'), ev('Holiday', at(0), 'mac', { allDay: true })]
    )
    expect(merged.map(e => `${e.title}@${new Date(e.start).getHours()}:${e.source}`)).toEqual(['Holiday@0:mac', 'Sync@10:feishu', 'Lunch@12:feishu', 'Sync@15:mac'])
  })
})

describe('createCalendar.getDayAgenda', () => {
  const mk = (over: Partial<Parameters<typeof createCalendar>[0]> = {}) => createCalendar({
    dir: mkdtempSync(join(tmpdir(), 'hive-cal-')),
    feishuToken: async () => ({ ok: true, token: 'u-x' }),
    get: async url => url.includes('/calendars?')
      ? { status: 200, body: { code: 0, data: { calendar_list: [{ calendar_id: 'c', type: 'primary' }] } } }
      : { status: 200, body: { code: 0, data: { items: [{ summary: 'Sync', start_time: { timestamp: String(at(10) / 1000) }, end_time: { timestamp: String(at(11) / 1000) } }] } } },
    helperPath: () => '/fake/hive-calendar',
    exec: async (_f, args) => ({ code: 0, stdout: args[0] === '--request' ? '{"access":"granted"}' : [JSON.stringify({ title: 'Sync', start: at(10), end: at(11) }), JSON.stringify({ title: 'Gym', start: at(18), end: at(19) })].join('\n') }),
    ...over
  })

  it('merges Feishu + Mac when both are on', async () => {
    const c = mk()
    c.setSettings({ mac: true })
    const a = await c.getDayAgenda(day)
    expect(a.date).toBe('2026-10-20')
    expect(a.events.map(e => e.title)).toEqual(['Sync', 'Gym'])
    expect(a.errors).toEqual({})
  })

  it('only the enabled sources; errors are reported, not thrown', async () => {
    const c = mk({ feishuToken: async () => ({ ok: false, error: 'signed_out' }), exec: async () => ({ code: 1, stdout: '{"error":"denied"}' }) })
    expect((await c.getDayAgenda(day)).errors).toEqual({ feishu: 'signed_out' })
    c.setSettings({ mac: true })
    expect((await c.getDayAgenda(day)).errors).toEqual({ feishu: 'signed_out', mac: 'denied' })
    c.setSettings({ feishu: false, mac: false })
    expect(await c.getDayAgenda(day)).toEqual({ date: '2026-10-20', events: [], errors: {} })
  })

  it('passes the local date to the helper and asks for access with --request', async () => {
    const calls: string[][] = []
    const c = mk({ exec: async (_f, args) => { calls.push(args); return { code: 0, stdout: args[0] === '--request' ? '{"access":"granted"}' : '' } } })
    c.setSettings({ feishu: false, mac: true })
    await c.getDayAgenda(day)
    expect(calls[0]).toEqual(['--date', '2026-10-20'])
    expect(await c.requestMacAccess()).toEqual({ ok: true, granted: true })
    expect(await mk({ helperPath: () => null }).requestMacAccess()).toMatchObject({ ok: false, error: 'helper_missing' })
  })
})

describe('agendaText', () => {
  it('one line per event, times local, all-day labelled, location kept', async () => {
    const { agendaText } = await import('../calendar')
    const d = new Date(2026, 9, 21)
    const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m).getTime()
    expect(agendaText({ date: '2026-10-21', errors: {}, events: [
      { title: 'Offsite', start: d.getTime(), end: d.getTime() + 86400_000, allDay: true, source: 'feishu' },
      { title: 'Standup', start: at(9, 30), end: at(9, 45), allDay: false, source: 'mac', location: 'Room 3' }
    ] })).toBe('- all day Offsite\n- 09:30–09:45 Standup @ Room 3')
  })
  it('nothing → empty string', async () => {
    const { agendaText } = await import('../calendar')
    expect(agendaText({ date: 'x', errors: {}, events: [] })).toBe('')
  })
})
