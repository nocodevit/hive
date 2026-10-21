// IPC for Butler email (settings section + wizard step).

import type { IpcMain } from 'electron'
import { mailPreset, type MailAccountInput, type MailPresetId, type MailServer } from '../shared/butler-mail'
import { isAccountId } from './butlerMailStore'
import type { ButlerMail } from './butlerMail'

function server(v: unknown): MailServer | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  return { host: String(o.host ?? ''), port: Number(o.port), secure: o.secure === true }
}

/** Only known fields with the right types get through to the mail module. */
export function readAccountInput(v: unknown): MailAccountInput | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.address !== 'string' || typeof o.preset !== 'string' || !mailPreset(o.preset)) return null
  if (o.id !== undefined && !isAccountId(o.id)) return null
  const bool = (k: string) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : undefined)
  return {
    id: o.id as string | undefined,
    address: o.address,
    preset: o.preset as MailPresetId,
    label: typeof o.label === 'string' ? o.label.slice(0, 40) : undefined,
    imap: server(o.imap),
    smtp: server(o.smtp),
    sort: bool('sort'),
    drafts: bool('drafts'),
    paused: bool('paused'),
    consent: o.consent === true ? true : undefined,
    password: typeof o.password === 'string' && o.password ? o.password : undefined
  }
}

export interface ButlerMailIpcDeps {
  ipcMain: Pick<IpcMain, 'handle'>
  mail: ButlerMail
  openExternal: (url: string) => void
}

export function registerButlerMailIpc(deps: ButlerMailIpcDeps): void {
  const { ipcMain, mail } = deps
  ipcMain.handle('mail:list', () => mail.list())
  ipcMain.handle('mail:test', (_e, v: unknown) => {
    const input = readAccountInput(v)
    return input ? mail.test(input) : { ok: false, error: 'bad_input' }
  })
  ipcMain.handle('mail:save', (_e, v: unknown) => {
    const input = readAccountInput(v)
    return input ? mail.save(input) : { ok: false, error: 'bad_input' }
  })
  ipcMain.handle('mail:remove', (_e, id: unknown) => isAccountId(id) && mail.remove(id))
  ipcMain.handle('mail:sortNow', () => mail.sortInbox())
  ipcMain.handle('mail:answer', (_e, id: unknown, text: unknown) =>
    typeof id === 'string' && typeof text === 'string' ? mail.answer(id, text) : { ok: false, error: 'bad_input' })
  // Only the preset's own help page, never a URL from the renderer.
  ipcMain.handle('mail:openHelp', (_e, presetId: unknown) => {
    const url = typeof presetId === 'string' ? mailPreset(presetId)?.url : undefined
    if (url) deps.openExternal(url)
    return !!url
  })
}
