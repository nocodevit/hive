import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Adding a mailbox asks first: "Butler may read this mailbox and draft
 * replies" must be ticked before Save (App Settings and the wizard), and the
 * time is stored with the account. Accounts added before that question show
 * a one-line Confirm notice. Every row says what Butler does with it.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-mail-consent')
const HIVE_DATA_DIR = join(ROOT, 'data')
const MAIL = join(HIVE_DATA_DIR, 'butler', 'mail')
const FAKE = join(ROOT, 'fake-claude')

let app: ElectronApplication
let page: Page

const accounts = () => JSON.parse(readFileSync(join(MAIL, 'accounts.json'), 'utf8')).accounts as { address: string; consentAt: number | null }[]

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(MAIL, { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  const exmail = { imap: { host: 'imap.exmail.qq.com', port: 993, secure: true }, smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true } }
  // Added before the consent question existed (no consentAt).
  writeFileSync(join(MAIL, 'accounts.json'), JSON.stringify({
    accounts: [{ id: 'acc-oldoldold', address: 'old@corp.com', label: '', preset: 'exmail', ...exmail, sort: true, drafts: true, paused: false }],
    status: {}
  }))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17931', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('settings: an old account shows what Butler does and a Confirm notice', async () => {
  await page.getByRole('button', { name: 'App Settings' }).click()
  await expect(page.getByLabel('Access for old@corp.com')).toHaveText('Reads · drafts · sends after your OK')
  const notice = page.getByRole('note', { name: 'Consent needed: old@corp.com' })
  await expect(notice).toBeVisible()
  await notice.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('settings-old-account.png') })
  // Migrated on disk: still there, still sorted, marked "to confirm".
  expect(accounts()).toEqual([expect.objectContaining({ address: 'old@corp.com', consentAt: null })])
})

test('settings: Add needs the box ticked; consent is stored', async () => {
  await page.getByRole('button', { name: '＋ Add account' }).click()
  const form = page.getByLabel('Email account')
  await form.getByPlaceholder('you@company.com').fill('new@corp.com')
  await form.getByLabel('Client password').fill('pw')
  const box = form.getByRole('checkbox', { name: 'Butler may read this mailbox and draft replies' })
  await expect(box).not.toBeChecked()
  await expect(form.getByText('Sent only when you press Send in Approve')).toBeVisible()
  const save = form.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeDisabled()
  await box.check()
  await expect(save).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath('settings-add-consent.png') })
  await save.click()
  await expect(page.getByLabel('Access for new@corp.com')).toHaveText('Reads · drafts · sends after your OK')
  await expect(page.getByRole('note', { name: 'Consent needed: new@corp.com' })).toHaveCount(0)
  expect(accounts().find(a => a.address === 'new@corp.com')?.consentAt).toEqual(expect.any(Number))
})

test('wizard: the old account shows the notice; Add needs the box ticked', async () => {
  await page.getByRole('button', { name: 'Close' }).click()
  // Setup never started: the 📱 toggle opens the wizard.
  await page.getByRole('switch', { name: 'Mobile Butler' }).click()
  const wizard = page.getByRole('dialog', { name: 'Butler setup' })
  await wizard.getByRole('navigation', { name: 'Setup steps' }).getByRole('button', { name: /Email/ }).click()
  await expect(wizard.getByRole('note', { name: 'Consent needed: old@corp.com' })).toBeVisible()
  await expect(wizard.getByLabel('Access for new@corp.com')).toHaveText('Reads · drafts · sends after your OK')
  await wizard.getByRole('button', { name: '＋ Add account' }).click()
  const form = wizard.getByLabel('Email account')
  await form.getByPlaceholder('you@company.com').fill('third@corp.com')
  await form.getByLabel('Client password').fill('pw')
  const save = form.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeDisabled()
  await form.getByRole('checkbox', { name: 'Butler may read this mailbox and draft replies' }).check()
  await expect(save).toBeEnabled()
  await page.screenshot({ path: test.info().outputPath('wizard-add-consent.png') })
  await save.click()
  await expect(wizard.getByLabel('Access for third@corp.com')).toBeVisible()
  expect(accounts().find(a => a.address === 'third@corp.com')?.consentAt).toEqual(expect.any(Number))
})

test('Confirm records consent and the notice goes away', async () => {
  const wizard = page.getByRole('dialog', { name: 'Butler setup' })
  await wizard.getByRole('note', { name: 'Consent needed: old@corp.com' }).getByRole('button', { name: 'Confirm' }).click()
  await expect(wizard.getByRole('note', { name: 'Consent needed: old@corp.com' })).toHaveCount(0)
  expect(accounts().find(a => a.address === 'old@corp.com')?.consentAt).toEqual(expect.any(Number))
})
