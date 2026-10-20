// Real IMAP / SMTP for Butler email: imapflow + mailparser + nodemailer.
// Loaded on first use, so Hive still starts (and the unit tests run) when
// those packages are missing; mail then reports that it isn't installed.
// Untested glue — the logic it feeds is in butlerMail.ts.

import type { MailAccount } from '../shared/butler-mail'
import type { Addr, MailClients, MailSession, RawMail } from './butlerMail'

async function load(name: string): Promise<any> {
  try {
    // A plain require (main is CommonJS): works from inside the asar and
    // keeps the bundler from trying to resolve these optional packages.
    return require(name)
  } catch {
    throw new Error(`Mail support isn't installed (${name})`)
  }
}

const pick = (m: any, key: string) => m?.[key] ?? m?.default?.[key] ?? m?.default

function firstAddr(v: any): Addr {
  const a = v?.value?.[0]
  return { name: typeof a?.name === 'string' ? a.name : '', address: typeof a?.address === 'string' ? a.address : '' }
}

function refs(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string') return v.split(/\s+/).filter(Boolean)
  return []
}

export function createMailClients(): MailClients {
  return {
    async openInbox(account: MailAccount, password: string): Promise<MailSession> {
      const ImapFlow = pick(await load('imapflow'), 'ImapFlow')
      const simpleParser = pick(await load('mailparser'), 'simpleParser')
      const client = new ImapFlow({
        host: account.imap.host, port: account.imap.port, secure: account.imap.secure,
        auth: { user: account.address, pass: password },
        logger: false,
        clientInfo: { name: 'Hive', vendor: 'Hive' }
      })
      await client.connect()
      try {
        const st = await client.status('INBOX', { unseen: true, uidNext: true, uidValidity: true })
        await client.mailboxOpen('INBOX', { readOnly: true })
        const info = { uidValidity: Number(st.uidValidity ?? client.mailbox?.uidValidity ?? 0), uidNext: Number(st.uidNext ?? client.mailbox?.uidNext ?? 1), unseen: Number(st.unseen ?? 0) }
        return {
          info,
          async fetchAfter(uid: number, limit: number): Promise<RawMail[]> {
            const found: number[] = (await client.search({ uid: `${uid + 1}:*` }, { uid: true })) || []
            const uids = found.map(Number).filter(u => u > uid).sort((a, b) => a - b).slice(0, limit)
            if (!uids.length) return []
            const raw: Array<{ uid: number; seen: boolean; source: Buffer }> = []
            for await (const msg of client.fetch(uids.join(','), { uid: true, flags: true, source: true }, { uid: true })) {
              raw.push({ uid: Number(msg.uid), seen: !!msg.flags?.has?.('\\Seen'), source: msg.source })
            }
            const out: RawMail[] = []
            for (const r of raw) {
              const p = await simpleParser(r.source)
              out.push({
                uid: r.uid,
                messageId: typeof p.messageId === 'string' ? p.messageId : '',
                from: firstAddr(p.from),
                replyTo: p.replyTo ? firstAddr(p.replyTo) : undefined,
                subject: typeof p.subject === 'string' ? p.subject : '',
                date: p.date instanceof Date ? p.date.getTime() : 0,
                text: typeof p.text === 'string' ? p.text : '',
                references: refs(p.references),
                seen: r.seen
              })
            }
            return out
          },
          async close() { await client.logout().catch(() => client.close?.()) }
        }
      } catch (e) {
        await client.logout().catch(() => client.close?.())
        throw e
      }
    },

    async send(account, password, msg) {
      const nodemailer = await load('nodemailer')
      const createTransport = nodemailer.createTransport ?? nodemailer.default?.createTransport
      const t = createTransport({
        host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure,
        auth: { user: account.address, pass: password }
      })
      try {
        const info = await t.sendMail({
          from: msg.from.name ? { name: msg.from.name, address: msg.from.address } : msg.from.address,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
          ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo } : {}),
          ...(msg.references.length ? { references: msg.references } : {})
        })
        return { messageId: info?.messageId }
      } finally {
        t.close?.()
      }
    }
  }
}
