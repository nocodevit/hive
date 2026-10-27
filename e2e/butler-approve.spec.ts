import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync, spawnSync } from 'child_process'
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

/** The real ./hive CLI Butler runs, against this test's Hive. */
const hive = (...args: string[]) => {
  const r = spawnSync('python3', [join(PROJECT_ROOT, 'resources', 'butler', 'hive'), ...args], { env: { ...process.env, HIVE_DATA_DIR }, encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` }
}

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
    card('fs-1', 'feishu.followup', 'Daniel Vargas Millan · On another topic, I have a requirement f…', 'Feishu follow-up · unsure', 'Thanks Daniel, I will check.',
      { chatId: 'oc_1', question: 'On another topic, I have a requirement from Claro: they need the roaming CDRs split by country every Monday, starting next month.' }, 'Reply'),
    card('fs-2', 'feishu.followup', 'Pod · 这批 SOW 改动是否接受进 P4', 'Feishu · facts sent, your call', '',
      { chatId: 'oc_2', question: 'SOW 模块改动需求 6 条', topic: '这批 SOW 改动是否接受进 P4、优先级怎么定', sent: '收到，纪要已看过。FAE-1446 建议合并筛选项。\n其余已转告 Megan，稍后回复。' }, 'Reply'),
    card('jira-c', 'jira.comment', 'P4-6926 · comment', 'Jira · in analysis 21 days', '请补充验收标准？', { key: 'P4-6926' }, 'Comment')
  ]))
  const proj = join(ROOT, 'proj-psle')
  mkdirSync(proj, { recursive: true })
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'PSLE', path: proj }],
    agents: [{ id: 'a1', projectId: 'p1', name: 'Planner' }]
  }))
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

test('a Feishu card shows their whole message', async () => {
  const c = page.getByLabel('Reply: Daniel Vargas Millan · On another topic, I have a requirement f…')
  await expect(c.getByLabel('Their message')).toContainText('roaming CDRs split by country every Monday, starting next month.')
})

test('a card can go to the Butler chat instead of replying', async () => {
  await page.getByLabel('Reply: Daniel Vargas Millan · On another topic, I have a requirement f…').getByRole('button', { name: /^Discuss (?!.*with…$)/ }).click()
  await expect(page.getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true')
  // It shows in the chat as the owner's own message.
  await expect(page.getByRole('complementary', { name: 'Butler panel' }).getByText('Help me think this through.', { exact: false }).first()).toBeVisible({ timeout: 15000 })
  await page.getByRole('tab', { name: /Approve/ }).click()
})

test('a card whose facts went out shows what was sent and what is your call; Reply opens an empty box', async () => {
  const c = page.getByLabel('Reply: Pod · 这批 SOW 改动是否接受进 P4')
  await expect(c.getByLabel('Your call')).toContainText('Your call · 这批 SOW 改动是否接受进 P4、优先级怎么定')
  await c.getByText('Sent to them ✓').click()
  await expect(c.getByLabel('Already sent')).toContainText('FAE-1446 建议合并筛选项')
  await c.getByRole('button', { name: /^Reply Pod/ }).click()
  await expect(c.getByLabel('Reply', { exact: true })).toHaveValue('')
})

test('cards are grouped (needs your call / ready to send) and filter by source', async () => {
  const p = page.getByRole('complementary', { name: 'Butler panel' })
  await expect(p.getByRole('group', { name: 'Needs your call' })).toContainText('这批 SOW 改动是否接受进 P4')
  await expect(p.getByRole('group', { name: 'Ready to send' })).toContainText('P4-6926')
  await p.getByRole('radio', { name: /^Jira/ }).click()
  await expect(p.getByLabel('Comment: P4-6926 · comment')).toBeVisible()
  await expect(p.getByLabel('Reply: Daniel Vargas Millan · On another topic, I have a requirement f…')).toHaveCount(0)
  await p.getByRole('radio', { name: /^All/ }).click()
  await p.screenshot({ path: test.info().outputPath('approve-new.png') })
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
  await expect(gary.getByRole('button', { name: /^Discuss (?!.*with…$)/ })).toBeVisible()
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
  await row.getByRole('button', { name: 'Discuss Lin · UAT down?', exact: true }).click()
  await expect(page.getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /Approve/ }).click()
})

test('Discuss ▾ lists Butler first, then agents by project', async () => {
  const ana = page.getByLabel('Needs you: Ana · Price list')
  await ana.getByRole('button', { name: 'Discuss Ana · Price list with…' }).click()
  const menu = page.getByRole('menu', { name: 'Discuss with' })
  await expect(menu.getByRole('menuitem').first()).toContainText('Butler')
  await expect(menu.getByRole('group', { name: 'PSLE' }).getByRole('menuitem', { name: 'Discuss with Planner' })).toContainText('resumes')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('Butler keeps cards right: ./hive card edit / close / reopen; sending stays on the card', async () => {
  const list = hive('cards')
  expect(list.ok).toBe(true)
  expect(list.out).toContain('Daniel Vargas Millan')
  expect(hive('card', 'show', 'fs-1').out).toContain('roaming CDRs split by country')

  expect(hive('card', 'edit', 'fs-1', '--draft', 'Thanks Daniel — Monday reports split by country from next month.').ok).toBe(true)
  const daniel = page.getByLabel('Reply: Daniel Vargas Millan · On another topic, I have a requirement f…')
  await expect(daniel.getByLabel('Draft for Daniel Vargas Millan · On another topic, I have a requirement f…')).toContainText('Monday reports split by country')
  await expect(daniel.getByLabel('Updated by Butler')).toBeVisible()
  const saved = JSON.parse(readFileSync(join(BUTLER, 'approvals.json'), 'utf8')).find((x: any) => x.id === 'fs-1')
  expect(saved.status).toBe('pending')

  const ana = hive('card', 'edit', 'new-q', '--draft', 'x')
  expect(ana.ok).toBe(false)
  expect(ana.out).toContain("waiting for the owner's answer")

  expect(hive('card', 'close', 'jira-c').out).toContain('Say why')
  expect(hive('card', 'close', 'jira-c', '--why', '已在 Jira 里答复').ok).toBe(true)
  await expect(page.getByRole('button', { name: 'Comment P4-6926 · comment' })).toHaveCount(0)
  const history = page.getByRole('group', { name: 'Approve history' })
  await history.locator('summary').first().click()
  const row = history.getByRole('group').filter({ hasText: 'P4-6926 · comment' })
  await expect(row).toContainText('Closed by Butler')
  await row.getByText('P4-6926 · comment').click()
  await expect(row.getByLabel('Why closed')).toHaveText('Why: 已在 Jira 里答复')

  expect(hive('card', 'reopen', 'jira-c').ok).toBe(true)
  await expect(page.getByRole('button', { name: 'Comment P4-6926 · comment' })).toBeVisible()
})

test('needs-you card: what it wants + question; Discuss opens the Butler chat', async () => {
  const ana = page.getByLabel('Needs you: Ana · Price list')
  await expect(ana.getByLabel('What it wants')).toHaveText('Ana wants the 2027 price list')
  await expect(ana.getByLabel('Butler asks')).toContainText('Which prices can I share?')
  await expect(ana.getByRole('button', { name: 'Write reply' })).toBeDisabled()
  await page.screenshot({ path: test.info().outputPath('approve.png') })
  await ana.getByRole('button', { name: /^Discuss (?!.*with…$)/ }).click()
  await expect(page.getByRole('tab', { name: /Chat/ })).toHaveAttribute('aria-selected', 'true')
})
