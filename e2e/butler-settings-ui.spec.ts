import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'

/**
 * App Settings → Butler sections read clearly: the email password guide is
 * in English (mailbox menu names kept in brackets), every Daily routine row
 * says what it does, time boxes are not clipped, and "Skill ›" opens the
 * Skills section on that skill. The Butler panel ⚙ also lands on Skills.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-settings-ui')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17881', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'App Settings' }).click()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('email password guide is in English', async () => {
  await page.getByRole('button', { name: '＋ Add account' }).click()
  await page.getByText('Get a client password').click()
  await expect(page.getByText(/Settings \(设置\) → Client settings \(客户端设置\)/)).toBeVisible()
})

test('every routine says what it does; time boxes are not clipped', async () => {
  for (const line of ['Plan for the day from mail, calendar, agents → Today', 'Sorts new mail, drafts replies → Approve',
    'Messages that @mention you, summarized → Today', 'What every agent did today → Today']) {
    await expect(page.getByText(line)).toBeVisible()
  }
  await expect(page.getByText('Feishu @mentions')).toBeVisible()
  const times = page.getByLabel(/ time \d$/)
  const n = await times.count()
  expect(n).toBeGreaterThan(0)
  for (let i = 0; i < n; i++) {
    // 24-hour text, fully visible (the native time box clipped AM/PM).
    await expect(times.nth(i)).toHaveValue(/^\d{2}:\d{2}$/)
    const clipped = await times.nth(i).evaluate(el => el.scrollWidth > el.clientWidth + 1)
    expect(clipped).toBe(false)
  }
  // Editing: a bad value is not saved and reverts; a good one sticks.
  const evening = page.getByLabel('Evening report time 1')
  await evening.fill('25:99')
  await evening.press('Enter')
  await expect(evening).toHaveValue('19:00')
  await evening.fill('18:45')
  await evening.press('Enter')
  await expect(evening).toHaveValue('18:45')
  await page.getByText('Feishu @mentions').scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('daily-routine.png') })
})

test('"Skill ›" opens that skill in the Skills section', async () => {
  await page.getByRole('button', { name: 'Evening report skill' }).click()
  await expect(page.getByRole('option', { name: /Evening report/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Skills section')).toBeInViewport()
})

test('the Butler panel gear opens Settings at Skills', async () => {
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  await page.getByRole('button', { name: 'Butler settings' }).click()
  await expect(page.getByLabel('Skills section')).toBeInViewport()
})
