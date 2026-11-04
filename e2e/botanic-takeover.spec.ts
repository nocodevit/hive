import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { join } from 'path'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/**
 * 🌿 Everyone gets Botanic once: the first launch of this version puts it on.
 * The owner can then pick anything else, and that choice survives a restart.
 */

const PROJECT_ROOT = join(__dirname, '..')
let app: ElectronApplication
let page: Page
let dataDir: string

const launch = async () => {
  app = await electron.launch({
    args: [join(PROJECT_ROOT, 'out', 'main', 'index.js')],
    env: { ...process.env, NODE_ENV: 'test', HEADLESS: '1', HIVE_PORT: '17899', HIVE_DATA_DIR: dataDir, HIVE_BOTANIC: '1' }
  })
  page = await app.firstWindow({ timeout: 60000 })
  await page.waitForLoadState('domcontentloaded')
}
const palette = () => page.evaluate(() => document.documentElement.dataset.palette ?? 'neon-purple')
const halloween = (() => { const n = new Date(), m = n.getMonth(), d = n.getDate(); return (m === 9 && d >= 24) || (m === 10 && d <= 2) })()

test.skip(halloween, 'Halloween owns the first launch Oct 24 – Nov 2')

test.beforeAll(async () => {
  execSync('npx electron-vite build', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 90000 })
  dataDir = mkdtempSync(join(tmpdir(), 'hive-e2e-botanic-takeover-'))
  await launch()
})

test.afterAll(async () => {
  await app?.close().catch(() => {})
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

test('first launch puts on Botanic; another pick sticks across a restart', async () => {
  await expect.poll(palette).toBe('botanic')
  await expect(page.getByTestId('botanic-fx')).toBeAttached()

  await page.getByRole('button', { name: 'App Settings' }).click()
  const section = page.getByLabel('Palette section')
  await section.scrollIntoViewIfNeeded()
  await expect(section.getByRole('button', { name: /Botanic/ })).toHaveAttribute('aria-pressed', 'true')
  await section.getByRole('button', { name: /Tech Blue/ }).click()
  await expect.poll(palette).toBe('tech-blue')

  await app.close()
  await launch()
  await expect.poll(palette).toBe('tech-blue')
  await expect(page.getByTestId('botanic-fx')).toHaveCount(0)
})
