// Butler email: presets and the shapes main and renderer share.

export interface MailServer { host: string; port: number; secure: boolean }

export type MailPresetId = 'exmail' | 'qq' | '163' | 'gmail' | 'other'

export interface MailPreset {
  id: MailPresetId
  name: string
  imap: MailServer
  smtp: MailServer
  /** Where to get a client / app password, one short step per line. */
  steps: string[]
  url?: string
}

export const MAIL_PRESETS: MailPreset[] = [
  {
    id: 'exmail', name: '腾讯企业邮箱',
    imap: { host: 'imap.exmail.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true },
    steps: ['Sign in at exmail.qq.com', 'Settings (设置) → Client settings (客户端设置) → turn on IMAP/SMTP', 'WeChat binding (微信绑定) → Generate new password (生成新密码), paste it here'],
    url: 'https://exmail.qq.com'
  },
  {
    id: 'qq', name: 'QQ 邮箱',
    imap: { host: 'imap.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    steps: ['Sign in at mail.qq.com → Settings (设置) → Account (账号)', 'IMAP/SMTP service (IMAP/SMTP 服务) → turn on (开启)', 'Generate an authorization code (生成授权码), paste it here'],
    url: 'https://mail.qq.com'
  },
  {
    id: '163', name: '163',
    imap: { host: 'imap.163.com', port: 993, secure: true },
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    steps: ['Sign in at mail.163.com → Settings (设置) → POP3/SMTP/IMAP', 'IMAP/SMTP service (IMAP/SMTP 服务) → turn on (开启)', 'Add an authorization password (新增授权密码), paste it here'],
    url: 'https://mail.163.com'
  },
  {
    id: 'gmail', name: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    steps: ['Google Account → Security → 2-Step Verification on', 'App passwords → create “Hive”', 'Use the 16-letter password'],
    url: 'https://myaccount.google.com/apppasswords'
  },
  {
    id: 'other', name: 'Other',
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    steps: ['Turn on IMAP/SMTP in your mail settings', 'Create a client / app password if asked']
  }
]

export function mailPreset(id: string): MailPreset | undefined {
  return MAIL_PRESETS.find(p => p.id === id)
}

/** Preset for an address by its exact domain (no guessing beyond these). */
export function presetForAddress(address: string): MailPresetId | null {
  const domain = address.trim().toLowerCase().split('@')[1] || ''
  if (domain === 'qq.com' || domain === 'foxmail.com') return 'qq'
  if (domain === '163.com') return '163'
  if (domain === 'gmail.com' || domain === 'googlemail.com') return 'gmail'
  return null
}

export interface MailAccount {
  id: string
  address: string
  /** Display label: "Work", "Personal". */
  label: string
  preset: MailPresetId
  imap: MailServer
  smtp: MailServer
  /** Sort new mail (needs-reply / customer / fyi / notice / noise). */
  sort: boolean
  /** Draft replies for needs-reply and customer mail. */
  drafts: boolean
  paused: boolean
}

export interface MailAccountStatus {
  ok: boolean
  unread?: number
  error?: string
  at: number
}

export type MailAccountView = MailAccount & { status?: MailAccountStatus; hasPassword: boolean }

export type MailCategory = 'needs-reply' | 'customer' | 'fyi' | 'notice' | 'noise'
export const MAIL_CATEGORIES: MailCategory[] = ['needs-reply', 'customer', 'fyi', 'notice', 'noise']

export interface MailAccountInput {
  id?: string
  address: string
  label?: string
  preset: MailPresetId
  imap?: MailServer
  smtp?: MailServer
  sort?: boolean
  drafts?: boolean
  paused?: boolean
  /** New password; omitted keeps the stored one. */
  password?: string
}

export type MailTestResult = { ok: true; unread: number } | { ok: false; error: string }
