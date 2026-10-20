import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAIL_PRESETS, mailPreset, presetForAddress } from '../../shared/butler-mail'
import { createAccountStore, createPasswordStore, mailDir, normalizeAccount } from '../butlerMailStore'
import { createApprovals } from '../approvals'
import {
  buildReplyMessage, createButlerMail, parseClassification, replyApproval, replySubject, FIRST_RUN_LOOKBACK,
  type MailClients, type OutgoingMail, type RawMail
} from '../butlerMail'

const fakeCrypto = { encrypt: (s: string) => Buffer.from('enc:' + s), decrypt: (b: Buffer) => b.toString().replace(/^enc:/, '') }

const mail = (uid: number, over: Partial<RawMail> = {}): RawMail => ({
  uid, messageId: `<m${uid}@x.com>`, from: { name: `Sender${uid}`, address: `s${uid}@x.com` }, subject: `Subject ${uid}`,
  date: 1_700_000_000_000, text: `Body ${uid}`, references: [], seen: false, ...over
})

function setup(opts: { inbox?: RawMail[]; uidValidity?: number; classify?: (uids: number[]) => string } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'hive-mail-'))
  let n = 0
  const accounts = createAccountStore(mailDir(folder), () => 'acc-aaaaaaa' + n++)
  const passwords = createPasswordStore(mailDir(folder), fakeCrypto)
  const approvals = createApprovals({ dir: folder })
  const box = { inbox: opts.inbox ?? [], uidValidity: opts.uidValidity ?? 7 }
  const sent: OutgoingMail[] = []
  const fetchCalls: number[] = []
  const prompts: string[] = []
  const clients: MailClients = {
    async openInbox() {
      const uidNext = Math.max(0, ...box.inbox.map(m => m.uid)) + 1
      return {
        info: { uidValidity: box.uidValidity, uidNext, unseen: box.inbox.filter(m => !m.seen).length },
        async fetchAfter(uid, limit) { fetchCalls.push(uid); return box.inbox.filter(m => m.uid > uid).slice(0, limit) },
        async close() {}
      }
    },
    async send(_a, _p, msg) { sent.push(msg); return { messageId: '<sent@x>' } }
  }
  const classify = opts.classify ?? ((uids: number[]) => JSON.stringify(uids.map(u => ({ uid: u, category: u % 2 ? 'needs-reply' : 'noise', summary: `s${u}` }))))
  const runClaude = async (prompt: string) => {
    prompts.push(prompt)
    if (prompt.startsWith('Use the sort-inbox skill.')) {
      const uids = [...prompt.matchAll(/^### uid (\d+)$/gm)].map(m => Number(m[1]))
      return classify(uids)
    }
    return 'Thanks, on it.'
  }
  const m = createButlerMail({ folder, accounts, passwords, clients, runClaude, approvals, now: () => 1_700_000_000_000 })
  const saved = m.save({ address: 'mei@corp.com', preset: 'exmail', password: 'pw', label: 'Work' })
  if (!saved.ok) throw new Error(saved.error)
  return { folder, m, box, approvals, sent, fetchCalls, prompts, accounts, passwords, id: saved.account.id }
}

describe('mail presets', () => {
  it('has the five providers with SSL IMAP 993 / SMTP 465', () => {
    expect(MAIL_PRESETS.map(p => p.id)).toEqual(['exmail', 'qq', '163', 'gmail', 'other'])
    expect(mailPreset('exmail')).toMatchObject({ imap: { host: 'imap.exmail.qq.com', port: 993, secure: true }, smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true } })
    expect(mailPreset('qq')!.imap.host).toBe('imap.qq.com')
    expect(mailPreset('163')!.smtp.host).toBe('smtp.163.com')
    expect(mailPreset('gmail')!.imap.host).toBe('imap.gmail.com')
    for (const p of MAIL_PRESETS) expect(p.steps.length).toBeGreaterThan(0)
  })
  it('guesses a preset only from an exact domain', () => {
    expect(presetForAddress('a@qq.com')).toBe('qq')
    expect(presetForAddress('a@gmail.com')).toBe('gmail')
    expect(presetForAddress('a@163.com')).toBe('163')
    expect(presetForAddress('a@mail.qq.com.cn')).toBeNull()
    expect(presetForAddress('a@corp.com')).toBeNull()
  })
  it('uses preset servers unless Other', () => {
    const a = normalizeAccount({ address: 'a@corp.com', preset: 'exmail', imap: { host: 'evil', port: 1, secure: false } }, 'acc-aaaaaaaa')
    expect(a.imap.host).toBe('imap.exmail.qq.com')
    const o = normalizeAccount({ address: 'a@corp.com', preset: 'other', imap: { host: 'imap.corp.com', port: 143, secure: false } }, 'acc-aaaaaaaa')
    expect(o.imap).toEqual({ host: 'imap.corp.com', port: 143, secure: false })
  })
})

describe('mail accounts', () => {
  it('stores the password encrypted, never in accounts.json', () => {
    const t = setup()
    const raw = readFileSync(join(t.folder, 'mail', `${t.id}.bin`), 'utf8')
    expect(raw).toBe('enc:pw')
    expect(readFileSync(join(t.folder, 'mail', 'accounts.json'), 'utf8')).not.toContain('pw"')
    expect(t.passwords.load(t.id)).toBe('pw')
    expect(t.m.list()[0]).toMatchObject({ address: 'mei@corp.com', label: 'Work', hasPassword: true, sort: true, drafts: true })
  })
  it('refuses a new account without a password and a duplicate address', () => {
    const t = setup()
    expect(t.m.save({ address: 'x@corp.com', preset: 'exmail' })).toEqual({ ok: false, error: 'no_password' })
    expect(t.m.save({ address: 'MEI@corp.com', preset: 'exmail', password: 'p' })).toEqual({ ok: false, error: 'already_added' })
  })
  it('edits keep the stored password; remove drops password and state', async () => {
    const t = setup()
    expect(t.m.save({ id: t.id, address: 'mei@corp.com', preset: 'exmail', paused: true }).ok).toBe(true)
    expect(t.passwords.load(t.id)).toBe('pw')
    expect(t.m.list()[0].paused).toBe(true)
    expect(t.m.remove(t.id)).toBe(true)
    expect(t.passwords.has(t.id)).toBe(false)
    expect(t.m.list()).toEqual([])
  })
  it('test reports unread or the raw server error', async () => {
    const t = setup({ inbox: [mail(1), mail(2, { seen: true })] })
    expect(await t.m.test({ id: t.id, address: 'mei@corp.com', preset: 'exmail' })).toEqual({ ok: true, unread: 1 })
    const bad = createButlerMail({
      folder: t.folder, accounts: t.accounts, passwords: t.passwords, approvals: createApprovals({ dir: t.folder }),
      runClaude: async () => '',
      clients: { openInbox: async () => { throw Object.assign(new Error('x'), { responseText: 'LOGIN failed: 授权码错误' }) }, send: async () => ({}) }
    })
    expect(await bad.test({ address: 'a@corp.com', preset: 'exmail', password: 'p' })).toEqual({ ok: false, error: 'LOGIN failed: 授权码错误' })
  })
})

describe('sortInbox: UID tracking', () => {
  it('first run looks back only at unread mail, then resumes after the last UID', async () => {
    const t = setup({ inbox: [mail(1), mail(2, { seen: true }), mail(3)] })
    const r1 = await t.m.sortInbox()
    expect(r1[0]).toMatchObject({ fetched: 3, sorted: 2, drafted: 2 })
    expect(t.fetchCalls[0]).toBe(Math.max(0, 4 - 1 - FIRST_RUN_LOOKBACK))
    t.box.inbox.push(mail(4), mail(5))
    const r2 = await t.m.sortInbox()
    expect(t.fetchCalls.at(-1)).toBe(3)
    expect(r2[0]).toMatchObject({ fetched: 2, sorted: 2, drafted: 1 })
    const r3 = await t.m.sortInbox()
    expect(r3[0]).toMatchObject({ fetched: 0, sorted: 0 })
    const state = JSON.parse(readFileSync(join(t.folder, 'mail', 'state.json'), 'utf8'))
    expect(state[t.id]).toEqual({ uidValidity: 7, lastUid: 5 })
    const lines = readFileSync(join(t.folder, 'mail', 'processed.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(lines.map(l => l.uid)).toEqual([1, 3, 4, 5])
  })
  it('a new UIDVALIDITY restarts the baseline but never re-handles the same Message-ID', async () => {
    const t = setup({ inbox: [mail(1)] })
    await t.m.sortInbox()
    t.box.uidValidity = 8
    t.box.inbox = [mail(10, { messageId: '<m1@x.com>' }), mail(11)]
    const r = await t.m.sortInbox()
    expect(r[0].sorted).toBe(1)
    expect(t.approvals.pending().map(a => a.payload.inReplyTo)).toEqual(['<m1@x.com>', '<m11@x.com>'])
  })
  it('a message missing from the answer stops the run there and is retried', async () => {
    let drop = true
    const t = setup({
      inbox: [mail(1), mail(3), mail(5)],
      classify: uids => JSON.stringify(uids.filter(u => !(drop && u === 3)).map(u => ({ uid: u, category: 'fyi' })))
    })
    const r1 = await t.m.sortInbox()
    expect(r1[0].sorted).toBe(1)
    expect(JSON.parse(readFileSync(join(t.folder, 'mail', 'state.json'), 'utf8'))[t.id].lastUid).toBe(1)
    drop = false
    const r2 = await t.m.sortInbox()
    expect(r2[0].sorted).toBe(2)
  })
  it('bad JSON leaves the UID where it was and records the error', async () => {
    const t = setup({ inbox: [mail(1)], classify: () => 'sorry' })
    const r = await t.m.sortInbox()
    expect(r[0].error).toMatch(/no JSON/)
    expect(t.m.list()[0].status).toMatchObject({ ok: false })
  })
  it('skips paused accounts and accounts with sorting off', async () => {
    const t = setup({ inbox: [mail(1)] })
    t.m.save({ id: t.id, address: 'mei@corp.com', preset: 'exmail', sort: false })
    expect(await t.m.sortInbox()).toEqual([])
  })
  it('drafts off: sorted but nothing queued', async () => {
    const t = setup({ inbox: [mail(1)] })
    t.m.save({ id: t.id, address: 'mei@corp.com', preset: 'exmail', drafts: false })
    const r = await t.m.sortInbox()
    expect(r[0]).toMatchObject({ sorted: 1, drafted: 0 })
    expect(t.approvals.pending()).toEqual([])
  })
})

describe('classification → approval', () => {
  it('parses exact uids and known categories only', () => {
    const r = parseClassification('Here: [{"uid":1,"category":"customer","summary":"pricing"},{"uid":9,"category":"fyi"},{"uid":2,"category":"spam"}]', [1, 2])
    expect([...r.entries()]).toEqual([[1, { category: 'customer', summary: 'pricing' }]])
  })
  it('queues needs-reply and customer drafts with the reply payload', async () => {
    const t = setup({
      inbox: [mail(1, { from: { name: 'Lin', address: 'lin@c.com' }, subject: 'UAT down?', references: ['<a@x>'], replyTo: { name: '', address: 'support@c.com' } }), mail(2), mail(3)],
      classify: () => '[{"uid":1,"category":"needs-reply"},{"uid":2,"category":"customer"},{"uid":3,"category":"notice"}]'
    })
    await t.m.sortInbox()
    const p = t.approvals.pending()
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({
      kind: 'email.reply', title: 'Lin · UAT down?', subtitle: 'email reply · from mei@corp.com', draft: 'Thanks, on it.', action: 'Send',
      payload: { accountId: t.id, to: 'support@c.com', subject: 'Re: UAT down?', inReplyTo: '<m1@x.com>', references: ['<a@x>', '<m1@x.com>'] }
    })
    expect(t.sent).toEqual([])
    expect(t.prompts.filter(x => x.startsWith('Use the reply-email skill.'))).toHaveLength(2)
  })
  it('keeps an existing Re: / 回复: subject', () => {
    expect(replySubject('Re: hi')).toBe('Re: hi')
    expect(replySubject('回复：你好')).toBe('回复：你好')
    expect(replySubject('hi')).toBe('Re: hi')
  })
})

describe('email.reply executor', () => {
  it('sends from the receiving account with threading headers, only on approve', async () => {
    const t = setup({ inbox: [mail(1, { references: ['<root@x>'] })], classify: () => '[{"uid":1,"category":"needs-reply"}]' })
    await t.m.sortInbox()
    const item = t.approvals.pending()[0]
    expect(t.sent).toEqual([])
    expect(await t.approvals.approve(item.id, 'Edited reply')).toEqual({ ok: true })
    expect(t.sent).toEqual([{
      from: { name: 'Work', address: 'mei@corp.com' },
      to: 's1@x.com',
      subject: 'Re: Subject 1',
      text: 'Edited reply',
      inReplyTo: '<m1@x.com>',
      references: ['<root@x>', '<m1@x.com>']
    }])
    expect(readFileSync(join(t.folder, 'mail', 'sent.jsonl'), 'utf8')).toContain('"to":"s1@x.com"')
  })
  it('fails (and does not send) when the account is gone', async () => {
    const t = setup({ inbox: [mail(1)], classify: () => '[{"uid":1,"category":"needs-reply"}]' })
    await t.m.sortInbox()
    const item = t.approvals.pending()[0]
    t.m.remove(t.id)
    expect(await t.approvals.approve(item.id)).toEqual({ ok: false, error: 'account_removed' })
    expect(t.sent).toEqual([])
  })
  it('buildReplyMessage refuses a payload for another account', () => {
    const a = normalizeAccount({ address: 'a@corp.com', preset: 'qq' }, 'acc-bbbbbbbb')
    expect(() => buildReplyMessage(a, { draft: 'x', payload: { accountId: 'acc-cccccccc', to: 'z@x' } })).toThrow('wrong_account')
    const ap = replyApproval(a, mail(4), 'hi')
    expect(buildReplyMessage(a, ap).references).toEqual(['<m4@x.com>'])
  })
})
