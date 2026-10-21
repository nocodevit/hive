import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Header quick toggles next to Butler: 📱 Mobile Butler and 💬 Feishu
 * answer-for-me. Each shows its state, flips at once (no Save), and App
 * Settings shows the same state. Answer-for-me turned on from the header
 * starts from now, like the settings switch. Feishu signed out: 💬 is
 * disabled with "Sign in to Feishu first".
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-quick-toggles')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')

let app: ElectronApplication
let page: Page

async function launch() {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17932', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home'), HIVE_FEISHU_PLAIN_STORE: '1', HIVE_FEISHU_RELAY: 'http://127.0.0.1:9' }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  // Setup was started once; Feishu is signed in.
  writeFileSync(join(HIVE_DATA_DIR, 'butler.json'), JSON.stringify({ setupVersion: 2, setup: { welcome: 'done' } }))
  const far = Date.now() + 30 * 24 * 3600_000
  writeFileSync(join(HIVE_DATA_DIR, 'feishu-token.bin'), JSON.stringify({
    accessToken: 'u-fake', refreshToken: 'ur-fake', accessExpiresAt: far, refreshExpiresAt: far, scope: '', openId: 'ou_fake', name: 'Mei Test'
  }))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

const mobile = () => page.getByRole('switch', { name: 'Mobile Butler' })
const feishu = () => page.getByRole('switch', { name: 'Feishu answer-for-me' })

test('both toggles sit next to Butler and start off', async () => {
  await expect(page.getByRole('button', { name: 'Butler', exact: true })).toBeVisible()
  await expect(mobile()).toHaveAttribute('aria-checked', 'false')
  await expect(feishu()).toHaveAttribute('aria-checked', 'false')
  await expect(feishu()).toBeEnabled()
  await expect(page.getByTitle('Mobile Butler · Off')).toBeVisible()
  await expect(page.getByTitle('Feishu answer-for-me · Off')).toBeVisible()
})

test('flip both on from the header: immediate, and settings agree', async () => {
  const before = Date.now()
  await mobile().click()
  await expect(mobile()).toHaveAttribute('aria-checked', 'true')
  await feishu().click()
  await expect(feishu()).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTitle('Feishu answer-for-me · On')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('header-on.png') })
  expect(JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'butler.json'), 'utf8')).enabled).toBe(true)
  expect(JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'butler', 'feishu-agent.json'), 'utf8')).enabled).toBe(true)
  // Starts from now: history is never answered.
  expect(JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'butler', 'feishu-agent-state.json'), 'utf8')).since).toBeGreaterThanOrEqual(before)

  await page.getByRole('button', { name: 'App Settings' }).click()
  await expect(page.getByRole('switch', { name: 'Allow remote control from my phone (Butler)' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: '代管' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: 'Close' }).click()
})

test('flip both off from the header: settings agree', async () => {
  await mobile().click()
  await expect(mobile()).toHaveAttribute('aria-checked', 'false')
  await feishu().click()
  await expect(feishu()).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'App Settings' }).click()
  await expect(page.getByRole('switch', { name: 'Allow remote control from my phone (Butler)' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('switch', { name: '代管' })).toHaveAttribute('aria-checked', 'false')
  // And the other way: settings → header.
  await page.getByRole('switch', { name: '代管' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(feishu()).toHaveAttribute('aria-checked', 'true')
  await feishu().click()
  await expect(feishu()).toHaveAttribute('aria-checked', 'false')
})

test('Feishu signed out: 💬 is disabled with a hint', async () => {
  await app.close()
  rmSync(join(HIVE_DATA_DIR, 'feishu-token.bin'))
  await launch()
  await expect(feishu()).toBeDisabled()
  await expect(page.getByTitle('Sign in to Feishu first')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('header-feishu-signed-out.png') })
})
