import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * App Settings: the left nav (click scrolls, the current section is
 * highlighted, nothing cut off) and the Notifications section (Mac switch on
 * by default, per-event switches folded under More, quiet hours saved, the
 * test notification). Also: a notification click lands on the right place,
 * and the butler API answers /pending.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-settings-notify')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')
const PORT = '17905'

let app: ElectronApplication
let page: Page

const settingsFile = () => JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'notifications.json'), 'utf8'))
const dialog = () => page.getByRole('dialog', { name: 'App Settings' })
const nav = () => dialog().getByRole('navigation', { name: 'Settings sections' })

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: PORT, HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('button', { name: 'App Settings' }).click()
  await expect(dialog()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('the nav lists the sections; nothing is cut off', async () => {
  for (const l of ['Daily routine', 'Skills', 'Notifications', 'General', 'Templates']) {
    await expect(nav().getByRole('button', { name: l, exact: true })).toBeVisible()
  }
  // Inside the window on every side (polled: the window may still be settling).
  await expect.poll(async () => {
    const b = (await dialog().boundingBox())!
    const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
    return b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.w && b.y + b.height <= vp.h
  }).toBe(true)
  // No sideways overflow in the content column.
  const overflow = await dialog().getByLabel('General section').evaluate(el => {
    const scroller = el.parentElement!.parentElement!
    return scroller.scrollWidth - scroller.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: test.info().outputPath('settings-nav-top.png') })
})

test('clicking a nav item scrolls to it and highlights it', async () => {
  await nav().getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(dialog().getByLabel('Notifications section')).toBeInViewport()
  await expect(nav().getByRole('button', { name: 'Notifications', exact: true })).toHaveAttribute('aria-current', 'true')
  await page.screenshot({ path: test.info().outputPath('settings-notifications.png') })
  await nav().getByRole('button', { name: 'Templates', exact: true }).click()
  await expect(dialog().getByLabel('Templates section')).toBeInViewport()
  await expect(nav().getByRole('button', { name: 'Templates', exact: true })).toHaveAttribute('aria-current', 'true')
})

test('scrolling by hand moves the highlight', async () => {
  await dialog().getByLabel('Storage section').hover()
  await page.mouse.wheel(0, -100000)
  await expect(nav().getByRole('button', { name: 'Templates', exact: true })).not.toHaveAttribute('aria-current', 'true')
  await expect(nav().getByRole('button', { name: 'Remote Control', exact: true })).toHaveAttribute('aria-current', 'true')
})

test('Notifications: Mac on by default, per-event switches folded under More', async () => {
  const sec = dialog().getByLabel('Notifications section')
  await nav().getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(sec.getByRole('switch', { name: 'Mac notifications' })).toHaveAttribute('aria-checked', 'true')
  await expect(sec.getByRole('switch', { name: 'Task done' })).toBeHidden()
  await sec.getByText('More', { exact: true }).click()
  await expect(sec.getByRole('switch', { name: 'Agent waiting for you' })).toHaveAttribute('aria-checked', 'true')
  await expect(sec.getByRole('switch', { name: 'Task done' })).toHaveAttribute('aria-checked', 'false')
  await sec.getByRole('switch', { name: 'Task done' }).click()
  await expect.poll(() => settingsFile().events.taskDone).toBe(true)
  await sec.getByText('More', { exact: true }).click()
  await expect(sec.getByRole('switch', { name: 'Task done' })).toBeHidden()
})

test('quiet hours are saved', async () => {
  const sec = dialog().getByLabel('Notifications section')
  await expect(sec.getByLabel('Quiet from')).toHaveCount(0)
  await sec.getByRole('switch', { name: 'Quiet hours' }).click()
  await expect(sec.getByLabel('Quiet from')).toHaveValue('22:00')
  await sec.getByLabel('Quiet from').fill('23:15')
  await sec.getByLabel('Quiet from').press('Enter')
  await sec.getByLabel('Quiet until').fill('07:30')
  await sec.getByLabel('Quiet until').press('Enter')
  await expect.poll(() => settingsFile().quiet).toEqual({ on: true, start: '23:15', end: '07:30' })
  await sec.screenshot({ path: test.info().outputPath('notifications-section.png') })
})

test('Send a test shows the notification', async () => {
  const sec = dialog().getByLabel('Notifications section')
  await sec.getByRole('button', { name: 'Send a test' }).click()
  await expect(sec.getByRole('status').filter({ hasText: 'Sent' })).toBeVisible()
  await expect(sec.getByRole('button', { name: 'Open System Settings' })).toBeVisible()
  const log = readFileSync(join(HIVE_DATA_DIR, 'notify-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
  expect(log.at(-1)).toMatchObject({ channel: 'mac', title: 'Hive' })
})

test('Telegram setup starts with BotFather and a token box', async () => {
  const sec = dialog().getByLabel('Notifications section')
  await sec.getByRole('button', { name: 'Set up' }).click()
  await expect(sec.getByRole('button', { name: 'Open BotFather' })).toBeVisible()
  await expect(sec.getByText('send /newbot, name it, copy the token')).toBeVisible()
  await sec.getByLabel('Bot token').fill('not a token')
  await sec.getByRole('button', { name: 'Check' }).click()
  await expect(sec.getByRole('alert')).toHaveText('Not a bot token')
  await sec.screenshot({ path: test.info().outputPath('telegram-setup.png') })
})

test('a notification click on a failed routine opens Settings at Daily routine', async () => {
  await dialog().getByRole('button', { name: 'Close' }).click()
  await expect(dialog()).toBeHidden()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('notify:open', { kind: 'routines' }))
  await expect(dialog().getByLabel('Daily routine section')).toBeInViewport()
  await expect(nav().getByRole('button', { name: 'Daily routine', exact: true })).toHaveAttribute('aria-current', 'true')
})

test('the butler API answers /pending', async () => {
  const token = readFileSync(join(HIVE_DATA_DIR, 'api-token'), 'utf8').trim()
  const r = await fetch(`http://127.0.0.1:${PORT}/pending`, { headers: { 'X-Hive-Token': token } })
  expect(r.status).toBe(200)
  expect(await r.json()).toEqual({ ok: true, agents: [], approvals: { count: 0, titles: [] }, routinesFailed: [] })
})
