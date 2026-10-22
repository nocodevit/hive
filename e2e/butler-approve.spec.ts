import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Approve cards: a reply card's box is exactly the email that gets sent; a
 * needs-you card (the skill must ask the owner first) has no Send — it shows
 * what the email wants and the question, Discuss opens the Butler chat. Cards
 * written before the JSON contract are migrated on start: a question that sat
 * behind Send becomes a needs-you card, To/Subject lines leave a real draft.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-approve')
const HIVE_DATA_DIR = join(ROOT, 'data')
const BUTLER = join(HIVE_DATA_DIR, 'butler')
const FAKE = join(ROOT, 'fake-claude')

let app: ElectronApplication
let page: Page

const card = (id: string, kind: string, title: string, subtitle: string, draft: string, payload: Record<string, unknown>, action: string) =>
  ({ id, kind, title, subtitle, draft, payload, action, status: 'pending', createdAt: 1 })

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(BUTLER, { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  writeFileSync(join(BUTLER, 'approvals.json'), JSON.stringify([
    // Old format: the skill's question to the owner, behind a Send button.
    card('old-q', 'email.reply', 'Gary · Fw: Telecall Claro roaming', 'email reply · to gary@c.com · from mei@corp.com',
      "Gary is asking you to study Telecall's new Claro roaming. What should I tell him?", { accountId: 'acc-aaaaaaaa', to: 'gary@c.com' }, 'Send'),
    // Old format: a real draft with header lines.
    card('old-d', 'email.reply', 'Lin · UAT down?', 'email reply · to lin@c.com · from mei@corp.com',
      'To: lin@c.com\nSubject: Re: UAT down?\n\nHi Lin, UAT is back. Thanks. — Mei', { accountId: 'acc-aaaaaaaa', to: 'lin@c.com' }, 'Send'),
    // New format: needs you, with the email kept.
    card('new-q', 'email.decide', 'Ana · Price list', 'needs you · email · to ana@c.com · from mei@corp.com', '',
      { v: 2, accountId: 'acc-aaaaaaaa', to: 'ana@c.com', about: 'Ana wants the 2027 price list', question: 'Which prices can I share?', from: 'Ana <ana@c.com>', originalSubject: 'Price list', original: 'Hi Mei, can you send the 2027 price list?' }, 'Discuss'),
    // A Jira comment card: the ticket opens in the browser from the card.
    card('jira-c', 'jira.comment', 'P4-6926 · comment', 'Jira · in analysis 21 days', '请补充验收标准？', { key: 'P4-6926' }, 'Comment')
  ]))
  writeFileSync(join(BUTLER, 'jira-base.txt'), 'https://jira.example.com\n')
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17895', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  await page.getByRole('tab', { name: /Approve/ }).click()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('a Jira card links to its ticket', async () => {
  const c = page.getByLabel('Comment: P4-6926 · comment')
  await expect(c.getByRole('link', { name: 'Open P4-6926 in Jira' })).toHaveAttribute('href', 'https://jira.example.com/browse/P4-6926')
})

test('a question that sat behind Send is now a needs-you card with no Send', async () => {
  const gary = page.getByLabel('Needs you: Gary · Fw: Telecall Claro roaming')
  await expect(gary).toBeVisible()
  await expect(gary.getByLabel('Butler asks')).toContainText("Gary is asking you to study Telecall's new Claro roaming")
  await expect(gary.getByRole('button', { name: /^Send/ })).toHaveCount(0)
  await expect(gary.getByRole('button', { name: /^Edit/ })).toHaveCount(0)
  await expect(gary.getByRole('button', { name: /^Discuss/ })).toBeVisible()
  await expect(gary.getByLabel('Your answer to Butler')).toBeVisible()
  const saved = JSON.parse(readFileSync(join(BUTLER, 'approvals.json'), 'utf8')).find((x: { id: string }) => x.id === 'old-q')
  expect(saved).toMatchObject({ kind: 'email.decide', draft: '', action: 'Discuss' })
})

test('a reply card shows what the email wants and edits exactly the reply', async () => {
  const lin = page.getByLabel('Send: Lin · UAT down?')
  await lin.getByRole('button', { name: /^Edit/ }).click()
  await expect(lin.getByText('Reply · sent exactly as written')).toBeVisible()
  await expect(lin.getByLabel('Reply', { exact: true })).toHaveValue('Hi Lin, UAT is back. Thanks. — Mei')
})

test('a dismissed card leaves the queue and shows in History with its reply', async () => {
  await page.getByLabel('Send: Lin · UAT down?').getByRole('button', { name: /^Reject/ }).click()
  await expect(page.getByLabel('Send: Lin · UAT down?')).toHaveCount(0)
  const history = page.getByRole('group', { name: 'Approve history' })
  await history.getByText(/^History · 1 this week/).click()
  const row = history.getByRole('group').filter({ hasText: 'Lin · UAT down?' })
  await expect(row).toContainText('Dismissed')
  await row.getByText('Lin · UAT down?').click()
  await expect(row).toContainText('Hi Lin, UAT is back. Thanks. — Mei')
})

test('a past card goes to the Butler chat with its context', async () => {
  const row = page.getByRole('group', { name: 'Approve history' }).getByRole('group').filter({ hasText: 'Lin · UAT down?' })
  await row.getByRole('button', { name: 'Discuss Lin · UAT down?' }).click()
  await expect(page.getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /Approve/ }).click()
})

test('needs-you card: what it wants + question; Discuss opens the Butler chat', async () => {
  const ana = page.getByLabel('Needs you: Ana · Price list')
  await expect(ana.getByLabel('What it wants')).toHaveText('Ana wants the 2027 price list')
  await expect(ana.getByLabel('Butler asks')).toContainText('Which prices can I share?')
  await expect(ana.getByRole('button', { name: 'Write reply' })).toBeDisabled()
  await page.screenshot({ path: test.info().outputPath('approve.png') })
  await ana.getByRole('button', { name: /^Discuss/ }).click()
  await expect(page.getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true')
})
