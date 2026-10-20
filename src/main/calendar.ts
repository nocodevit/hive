// A day's agenda for Butler: Feishu calendar (user token) + Mac Calendar
// (EventKit via scripts/hive-calendar). getDayAgenda merges both and drops
// exact duplicates (same title + same start), e.g. a Feishu calendar that
// is also subscribed in Calendar.app.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface AgendaEvent {
  title: string
  /** Epoch ms. */
  start: number
  end: number
  allDay: boolean
  source: 'feishu' | 'mac'
  location?: string
}

export interface CalendarSettings { feishu: boolean; mac: boolean }
export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = { feishu: true, mac: false }

export function normalizeCalendarSettings(raw: unknown): CalendarSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    feishu: typeof s.feishu === 'boolean' ? s.feishu : DEFAULT_CALENDAR_SETTINGS.feishu,
    mac: typeof s.mac === 'boolean' ? s.mac : DEFAULT_CALENDAR_SETTINGS.mac
  }
}

/** Local midnight → next local midnight. */
export function dayRange(date: Date): { start: number; end: number } {
  const s = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const e = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return { start: s.getTime(), end: e.getTime() }
}

export const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// ── Feishu ────────────────────────────────────────────────────────────

const API = 'https://open.feishu.cn/open-apis'
type Get = (url: string, token: string) => Promise<{ status: number; body: any }>
const ok = (r: { status: number; body: any }) => r.status === 200 && r.body?.code === 0

function feishuTime(t: any): { ms: number; allDay: boolean } | null {
  if (t?.timestamp) {
    const ms = Number(t.timestamp) * 1000
    return Number.isFinite(ms) ? { ms, allDay: false } : null
  }
  if (typeof t?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
    const [y, m, d] = t.date.split('-').map(Number)
    return { ms: new Date(y, m - 1, d).getTime(), allDay: true }
  }
  return null
}

export function parseFeishuEvents(items: any[]): AgendaEvent[] {
  const out: AgendaEvent[] = []
  for (const e of items) {
    if (!e || e.status === 'cancelled') continue
    const s = feishuTime(e.start_time)
    const en = feishuTime(e.end_time)
    if (!s) continue
    out.push({
      title: String(e.summary ?? '').trim() || '(no title)',
      start: s.ms, end: en?.ms ?? s.ms, allDay: s.allDay, source: 'feishu',
      ...(e.location?.name ? { location: String(e.location.name) } : {})
    })
  }
  return out
}

export async function feishuDayEvents(date: Date, token: string, get: Get): Promise<AgendaEvent[]> {
  const cals = await get(`${API}/calendar/v4/calendars?page_size=50`, token)
  if (!ok(cals)) throw new Error(`feishu ${cals.body?.code ?? cals.status}: ${String(cals.body?.msg ?? '').slice(0, 120)}`)
  const list: any[] = cals.body.data?.calendar_list ?? cals.body.data?.items ?? []
  const primary = list.find(c => c?.type === 'primary') ?? list.find(c => c?.role === 'owner')
  if (!primary?.calendar_id) return []
  const { start, end } = dayRange(date)
  const items: any[] = []
  let pageToken = ''
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ start_time: String(Math.floor(start / 1000)), end_time: String(Math.floor(end / 1000)), page_size: '500' })
    if (pageToken) q.set('page_token', pageToken)
    const r = await get(`${API}/calendar/v4/calendars/${encodeURIComponent(primary.calendar_id)}/events?${q}`, token)
    if (!ok(r)) throw new Error(`feishu ${r.body?.code ?? r.status}: ${String(r.body?.msg ?? '').slice(0, 120)}`)
    items.push(...(r.body.data?.items ?? []))
    if (!r.body.data?.has_more || !r.body.data?.page_token) break
    pageToken = r.body.data.page_token
  }
  return parseFeishuEvents(items).filter(e => e.start < end && e.end >= start)
}

// ── Mac Calendar (scripts/hive-calendar) ─────────────────────────────

/**
 * hive-calendar prints one JSON object per line:
 *   {"title","start","end","allDay","location"?}  (start/end epoch ms)
 *   {"error":"denied"|"…"}                       (and exits non-zero)
 *   {"access":"granted"|"denied"}                 (--request)
 */
export function parseCalendarLines(stdout: string): { events: AgendaEvent[]; error?: string; access?: 'granted' | 'denied' } {
  const events: AgendaEvent[] = []
  let error: string | undefined
  let access: 'granted' | 'denied' | undefined
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    let j: any
    try { j = JSON.parse(line) } catch { continue }
    if (typeof j?.error === 'string') { error = j.error; continue }
    if (j?.access === 'granted' || j?.access === 'denied') { access = j.access; continue }
    const start = Number(j?.start), end = Number(j?.end)
    if (!Number.isFinite(start)) continue
    events.push({
      title: String(j.title ?? '').trim() || '(no title)', start, end: Number.isFinite(end) ? end : start,
      allDay: j.allDay === true, source: 'mac', ...(j.location ? { location: String(j.location) } : {})
    })
  }
  return { events, ...(error ? { error } : {}), ...(access ? { access } : {}) }
}

export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>

export async function macDayEvents(helper: string, date: Date, exec: Exec): Promise<AgendaEvent[]> {
  const r = await exec(helper, ['--date', localDateKey(date)])
  const p = parseCalendarLines(r.stdout)
  if (p.error) throw new Error(p.error)
  if (r.code !== 0) throw new Error(`hive-calendar exited ${r.code}`)
  return p.events
}

export async function macRequestAccess(helper: string, exec: Exec): Promise<{ ok: boolean; granted: boolean; error?: string }> {
  try {
    const r = await exec(helper, ['--request'])
    const p = parseCalendarLines(r.stdout)
    return { ok: !p.error, granted: p.access === 'granted', ...(p.error ? { error: p.error } : {}) }
  } catch (e) {
    return { ok: false, granted: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Merge ────────────────────────────────────────────────────────────

/** Sorted by start (all-day first); exact title+start duplicates dropped (Feishu kept). */
export function mergeAgenda(...lists: AgendaEvent[][]): AgendaEvent[] {
  const seen = new Set<string>()
  const out: AgendaEvent[] = []
  for (const e of lists.flat()) {
    const key = `${e.title.trim()}\u0000${e.start}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out.sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1))
}

export interface CalendarDeps {
  dir: string
  feishuToken: () => Promise<{ ok: boolean; token?: string; error?: string }>
  get: Get
  helperPath: () => string | null
  exec: Exec
}

export interface DayAgenda { date: string; events: AgendaEvent[]; errors: { feishu?: string; mac?: string } }

export function createCalendar(deps: CalendarDeps) {
  const file = join(deps.dir, 'calendar.json')
  const load = () => { try { return normalizeCalendarSettings(JSON.parse(readFileSync(file, 'utf8'))) } catch { return { ...DEFAULT_CALENDAR_SETTINGS } } }

  async function getDayAgenda(date: Date = new Date()): Promise<DayAgenda> {
    const s = load()
    const errors: DayAgenda['errors'] = {}
    const feishu = async () => {
      if (!s.feishu) return []
      const t = await deps.feishuToken()
      if (!t.ok || !t.token) { errors.feishu = t.error || 'signed_out'; return [] }
      try { return await feishuDayEvents(date, t.token, deps.get) } catch (e) { errors.feishu = e instanceof Error ? e.message : String(e); return [] }
    }
    const mac = async () => {
      if (!s.mac) return []
      const helper = deps.helperPath()
      if (!helper) { errors.mac = 'helper_missing'; return [] }
      try { return await macDayEvents(helper, date, deps.exec) } catch (e) { errors.mac = e instanceof Error ? e.message : String(e); return [] }
    }
    const [f, m] = await Promise.all([feishu(), mac()])
    return { date: localDateKey(date), events: mergeAgenda(f, m), errors }
  }

  return {
    getDayAgenda,
    getSettings: load,
    setSettings(patch: Partial<CalendarSettings>): CalendarSettings {
      const next = normalizeCalendarSettings({ ...load(), ...patch })
      if (!existsSync(deps.dir)) mkdirSync(deps.dir, { recursive: true })
      writeFileSync(file, JSON.stringify(next, null, 2) + '\n')
      return next
    },
    async requestMacAccess() {
      const helper = deps.helperPath()
      if (!helper) return { ok: false, granted: false, error: 'helper_missing' }
      return macRequestAccess(helper, deps.exec)
    }
  }
}

export type ButlerCalendar = ReturnType<typeof createCalendar>
