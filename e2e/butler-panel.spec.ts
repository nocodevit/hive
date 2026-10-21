import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdirSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'fs'
import { tmpdir } from 'os'

/**
 * The Butler button at the right of the rightmost header opens the Butler
 * panel (Chat / Sessions); Sessions lists the agents with their status and
 * Open jumps to that agent; ⤢ turns the panel into a page under a Butler
 * entry at the top of the project list; 📌 keeps that entry across a
 * restart; ✕ on an unpinned entry closes it. `claude` is a fake that stays
 * idle, so no real session starts.
 */

const PROJECT_ROOT = join(__dirname, '..')
const ROOT = join(tmpdir(), 'hive-e2e-butler-panel')
const HIVE_DATA_DIR = join(ROOT, 'data')
const FAKE = join(ROOT, 'fake-claude')

let app: ElectronApplication
let page: Page

async function launch() {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17851', HIVE_DATA_DIR, HIVE_CLAUDE_BIN: FAKE, CLAUDE_CONFIG_DIR: join(ROOT, 'claude-home') }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByText('Panel Test').first()).toBeVisible()
}

test.beforeAll(async () => {
  if (existsSync(ROOT)) rmSync(ROOT, { recursive: true })
  mkdirSync(HIVE_DATA_DIR, { recursive: true })
  mkdirSync(join(ROOT, 'claude-home'), { recursive: true })
  writeFileSync(FAKE, '#!/bin/bash\nwhile read -r _; do :; done\n')
  chmodSync(FAKE, 0o755)
  const prefs = { autoRunClaude: false, startupCommand: '' }
  const avatar = { skinTone: '#f5d0a9', hairStyle: 'short', hairColor: '#2c1810', topStyle: 'tee', topColor: '#7c3aed', bottomStyle: 'pants', bottomColor: '#1e293b', hat: 'none', accessories: [] }
  const agent = (id: string, name: string, order: number) => ({ avatar, id, projectId: 'p1', zoneId: 'z1', name, role: 'Eng', type: 'non-coding', department: 'Non-R&D', group: '', order, status: 'done', soul: '', enabledSkills: [], preferences: prefs, model: 'inherit', effort: 'high' })
  writeFileSync(join(HIVE_DATA_DIR, 'data.json'), JSON.stringify({
    projects: [{ id: 'p1', name: 'Panel Test', officePath: ROOT, zones: [{ id: 'z1', name: 'src', path: ROOT, type: 'non-rnd', hasGit: false }] }],
    agents: [agent('a1', 'Missy', 0), agent('a2', 'Quinn', 1)],
    appPrefs: { autoRunClaude: false, maxLogs: 100, continueSession: false }
  }))
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 60000 })
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
})

test('the Butler button opens the panel with Chat and Sessions', async () => {
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Butler panel' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true')
  await panel.getByRole('tab', { name: /Sessions/ }).click()
  await expect(panel.getByText('Missy')).toBeVisible()
  await expect(panel.getByText('Quinn')).toBeVisible()
  await expect(panel.getByText('Panel Test · off').first()).toBeVisible()
})

test('Resume on an off agent starts its chat; Open jumps to it and closes the panel', async () => {
  const panel = page.getByRole('complementary', { name: 'Butler panel' })
  await panel.getByRole('tab', { name: /Sessions/ }).click()
  const resume = panel.getByRole('button', { name: 'Resume Missy' })
  await resume.click()
  // Pressed: it says so and cannot be pressed again (unless the row is already live).
  await expect(panel.getByRole('button', { name: /^(Resume|Open|Answer) Missy$/ })).toHaveText(/Resuming…|Open|Answer/)
  await expect.poll(async () => (await page.evaluate(() => window.api.butler.agents())).find(r => r.agent === 'Missy')?.activity, { timeout: 30000 }).not.toBe('off')
  await panel.getByRole('button', { name: /^(Open|Answer) Missy$/ }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Missy' }).first()).toBeVisible()
})

test('⤢ opens Butler as a page with an entry at the top of the project list; ✕ closes it', async () => {
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  await page.getByRole('button', { name: 'Open as a page' }).click()
  await expect(page.getByRole('button', { name: 'Close Butler page' })).toBeVisible()
  await page.getByRole('button', { name: 'Close Butler page' }).click()
  await expect(page.getByRole('complementary', { name: 'Butler panel' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Close Butler page' })).toHaveCount(0)
})

test('📌 keeps the Butler entry in the project list across a restart', async () => {
  await page.getByRole('button', { name: 'Butler', exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Butler panel' })
  await expect(panel).toBeVisible()
  const asPage = panel.getByRole('button', { name: 'Open as a page' })
  if (await asPage.count()) await asPage.click()
  await panel.getByRole('button', { name: '📌 Pin' }).click()
  await expect(panel.getByRole('button', { name: '📌 Pinned' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => JSON.parse(readFileSync(join(HIVE_DATA_DIR, 'butler.json'), 'utf8')).pinned).toBe(true)
  await app.close()
  await launch()
  // Missy's chat was open at quit, so Hive offers to resume it.
  await page.getByRole('dialog').getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByRole('img', { name: 'Pinned' })).toBeVisible()
  await page.getByRole('button', { name: 'Open Butler page' }).click()
  await expect(page.getByRole('complementary', { name: 'Butler panel' })).toBeVisible()
})
