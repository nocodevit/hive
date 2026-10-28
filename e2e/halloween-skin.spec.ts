import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/**
 * 🎃 The limited Halloween skin: in season, the first launch puts it on by
 * itself (title badge, night colors, ghosts, spiders that spin corner webs),
 * and Settings › Theme palette takes the owner back to any other palette —
 * which then sticks across restarts. Out of season there is nothing to test.
 */

const PROJECT_ROOT = join(__dirname, '..')
const now = new Date()
const inSeason = (now.getMonth() === 9 && now.getDate() >= 24) || (now.getMonth() === 10 && now.getDate() <= 2)

let app: ElectronApplication
let page: Page
let dataDir: string

const launch = async () => {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17896', HIVE_DATA_DIR: dataDir, HIVE_HALLOWEEN: '1' }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
}

test.skip(!inSeason, 'Halloween is Oct 24 – Nov 2')

test.beforeAll(async () => {
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 90000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-halloween-'))
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('first launch in season: the skin is on — badge, night colors, ghosts', async () => {
  await expect(page.getByLabel('Halloween limited skin')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.palette)).toBe('halloween')
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())
  expect(accent.toLowerCase()).toBe('#ffb020')
  await expect(page.getByTestId('halloween-fx')).toBeAttached()
  await page.screenshot({ path: test.info().outputPath('halloween.png') })
})

test('the ghosts wander the window, and one lunges at you now and then', async () => {
  const where = () => page.evaluate(() => [...document.querySelectorAll('.hfx-ghost')].map(g => { const r = g.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)] }))
  const a = await where()
  expect(a).toHaveLength(2)
  await expect.poll(async () => {
    const b = await where()
    return Math.max(...b.map((p, i) => Math.hypot(p[0] - a[i][0], p[1] - a[i][1])))
  }, { timeout: 15000 }).toBeGreaterThan(80)
  await page.evaluate(() => (window as any).__hiveGhostScare())
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.hfx-ghost.scare').length)).toBe(1)
  await page.waitForFunction(() => { const g = document.querySelector('.hfx-ghost.scare'); return !!g && g.getBoundingClientRect().width > 250 }, null, { timeout: 3000 })
  await page.screenshot({ path: test.info().outputPath('ghost-scare.png') })
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.hfx-ghost.scare').length), { timeout: 4000 }).toBe(0)
})

test('a spider wave: they run, stop, and a web is spun in a corner; clicks go through', async () => {
  await page.evaluate(() => (window as any).__hiveSpiders())
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.hfx-spider').length)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.hfx-web').length), { timeout: 8000 }).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.hfx-spider').length), { timeout: 8000 }).toBe(0)
  // Nothing of it takes clicks.
  const blocks = await page.evaluate(() => [...document.querySelectorAll('.hfx, .hfx-web, .hfx-peek')].some(e => getComputedStyle(e).pointerEvents !== 'none'))
  expect(blocks).toBe(false)
  await page.getByRole('button', { name: 'App Settings' }).click()
})

test('Settings › Theme palette switches back, and it stays after a restart', async () => {
  const section = page.getByLabel('Palette section')
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByRole('button', { name: /Halloween/ })).toHaveAttribute('aria-pressed', 'true')
  await section.getByRole('button', { name: /Tech Blue/ }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.palette)).toBe('tech-blue')
  await expect(page.getByLabel('Halloween limited skin')).toHaveCount(0)
  await expect(page.getByTestId('halloween-fx')).toHaveCount(0)

  await app.close()
  await launch()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.palette)).toBe('tech-blue')
  await expect(page.getByLabel('Halloween limited skin')).toHaveCount(0)
})
