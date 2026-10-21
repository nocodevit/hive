// Butler email accounts: <butler dir>/mail/accounts.json for the settings,
// <butler dir>/mail/<accountId>.bin for each password (encrypted with the
// injected crypto — Electron safeStorage in the app, a fake in tests).

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mailPreset, type MailAccount, type MailAccountInput, type MailAccountStatus, type MailServer } from '../shared/butler-mail'

export interface MailCrypto {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

const ID_RE = /^acc-[a-z0-9]{8,32}$/

export function isAccountId(v: unknown): v is string {
  return typeof v === 'string' && ID_RE.test(v)
}

export function mailDir(butlerFolder: string): string {
  return join(butlerFolder, 'mail')
}

function writeAtomic(file: string, data: string | Buffer, mode?: number) {
  writeFileSync(file + '.tmp', data, mode ? { mode } : undefined)
  renameSync(file + '.tmp', file)
}

export function createPasswordStore(dir: string, crypto: MailCrypto) {
  const fileOf = (id: string) => {
    if (!isAccountId(id)) throw new Error('bad_account_id')
    return join(dir, `${id}.bin`)
  }
  return {
    save(id: string, password: string) {
      mkdirSync(dir, { recursive: true })
      writeAtomic(fileOf(id), crypto.encrypt(password), 0o600)
    },
    load(id: string): string | null {
      try { return crypto.decrypt(readFileSync(fileOf(id))) } catch { return null }
    },
    has(id: string): boolean {
      return existsSync(fileOf(id))
    },
    remove(id: string) {
      try { unlinkSync(fileOf(id)) } catch { /* none */ }
    }
  }
}
export type PasswordStore = ReturnType<typeof createPasswordStore>

function server(v: unknown, fallback: MailServer): MailServer {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    host: typeof o.host === 'string' ? o.host.trim() : fallback.host,
    port: typeof o.port === 'number' && o.port > 0 && o.port < 65536 ? Math.floor(o.port) : fallback.port,
    secure: typeof o.secure === 'boolean' ? o.secure : fallback.secure
  }
}

/** Settings for one account from raw input; preset servers unless "Other". */
export function normalizeAccount(input: MailAccountInput, id: string, prev?: MailAccount, now: number = Date.now()): MailAccount {
  const preset = mailPreset(input.preset) ?? mailPreset('other')!
  const address = String(input.address || '').trim()
  const custom = preset.id === 'other'
  return {
    id,
    address,
    label: typeof input.label === 'string' ? input.label.trim() : prev?.label ?? '',
    preset: preset.id,
    imap: custom ? server(input.imap, prev?.imap ?? preset.imap) : { ...preset.imap },
    smtp: custom ? server(input.smtp, prev?.smtp ?? preset.smtp) : { ...preset.smtp },
    sort: typeof input.sort === 'boolean' ? input.sort : prev?.sort ?? true,
    drafts: typeof input.drafts === 'boolean' ? input.drafts : prev?.drafts ?? true,
    paused: typeof input.paused === 'boolean' ? input.paused : prev?.paused ?? false,
    consentAt: prev?.consentAt ?? (input.consent === true ? now : null)
  }
}

export function validateAccount(a: MailAccount): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.address)) return 'bad_address'
  if (!a.imap.host || !a.smtp.host) return 'missing_server'
  return null
}

interface FileShape { accounts: MailAccount[]; status: Record<string, MailAccountStatus> }

export function createAccountStore(dir: string, newId: () => string = () => 'acc-' + randomUUID().replace(/-/g, '').slice(0, 12)) {
  const file = join(dir, 'accounts.json')
  const save = (s: FileShape) => {
    mkdirSync(dir, { recursive: true })
    writeAtomic(file, JSON.stringify(s, null, 2))
  }
  const load = (): FileShape => {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'))
      const accounts = Array.isArray(j?.accounts) ? (j.accounts as MailAccount[]).filter(a => isAccountId(a?.id)) : []
      const s: FileShape = { accounts, status: j?.status && typeof j.status === 'object' ? j.status : {} }
      // Accounts added before the consent question: mark them as still to confirm.
      const old = accounts.filter(a => typeof a.consentAt !== 'number' && a.consentAt !== null)
      if (old.length) {
        for (const a of old) a.consentAt = null
        save(s)
      }
      return s
    } catch { return { accounts: [], status: {} } }
  }
  return {
    list: () => load().accounts,
    get: (id: string) => load().accounts.find(a => a.id === id),
    statusOf: (id: string): MailAccountStatus | undefined => load().status[id],
    newId,
    upsert(a: MailAccount) {
      const s = load()
      const i = s.accounts.findIndex(x => x.id === a.id)
      if (i >= 0) s.accounts[i] = a; else s.accounts.push(a)
      save(s)
    },
    remove(id: string): boolean {
      const s = load()
      const n = s.accounts.length
      s.accounts = s.accounts.filter(a => a.id !== id)
      delete s.status[id]
      save(s)
      return s.accounts.length < n
    },
    setStatus(id: string, st: MailAccountStatus) {
      const s = load()
      if (!s.accounts.some(a => a.id === id)) return
      s.status[id] = st
      save(s)
    }
  }
}
export type AccountStore = ReturnType<typeof createAccountStore>
