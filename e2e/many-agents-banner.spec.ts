import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'

/**
 * Hive never closes an agent's chat to make room. With 12+ running, a banner
 * stays up instead; opening the 13th keeps all 13. It counts running claude
 * processes, not panes: a pane whose session was closed does not count.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-many-agents')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')
const NAMES = Array.from({ length: 13 }, (_, i) => `Bee${String(i + 1).padStart(2, '0')}`)

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Hive Of Bees', officePath: ROOT, zones: [{ id: 'z1', name: 'src', path: ROOT, type: 'non-rnd', hasGit: false }] }],
    agents: NAMES.map((name, i) => ({ avatar, id: `a${i + 1}`, projectId: 'p1', zoneId: 'z1', name, role: 'Eng', type: 'non-coding', department: 'Non-R&D', group: '', order: i, status: 'done', soul: '', enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high' })),
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false }
  }))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17898', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText('Hive Of Bees').first()).toBeVisible()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('12 open agents: a banner stays; the 13th closes nobody', async () => {
  await page.getByRole('button', { name: /Hive Of Bees/ }).click()
  const banner = page.getByRole('status', { name: /agents open$/ })
  for (const [i, name] of NAMES.entries()) {
    await page.getByText(name, { exact: true }).first().click()
    await page.getByRole('button', { name: /Start new/ }).and(page.locator(':visible')).click()
    if (i < 11) await expect(banner).toHaveCount(0)
  }
  await expect(page.getByRole('status', { name: '13 agents open' })).toBeVisible()
  await expect(banner).toContainText('Close the ones you are done with')
  // Still up after a while and after switching back to the first one: nothing was closed.
  await page.getByText(NAMES[0], { exact: true }).first().click()
  await expect(page.getByRole('status', { name: '13 agents open' })).toBeVisible()
})

test('a closed session stops counting even though its pane stays', async () => {
  await page.evaluate(() => window.api.chat.stop('chat-a13'))
  await expect(page.getByRole('status', { name: '12 agents open' })).toBeVisible({ timeout: 15000 })
  await page.evaluate(() => window.api.chat.stop('chat-a12'))
  await expect(page.getByRole('status', { name: /agents open$/ })).toHaveCount(0, { timeout: 15000 })
  await expect(page.getByText(NAMES[12], { exact: true }).first()).toBeVisible()
})
