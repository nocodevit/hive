// Wiring for notifications: settings file, the Telegram token (safeStorage),
// the channels (Mac, Telegram away push), the notifier, click → open the
// right place, and the IPC the settings screen uses. index.ts calls
// setupNotifications once and feeds it events.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { IpcMain, SafeStorage } from 'electron'
import { createNotifier, AWAY_IDLE_SEC, type Channel, type NotifyEvent } from './notifier'
import { checkToken, findStartChat, sendMessage, pushText, BOTFATHER_URL, type FetchLike } from './telegram'
import { sanitizeNotifySettings, type NotifySettings, type NotifyTarget, type NotifyView, type TelegramStatus } from '../shared/notify'

interface NotificationLike {
  on(ev: 'click' | 'close' | 'show', cb: () => void): unknown
  show(): void
}

export interface NotifyDeps {
  ipcMain: IpcMain
  safeStorage: SafeStorage
  dataDir: string
  /** e2e: record instead of showing real macOS notifications. */
  headless: boolean
  /** Isolated test data dir that asked for a plain-file token. */
  plainStore: boolean
  makeNotification: (o: { title: string; body: string }) => NotificationLike
  macSupported: () => boolean
  /** powerMonitor.getSystemIdleState; null before the app is ready. */
  idleState: (thresholdSec: number) => string | null
  windowFocused: () => boolean
  /** Show (or create) Hive's window, then tell the renderer where to go. */
  open: (target: NotifyTarget) => void
  openExternal: (url: string) => void
  fetch?: FetchLike
}

const SYSTEM_SETTINGS_URL = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.hive.app'
const SHOW_WAIT_MS = 4000

export function setupNotifications(d: NotifyDeps) {
  const fetchFn: FetchLike = d.fetch ?? ((u, init) => fetch(u, init as RequestInit) as unknown as ReturnType<FetchLike>)
  const settingsFile = join(d.dataDir, 'notifications.json')
  const tgFile = join(d.dataDir, 'telegram.json')
  const tokenFile = join(d.dataDir, 'telegram-token.bin')
  const logFile = join(d.dataDir, 'notify-log.jsonl')

  const writeJson = (f: string, v: unknown) => {
    if (!existsSync(d.dataDir)) mkdirSync(d.dataDir, { recursive: true })
    writeFileSync(f + '.tmp', JSON.stringify(v, null, 2))
    renameSync(f + '.tmp', f)
  }
  const readJson = (f: string): any => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

  let settings: NotifySettings = sanitizeNotifySettings(readJson(settingsFile))
  const saveSettings = (v: unknown) => { settings = sanitizeNotifySettings(v); writeJson(settingsFile, settings); return settings }

  // ── Telegram token: encrypted at rest, never logged ──
  const loadToken = (): string | null => {
    try {
      const raw = readFileSync(tokenFile)
      return d.plainStore ? raw.toString('utf8') : d.safeStorage.decryptString(raw)
    } catch { return null }
  }
  const saveToken = (t: string) => {
    if (!existsSync(d.dataDir)) mkdirSync(d.dataDir, { recursive: true })
    writeFileSync(tokenFile, d.plainStore ? Buffer.from(t, 'utf8') : d.safeStorage.encryptString(t), { mode: 0o600 })
  }
  type TgMeta = { bot: string; chatId?: string; chatName?: string }
  const tgMeta = (): TgMeta | null => { const j = readJson(tgFile); return j && typeof j.bot === 'string' ? j : null }
  const tgStatus = (): TelegramStatus => {
    const m = tgMeta()
    if (!m || !loadToken()) return { state: 'off' }
    return m.chatId ? { state: 'ready', bot: m.bot, chatName: m.chatName || '' } : { state: 'needs_start', bot: m.bot }
  }

  // ── Channels ──
  const live = new Set<NotificationLike>()
  const record = (channel: string, ev: Pick<NotifyEvent, 'title' | 'body'> & Partial<NotifyEvent>) => {
    try { appendFileSync(logFile, JSON.stringify({ t: Date.now(), channel, kind: ev.kind, title: ev.title, target: ev.target }) + '\n') } catch { /* diagnostics only */ }
  }
  /** Show one Mac notification; resolves true when macOS reported it shown. */
  const showMac = (title: string, body: string, target?: NotifyTarget): Promise<boolean> => {
    if (d.headless) { record('mac', { title, body, target }); return Promise.resolve(true) }
    if (!d.macSupported()) return Promise.resolve(false)
    return new Promise(resolve => {
      const n = d.makeNotification({ title, body })
      live.add(n)
      const timer = setTimeout(() => resolve(false), SHOW_WAIT_MS)
      n.on('show', () => { clearTimeout(timer); resolve(true) })
      n.on('click', () => { live.delete(n); if (target) d.open(target) })
      n.on('close', () => live.delete(n))
      n.show()
      // Drop the reference later so click still works while it is on screen.
      setTimeout(() => live.delete(n), 6 * 3600_000).unref?.()
    })
  }
  const macChannel: Channel = {
    id: 'mac',
    when: 'always',
    enabled: s => s.mac,
    send: ev => { void showMac(ev.title, ev.body, ev.target) }
  }
  const telegramChannel: Channel = {
    id: 'telegram',
    when: 'away',
    enabled: s => s.away.telegram && tgStatus().state === 'ready',
    send: async ev => {
      const token = loadToken(), m = tgMeta()
      if (!token || !m?.chatId) return
      if (d.headless) { record('telegram', ev); return }
      await sendMessage(fetchFn, token, m.chatId, pushText(ev.title, ev.body))
    }
  }

  // Look at it = Hive focused and showing that place (reported by the renderer).
  let place: string | null = null
  const notifier = createNotifier({
    settings: () => settings,
    channels: [macChannel, telegramChannel],
    isAway: () => { const s = d.idleState(AWAY_IDLE_SEC); return s === 'idle' || s === 'locked' },
    focusedPlace: () => (place && d.windowFocused() ? place : null)
  })

  const view = (): NotifyView => ({ settings, telegram: tgStatus(), macSupported: d.headless || d.macSupported() })

  d.ipcMain.handle('notify:get', () => view())
  d.ipcMain.handle('notify:save', (_e, v: unknown) => { saveSettings(v); return view() })
  d.ipcMain.on('notify:place', (_e, p: unknown) => { place = typeof p === 'string' && p ? p : null })
  d.ipcMain.handle('notify:test', async () => ({ ok: true, shown: await showMac('Hive', 'Notifications are on') }))
  d.ipcMain.handle('notify:openSystemSettings', () => { d.openExternal(SYSTEM_SETTINGS_URL); return { ok: true } })

  d.ipcMain.handle('telegram:openBotFather', () => { d.openExternal(BOTFATHER_URL); return { ok: true } })
  d.ipcMain.handle('telegram:setToken', async (_e, token: unknown) => {
    if (typeof token !== 'string') return { ok: false, error: 'not_a_token' }
    const r = await checkToken(fetchFn, token)
    if (!r.ok) return r
    saveToken(token.trim())
    writeJson(tgFile, { bot: r.bot })
    return { ok: true, status: tgStatus() }
  })
  /** One look at getUpdates for a /start; on success remember the chat and send a test. */
  d.ipcMain.handle('telegram:findChat', async () => {
    const token = loadToken(), m = tgMeta()
    if (!token || !m) return { ok: false, error: 'no_token' }
    const r = await findStartChat(fetchFn, token)
    if (!r.ok) return r
    writeJson(tgFile, { bot: m.bot, chatId: r.chatId, chatName: r.name })
    await sendMessage(fetchFn, token, r.chatId, pushText('Hive', 'Connected. You will get a message here when an agent needs you while you are away.'))
    return { ok: true, status: tgStatus() }
  })
  d.ipcMain.handle('telegram:test', async () => {
    const token = loadToken(), m = tgMeta()
    if (!token || !m?.chatId) return { ok: false, error: 'not_ready' }
    return sendMessage(fetchFn, token, m.chatId, pushText('Hive', 'Test message'))
  })
  d.ipcMain.handle('telegram:disconnect', () => {
    try { unlinkSync(tokenFile) } catch { /* none */ }
    try { unlinkSync(tgFile) } catch { /* none */ }
    return { ok: true, status: tgStatus() }
  })

  return { notifier, emit: (ev: NotifyEvent) => notifier.emit(ev) }
}
