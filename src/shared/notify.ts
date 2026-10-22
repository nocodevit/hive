// Notifications: the events Hive can tell the owner about, the settings
// main and renderer share, and where a click on one should land.

export type NotifyEventKind = 'agentWaiting' | 'agentPermission' | 'taskStuck' | 'butlerApproval' | 'routineFailed' | 'taskDone'

export const NOTIFY_EVENTS: NotifyEventKind[] = ['agentWaiting', 'agentPermission', 'taskStuck', 'butlerApproval', 'routineFailed', 'taskDone']

export const NOTIFY_EVENT_LABEL: Record<NotifyEventKind, string> = {
  agentWaiting: 'Agent waiting for you',
  agentPermission: 'Agent asks permission',
  taskStuck: 'Task stuck',
  butlerApproval: 'Butler needs you',
  routineFailed: 'Routine failed',
  taskDone: 'Task done'
}

/** Where a click lands: an agent's chat, Butler › Approve, Settings › Daily routine. */
export type NotifyTarget = { kind: 'agent'; agentId: string } | { kind: 'approvals' } | { kind: 'routines' } | { kind: 'skills' }

export function targetPlace(t: NotifyTarget): string {
  return t.kind === 'agent' ? `agent:${t.agentId}` : t.kind
}

/** Channels that only fire while the owner is away. Add Prime (Feishu bot) here later. */
export type AwayChannelId = 'telegram'

export interface NotifySettings {
  /** macOS notifications (master switch for the Mac). */
  mac: boolean
  events: Record<NotifyEventKind, boolean>
  quiet: { on: boolean; start: string; end: string }
  away: Record<AwayChannelId, boolean>
}

export function defaultNotifySettings(): NotifySettings {
  return {
    mac: true,
    events: { agentWaiting: true, agentPermission: true, taskStuck: true, butlerApproval: true, routineFailed: true, taskDone: false },
    quiet: { on: false, start: '22:00', end: '08:00' },
    away: { telegram: true }
  }
}

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Anything → valid settings: unknown keys dropped, bad values fall back to the defaults. */
export function sanitizeNotifySettings(v: unknown): NotifySettings {
  const d = defaultNotifySettings()
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, any>
  const bool = (x: unknown, dflt: boolean) => (typeof x === 'boolean' ? x : dflt)
  const time = (x: unknown, dflt: string) => (typeof x === 'string' && HHMM_RE.test(x) ? x : dflt)
  const events = { ...d.events }
  for (const k of NOTIFY_EVENTS) events[k] = bool(o.events?.[k], d.events[k])
  return {
    mac: bool(o.mac, d.mac),
    events,
    quiet: { on: bool(o.quiet?.on, d.quiet.on), start: time(o.quiet?.start, d.quiet.start), end: time(o.quiet?.end, d.quiet.end) },
    away: { telegram: bool(o.away?.telegram, d.away.telegram) }
  }
}

/** Telegram away push, as the settings screen sees it (the token never leaves main). */
export type TelegramStatus =
  | { state: 'off' }
  | { state: 'needs_start'; bot: string }
  | { state: 'ready'; bot: string; chatName: string }

export interface NotifyView {
  settings: NotifySettings
  telegram: TelegramStatus
  macSupported: boolean
}
