import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'

/**
 * First-run card → "Start" → setup wizard: theme applies live, "About you"
 * writes profile.md in the Butler folder, Skip leaves a step open, the
 * Butler panel's "Setup n/m" card reopens the wizard at that step, and
 * progress survives a restart. `claude` is a fake (auth status is canned).
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-wizard')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')

let app: ElectronApplication
let page: Page

async function launch() {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17861', HIVE_DATA_DIR, HIVE_BUTLER_OFFER: '1', HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
}

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  mkdirSync(join(ROOT, 'claude-home'), { recursive: true })
  writeFileSync(FAKE, `#!/bin/bash
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then echo '{"loggedIn": true, "authMethod": "claude.ai"}'; exit 0; fi
while read -r _; do :; done
`)
  chmodSync(FAKE, 0o755)
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Wizard Test', officePath: ROOT, zones: [{ id: 'z1', name: 'src', path: ROOT, type: 'non-rnd', hasGit: false }] }],
    agents: [{ avatar, id: 'a1', projectId: 'p1', zoneId: 'z1', name: 'Missy', role: 'Eng', type: 'non-coding', department: 'Non-R&D', group: '', order: 0, status: 'done', soul: '', enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high' }],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false }
  }))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

const wizard = () => page.getByRole('dialog', { name: 'Butler setup' })
const steps = () => wizard().getByRole('navigation', { name: 'Setup steps' })

test('the first-run card opens the wizard at Welcome', async () => {
  await page.getByRole('dialog', { name: 'Set up Hive with Butler?' }).getByRole('button', { name: 'Start' }).click()
  await expect(wizard().getByRole('heading', { name: 'Welcome to Hive' })).toBeVisible()
})

test('Claude Code shows the signed-in account', async () => {
  await wizard().getByRole('button', { name: 'Next' }).click()
  await expect(wizard().getByText('Signed in · claude.ai')).toBeVisible()
})

test('Theme applies at once', async () => {
  await steps().getByRole('button', { name: /Theme/ }).click()
  await wizard().getByRole('button', { name: /Tech Blue/i }).click()
  await expect(wizard().getByRole('button', { name: /Tech Blue/i })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.palette || document.body.dataset.palette || '')).toContain('blue')
})

test('About you writes profile.md; Skip leaves Voice open', async () => {
  await steps().getByRole('button', { name: /Voice/ }).click()
  await wizard().getByRole('button', { name: 'Skip' }).click()
  await expect(wizard().getByRole('heading', { name: 'About you' })).toBeVisible()
  // Tab in an empty field accepts its example.
  await wizard().getByLabel('Role').focus()
  await page.keyboard.press('Tab')
  await expect(wizard().getByLabel('Role')).toHaveValue('产品负责人')
  // More has the full set, with "your" name and the assistant's apart.
  await wizard().getByText('More', { exact: true }).click()
  await expect(wizard().getByLabel('Your name')).toBeVisible()
  await expect(wizard().getByLabel('Assistant name · prefix & intro')).toBeVisible()
  await expect(wizard().getByLabel('Never says')).toBeVisible()
  // Nothing is cut off: the last field scrolls into view inside the dialog,
  // and the footer buttons stay on screen.
  const box = (await wizard().boundingBox())!
  const extra = wizard().getByLabel('Extra')
  await extra.scrollIntoViewIfNeeded()
  const eb = (await extra.boundingBox())!
  expect(eb.y + eb.height).toBeLessThanOrEqual(box.y + box.height)
  const next = (await wizard().getByRole('button', { name: 'Next' }).boundingBox())!
  expect(next.y + next.height).toBeLessThanOrEqual(box.y + box.height)
  await page.screenshot({ path: test.info().outputPath('about-more.png') })
  await wizard().getByLabel('Answer like a').fill('资深 IoT 产品经理')
  await wizard().getByRole('radio', { name: 'Warm' }).click()
  await wizard().getByRole('button', { name: 'Next' }).click()
  const md = join(HIVE_DATA_DIR, 'butler', 'profile.md')
  await expect.poll(() => existsSync(md)).toBe(true)
  expect(readFileSync(md, 'utf8')).toContain('- Role: 产品负责人')
  expect(readFileSync(md, 'utf8')).toContain('Warm:')
  const setup = JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'butler.json'), 'utf8')).setup
  expect(setup).toMatchObject({ voice: 'skipped', about: 'done' })
})

test('the Butler panel shows what is left and reopens the wizard there', async () => {
  await page.keyboard.press('Escape')
  await expect(wizard()).toBeHidden()
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  const card = page.getByLabel('Setup progress')
  await expect(card).toContainText(/Setup \d\/\d/)
  await card.getByRole('button', { name: /^Set up / }).first().click()
  await expect(wizard()).toBeVisible()
})

test('progress survives a restart', async () => {
  await app.close()
  await launch()
  const answered = page.getByRole('dialog').getByRole('button', { name: 'Not now' })
  if (await answered.count()) await answered.click()
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  await expect(page.getByLabel('Setup progress')).toContainText(/Setup [1-9]\/\d/)
})
